import { defineFunction } from "@aws-amplify/backend";

export const verifyAuthChallenge = defineFunction({
  name: "verify-auth-challenge",
  resourceGroupName: "auth",
});
