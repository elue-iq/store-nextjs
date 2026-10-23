import type { VerifyAuthChallengeResponseTriggerHandler } from "aws-lambda";
import { timingSafeEqual } from "node:crypto";
import { isLocked, recordWrongCode } from "../limits";

// Accepts Arabic digits too (٠١٢٣ → 0123).
function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
}

export const handler: VerifyAuthChallengeResponseTriggerHandler = async (event) => {
  const expected = Buffer.from(event.request.privateChallengeParameters?.answer ?? "");
  const given = Buffer.from(toLatinDigits(event.request.challengeAnswer ?? ""));
  const phone = (event.request.userAttributes.phone_number ?? "").replace(/^\+/, "");
  // A number with too many wrong codes today can't log in until tomorrow,
  // so a 4-digit code can't be found by trying again and again.
  if (await isLocked(phone)) {
    event.response.answerCorrect = false;
    return event;
  }
  const correct = expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given);
  if (!correct) await recordWrongCode(phone);
  event.response.answerCorrect = correct;
  return event;
};
