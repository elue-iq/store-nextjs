import "server-only";

// Sends the verification code on WhatsApp through OTPIQ.
// Docs: https://docs.otpiq.com/api-reference/messaging/post

export type SendResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited"; waitMinutes: number }
  | { ok: false; reason: "failed"; detail: string };

export async function sendWhatsAppCode(phone: string, code: string): Promise<SendResult> {
  const apiKey = process.env.OTPIQ_API_KEY;
  if (!apiKey) return { ok: false, reason: "failed", detail: "OTPIQ_API_KEY is not set" };

  let res: Response;
  try {
    res = await fetch("https://api.otpiq.com/api/sms", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: phone,
        smsType: "verification",
        provider: "whatsapp",
        verificationCode: code,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return { ok: false, reason: "failed", detail: `network: ${String(err)}` };
  }

  if (res.ok) return { ok: true };

  const body = (await res.json().catch(() => ({}))) as { waitMinutes?: number; error?: string; message?: string };
  if (res.status === 429) {
    return { ok: false, reason: "rate_limited", waitMinutes: Number(body.waitMinutes) || 10 };
  }
  return { ok: false, reason: "failed", detail: `${res.status}: ${body.error ?? body.message ?? "unknown"}` };
}
