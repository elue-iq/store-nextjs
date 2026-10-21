import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { placeOrder } from "./functions/place-order/resource";

const backend = defineBackend({ auth, data, placeOrder });

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
