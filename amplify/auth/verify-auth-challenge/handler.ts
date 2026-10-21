import type { VerifyAuthChallengeResponseTriggerHandler } from "aws-lambda";
import { timingSafeEqual } from "node:crypto";

// Accepts Arabic digits too (٠١٢٣ → 0123).
function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
}

export const handler: VerifyAuthChallengeResponseTriggerHandler = async (event) => {
  const expected = Buffer.from(event.request.privateChallengeParameters?.answer ?? "");
  const given = Buffer.from(toLatinDigits(event.request.challengeAnswer ?? ""));
  event.response.answerCorrect = expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given);
  return event;
};
