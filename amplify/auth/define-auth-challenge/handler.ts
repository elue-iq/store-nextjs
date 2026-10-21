import type { DefineAuthChallengeTriggerHandler } from "aws-lambda";

// Sign-in steps: ask for the WhatsApp code; log in when it's right.
// Up to 3 tries per code. After that the sign-in fails and the customer
// requests a new code.
const MAX_TRIES = 3;

export const handler: DefineAuthChallengeTriggerHandler = async (event) => {
  const session = event.request.session ?? [];
  const last = session[session.length - 1];

  if (last && last.challengeName === "CUSTOM_CHALLENGE" && last.challengeResult === true) {
    event.response.issueTokens = true;
    event.response.failAuthentication = false;
  } else if (session.length >= MAX_TRIES) {
    event.response.issueTokens = false;
    event.response.failAuthentication = true;
  } else {
    event.response.issueTokens = false;
    event.response.failAuthentication = false;
    event.response.challengeName = "CUSTOM_CHALLENGE";
  }
  return event;
};
