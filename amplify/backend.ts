import { defineBackend } from "@aws-amplify/backend";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { placeOrder } from "./functions/place-order/resource";
import { modon } from "./functions/modon/resource";
import { FunctionUrlAuthType } from "aws-cdk-lib/aws-lambda";

import { createAuthChallenge } from "./auth/create-auth-challenge/resource";
import { verifyAuthChallenge } from "./auth/verify-auth-challenge/resource";
import { CfnFunction } from "aws-cdk-lib/aws-lambda";

const backend = defineBackend({ auth, data, placeOrder, modon, createAuthChallenge, verifyAuthChallenge });

// Which copy this is: "amplify" = the live site; anything else (dev) is a test
// copy that never sends real Modon orders or Telegram messages.
const stage = process.env.AWS_BRANCH ?? "sandbox";
backend.placeOrder.addEnvironment("STAGE", stage);
backend.modon.addEnvironment("STAGE", stage);

// Login settings for the website's Cognito app client:
// - only the WhatsApp-code sign-in (custom auth) plus token refresh
// - 5 minutes to enter a code
// - customers stay logged in for 180 days on the same phone
const { cfnUserPoolClient } = backend.auth.resources.cfnResources;
cfnUserPoolClient.explicitAuthFlows = ["ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"];
cfnUserPoolClient.authSessionValidity = 5;
cfnUserPoolClient.accessTokenValidity = 60;
cfnUserPoolClient.idTokenValidity = 60;
cfnUserPoolClient.refreshTokenValidity = 180;
cfnUserPoolClient.tokenValidityUnits = { accessToken: "minutes", idToken: "minutes", refreshToken: "days" };

// placeOrder reads the logged-in customer's WhatsApp number from Cognito, and
// finds a customer's account by number when the team places an order for them.
const userPool = backend.auth.resources.userPool;
backend.placeOrder.addEnvironment("USER_POOL_ID", userPool.userPoolId);
backend.placeOrder.resources.lambda.addToRolePolicy(
  new PolicyStatement({ actions: ["cognito-idp:AdminGetUser", "cognito-idp:ListUsers", "cognito-idp:AdminCreateUser", "cognito-idp:AdminSetUserPassword"], resources: [userPool.userPoolArn] }),
);

// Sequential order numbers (EL-0001, EL-0002, ...): one counter row, increased
// atomically by placeOrder. Kept even if the backend is ever removed.
const counters = new Table(Stack.of(backend.placeOrder.resources.lambda), "OrderCounters", {
  partitionKey: { name: "id", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  removalPolicy: RemovalPolicy.RETAIN,
});
counters.grantReadWriteData(backend.placeOrder.resources.lambda);
backend.placeOrder.addEnvironment("COUNTERS_TABLE", counters.tableName);

// Modon's status-update webhook: a public address (Modon can't log in), checked
// by a secret header in the function. Give Modon this address and the header.
const modonUrl = backend.modon.resources.lambda.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });
backend.addOutput({ custom: { modonWebhookUrl: modonUrl.url } });

// Login abuse limits (see amplify/auth/limits.ts): counters that expire by themselves.
const limits = new Table(Stack.of(backend.createAuthChallenge.resources.lambda), "LoginLimits", {
  partitionKey: { name: "id", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: "expires",
  removalPolicy: RemovalPolicy.DESTROY,
});
for (const fn of [backend.createAuthChallenge, backend.verifyAuthChallenge]) {
  limits.grantReadWriteData(fn.resources.lambda);
  fn.addEnvironment("LIMITS_TABLE", limits.tableName);
}

// Cost ceiling under attack: each function may run at most this many copies at
// once. Normal traffic is far below; a flood gets slowed instead of billed.
const ceilings: [typeof backend.placeOrder, number][] = [
  [backend.placeOrder, 10],
  [backend.modon, 5],
  [backend.createAuthChallenge, 10],
  [backend.verifyAuthChallenge, 10],
];
for (const [fn, max] of ceilings) {
  (fn.resources.lambda.node.defaultChild as CfnFunction).reservedConcurrentExecutions = max;
}
