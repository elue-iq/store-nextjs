import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

// Stateless OTP. Nothing is stored anywhere.
//
// send-code returns a token that contains the phone number, the expiry time,
// and a fingerprint of the code: HMAC(secret, phone:code:expiry).
// The code itself is never in the token, so the browser can't read it.
// place-order recomputes the fingerprint from what the customer typed and
// compares. Changing the phone or the expiry in the token breaks the match.

const CODE_TTL_MS = 5 * 60 * 1000;

function secret(): string {
  const s = process.env.OTP_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("OTP_SECRET must be set (32+ characters) in production");
  }
  return "dev-only-secret-do-not-use-in-production-000000";
}

function fingerprint(phone: string, code: string, exp: number): string {
  return createHmac("sha256", secret()).update(`${phone}:${code}:${exp}`).digest("base64url");
}

export function newCode(): string {
  return String(randomInt(100000, 1000000));
}

export function createOtpToken(phone: string, code: string): string {
  const exp = Date.now() + CODE_TTL_MS;
  const payload = { p: phone, e: exp, f: fingerprint(phone, code, exp) };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export type OtpCheck = "ok" | "expired" | "invalid";

export function verifyOtpToken(token: string, phone: string, code: string): OtpCheck {
  let payload: { p?: unknown; e?: unknown; f?: unknown };
  try {
    payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return "invalid";
  }
  const { p, e, f } = payload;
  if (typeof p !== "string" || typeof e !== "number" || typeof f !== "string") return "invalid";
  if (p !== phone) return "invalid";
  if (Date.now() > e) return "expired";

  const expected = Buffer.from(fingerprint(phone, code, e));
  const given = Buffer.from(f);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return "invalid";
  return "ok";
}
