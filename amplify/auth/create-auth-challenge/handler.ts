import type { CreateAuthChallengeTriggerHandler } from "aws-lambda";
import { randomInt } from "node:crypto";
import { env } from "$amplify/env/create-auth-challenge";
import { allowNewCode } from "../limits";

// Creates the 4-digit code and sends it on WhatsApp through OTPIQ.
// On a retry (wrong code) the same code is reused, so the customer isn't
// sent a second message. The code is kept in challengeMetadata, which the
// browser never sees.

const CODE_LENGTH = 4;

async function sendWhatsApp(phoneDigits: string, code: string) {
  const res = await fetch("https://api.otpiq.com/api/sms", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OTPIQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      phoneNumber: phoneDigits,
      smsType: "verification",
      provider: "whatsapp",
      verificationCode: code,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) throw new Error("rate_limited");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("OTPIQ failed", res.status, body.slice(0, 300));
    throw new Error("send_failed");
  }
}

export const handler: CreateAuthChallengeTriggerHandler = async (event) => {
  if (event.request.challengeName !== "CUSTOM_CHALLENGE") return event;

  const previous = (event.request.session ?? [])
    .map((s) => s.challengeMetadata ?? "")
    .reverse()
    .find((m) => m.startsWith("CODE-"));

  let code: string;
  if (previous) {
    code = previous.slice("CODE-".length);
  } else {
    code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
    const phone = (event.request.userAttributes.phone_number ?? "").replace(/^\+/, "");
    await allowNewCode(phone); // limits per number and overall (see ../limits.ts)
    await sendWhatsApp(phone, code);
  }

  event.response.publicChallengeParameters = { length: String(CODE_LENGTH) };
  event.response.privateChallengeParameters = { answer: code };
  event.response.challengeMetadata = `CODE-${code}`;
  return event;
};
