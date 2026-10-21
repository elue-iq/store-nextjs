import { NextResponse } from "next/server";
import { formatIraqiMobile, normalizeIraqiMobile, toLatinDigits } from "@/lib/phone";
import { priceCart, type CartItem } from "@/lib/order-text";
import { formatIQD, site } from "@/lib/site";
import { verifyOtpToken } from "@/lib/server/otp";
import { escapeHtml, sendToTelegram } from "@/lib/server/telegram";

// POST { token, code, name, phone, address, note?, items, source? }
//  200 { orderId }                 -> Telegram confirmed the message
//  400 { error: "code_invalid" | "code_expired" | "invalid_order" }
//  502 { error: "send_failed", orderId } -> show the WhatsApp fallback

type Body = {
  token?: unknown;
  code?: unknown;
  name?: unknown;
  phone?: unknown;
  address?: unknown;
  note?: unknown;
  items?: unknown;
  source?: unknown;
};

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function makeOrderId(): string {
  // Short and readable, e.g. EL-MGX4K2. Unique enough without a database.
  const t = Date.now().toString(36).slice(-4).toUpperCase();
  const r = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `EL-${t}${r}`;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;

  const phone = normalizeIraqiMobile(String(body.phone ?? ""));
  const code = toLatinDigits(clean(body.code, 6));
  const token = clean(body.token, 2000);
  if (!phone || !token || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "code_invalid" }, { status: 400 });
  }

  const check = verifyOtpToken(token, phone, code);
  if (check === "expired") return NextResponse.json({ error: "code_expired" }, { status: 400 });
  if (check !== "ok") return NextResponse.json({ error: "code_invalid" }, { status: 400 });

  const name = clean(body.name, 80);
  const address = clean(body.address, 400);
  const note = clean(body.note, 400);
  const source = clean(body.source, 200);
  const items = Array.isArray(body.items) ? (body.items.slice(0, 10) as CartItem[]) : [];
  const { lines, total } = priceCart(items);

  if (!name || address.length < 5 || lines.length === 0) {
    return NextResponse.json({ error: "invalid_order" }, { status: 400 });
  }

  const orderId = makeOrderId();
  // e.g. 2026-10-21 18:36 (Baghdad time)
  const time = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Baghdad",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date());
  const jars = lines.reduce((n, l) => n + l.qty, 0);

  // Telegram shows this message right-to-left. Numbers, phone and English
  // flavor names are wrapped in Unicode isolates so they don't get reversed
  // (without this, 0771 633 5533 shows as 5533 633 0771).
  const ltr = (s: string) => `⁦${s}⁩`;

  const message = [
    `<b>طلب جديد ${ltr(orderId)}</b>`,
    "",
    ...lines.map((l) => `• ${ltr(`${l.qty} × ${escapeHtml(l.product.nameEn)}`)} — ${formatIQD(l.subtotal)}`),
    `عدد العلب: ${jars}`,
    `<b>المجموع: ${formatIQD(total)}</b>`,
    site.paymentNote,
    "",
    `الاسم: ${escapeHtml(name)}`,
    `الرقم: <a href="https://wa.me/${phone}">${ltr(formatIraqiMobile(phone))}</a>`,
    `العنوان: ${escapeHtml(address)}`,
    note ? `ملاحظة: ${escapeHtml(note)}` : null,
    source ? `المصدر: ${ltr(escapeHtml(source))}` : null,
    `الوقت: ${ltr(time)}`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  // Local development without Telegram configured: print the order instead.
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[dev] Order that would go to Telegram:\n${message}`);
      return NextResponse.json({ orderId });
    }
    console.error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing");
    return NextResponse.json({ error: "send_failed", orderId }, { status: 502 });
  }

  const sent = await sendToTelegram(message);
  if (sent) return NextResponse.json({ orderId });
  return NextResponse.json({ error: "send_failed", orderId }, { status: 502 });
}
