import { defineAuth } from "@aws-amplify/backend";
import { preSignUp } from "./pre-sign-up/resource";
import { defineAuthChallenge } from "./define-auth-challenge/resource";
import { createAuthChallenge } from "./create-auth-challenge/resource";
import { verifyAuthChallenge } from "./verify-auth-challenge/resource";

// Customers log in with their Iraqi WhatsApp number only. There are no passwords
// to remember: Cognito's custom sign-in asks our three functions for a 4-digit
// code, which is sent on WhatsApp through OTPIQ.
//
// ADMINS: the ÉLUE team. Members can read and update every order (/admin).
export const auth = defineAuth({
  loginWith: {
    phone: true,
  },
  groups: ["ADMINS"],
  triggers: {
    preSignUp,
    defineAuthChallenge,
    createAuthChallenge,
    verifyAuthChallengeResponse: verifyAuthChallenge,
  },
});
