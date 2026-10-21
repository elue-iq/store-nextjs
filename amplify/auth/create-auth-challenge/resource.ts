import { defineFunction, secret } from "@aws-amplify/backend";

export const createAuthChallenge = defineFunction({
  name: "create-auth-challenge",
  resourceGroupName: "auth",
  timeoutSeconds: 15,
  environment: {
    OTPIQ_API_KEY: secret("OTPIQ_API_KEY"),
  },
});
