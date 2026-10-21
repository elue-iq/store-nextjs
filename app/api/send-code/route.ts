import { NextResponse } from "next/server";
import { normalizeIraqiMobile } from "@/lib/phone";
import { createOtpToken, newCode } from "@/lib/server/otp";
import { sendWhatsAppCode } from "@/lib/server/otpiq";

// POST { phone } -> { token } (and { devCode } when running locally without OTPIQ)

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { phone?: unknown };
  const phone = normalizeIraqiMobile(String(body.phone ?? ""));
  if (!phone) return NextResponse.json({ error: "invalid_phone" }, { status: 400 });

  const code = newCode();
  const token = createOtpToken(phone, code);

  // Local development without an OTPIQ key: show the code instead of sending it.
  if (!process.env.OTPIQ_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      console.error("OTPIQ_API_KEY is missing");
      return NextResponse.json({ error: "send_failed" }, { status: 500 });
    }
    console.log(`[dev] WhatsApp code for ${phone}: ${code}`);
    return NextResponse.json({ token, devCode: code });
  }

  const result = await sendWhatsAppCode(phone, code);
  if (result.ok) return NextResponse.json({ token });

  if (result.reason === "rate_limited") {
    return NextResponse.json({ error: "rate_limited", waitMinutes: result.waitMinutes }, { status: 429 });
  }
  console.error("OTPIQ send failed:", result.detail);
  return NextResponse.json({ error: "send_failed" }, { status: 502 });
}
