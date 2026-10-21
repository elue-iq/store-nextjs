import type { PreSignUpTriggerHandler } from "aws-lambda";

// Accounts are created automatically the first time a number is used.
// Only Iraqi mobile numbers (+9647XXXXXXXXX) are accepted. The number is
// marked as verified because the customer proves it with the WhatsApp code
// on every sign-in (no SMS is ever sent by Cognito).
export const handler: PreSignUpTriggerHandler = async (event) => {
  const phone = event.request.userAttributes.phone_number ?? "";
  if (!/^\+9647\d{9}$/.test(phone)) {
    throw new Error("invalid_phone");
  }
  event.response.autoConfirmUser = true;
  event.response.autoVerifyPhone = true;
  return event;
};
