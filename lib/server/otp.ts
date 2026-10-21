import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { CODE_LENGTH } from "@/lib/validate";

// Stateless OTP. Nothing is stored in a database.
//
// send-code returns a token that contains the phone number, the expiry time,
// and a fingerprint of the code: HMAC(secret, phone:code:expiry).
// The code itself is never in the token, so the browser can't read it.
// place-order recomputes the fingerprint from what the customer typed and
// compares. Changing the phone or the expiry in the token breaks the match.
//
// Wrong tries: a 4-digit code needs a limit on guesses. Without a database
// the limit below lives in the server's memory, so it is best-effort (each
// server instance counts on its own). The hard limit is a Vercel Firewall
// rate-limit rule on /api/place-order (see README).

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_WRONG_TRIES = 5;

const wrongTries = new Map<string, { count: number; expires: number }>();

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
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

export function createOtpToken(phone: string, code: string): string {
  const exp = Date.now() + CODE_TTL_MS;
  const payload = { p: phone, e: exp, f: fingerprint(phone, code, exp) };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export type OtpCheck = "ok" | "expired" | "invalid" | "locked";

function forget(now: number) {
  for (const [key, entry] of wrongTries) if (entry.expires < now) wrongTries.delete(key);
}

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

  const now = Date.now();
  if (now > e) return "expired";

  forget(now);
  const tries = wrongTries.get(f);
  if (tries && tries.count >= MAX_WRONG_TRIES) return "locked";

  const expected = Buffer.from(fingerprint(phone, code, e));
  const given = Buffer.from(f);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    const count = (tries?.count ?? 0) + 1;
    wrongTries.set(f, { count, expires: e });
    return count >= MAX_WRONG_TRIES ? "locked" : "invalid";
  }
  return "ok";
}
