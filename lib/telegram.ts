// Telegram order message. Used by the place-order function (AWS Lambda).
// Plain TypeScript with relative imports only, so it bundles into the function.

import { formatIraqiMobile } from "./phone";
import { collectStatement, deliveryPayOf, formatIQD, payMethodText, site } from "./site";
import type { OrderLine } from "./order-text";
import { fullAddress } from "./iraq";
import { slotText } from "./delivery-slot";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Telegram shows the message right-to-left. Numbers, the phone and English
// flavor names are wrapped in Unicode isolates so they keep their order.
const ltr = (s: string) => `⁦${s}⁩`;

export function buildOrderMessage(o: {
  orderNumber: string;
  time: string;
  lines: OrderLine[];
  total: number;
  name: string;
  phone: string; // 9647XXXXXXXXX
  province: string;
  area: string;
  address: string;
  note?: string | null;
  deliverySlot?: string | null; // Baghdad delivery period
  deliveryDate?: string | null; // wanted day (YYYY-MM-DD)
  source?: string | null;
  returning: boolean;
  createdBy?: string | null; // team member who placed it for the customer
  cashierOrderId?: string | null;
  paid?: boolean | null; // customer already paid the jars
  paidNote?: string | null;
  payMethod?: string | null; // QI | ZAINCASH | OTHER | GIFT
  payRef?: string | null; // transaction / transfer number
  freeDelivery?: boolean | null; // ÉLUE covers the delivery fee (gift)
  deliveryPaid?: boolean | null; // customer already paid the delivery fee
}): string {
  const jars = o.lines.reduce((n, l) => n + l.qty, 0);
  const delivery = deliveryPayOf(o);
  const collect = (o.paid ? 0 : o.total) + (delivery === "driver" ? site.deliveryFee : 0);
  // How it was paid: "Qi Card · رقم العملية 123".
  const how = [o.payMethod ? payMethodText(o) : o.paidNote, o.payRef ? `رقم العملية ${ltr(o.payRef)}` : null]
    .filter(Boolean)
    .map((t, i) => (i === 0 ? escapeHtml(String(t)) : String(t)))
    .join(" · ");
  const special = [
    o.payMethod === "GIFT" ? "هدية من ÉLUE: العلب مجاناً" : o.paid ? `مدفوع مسبقاً${how ? ` (${how})` : ""}` : null,
    delivery === "gift" ? "توصيل مجاني هدية (نتحمّل الأجور)" : null,
    delivery === "prepaid" ? `أجور التوصيل مدفوعة مسبقاً${!o.paid && how ? ` (${how})` : ""}` : null,
  ].filter(Boolean);
  return [
    `<b>طلب جديد ${ltr(o.orderNumber)}</b>${o.returning ? " · عميل سابق" : ""}`,
    "",
    ...o.lines.map((l) => `• ${ltr(`${l.qty} × ${escapeHtml(l.product.nameEn)}`)} — ${formatIQD(l.subtotal)}`),
    `عدد العلب: ${jars}`,
    `<b>المجموع: ${formatIQD(o.total)}</b>`,
    special.length ? `<b>${special.join(" · ")}</b>` : null,
    `<b>يستلم المندوب من العميل: ${formatIQD(collect)}</b>`,
    collectStatement(o.total, Boolean(o.paid), delivery),
    o.paid || delivery !== "driver" ? null : site.paymentNote,
    site.courierNote,
    "",
    `الاسم: ${escapeHtml(o.name)}`,
    `الرقم: <a href="https://wa.me/${o.phone}">${ltr(formatIraqiMobile(o.phone))}</a>`,
    `العنوان: ${escapeHtml(fullAddress(o))}`,
    o.note ? `ملاحظة: ${escapeHtml(o.note)}` : null,
    slotText(o) ? `<b>موعد التوصيل: ${slotText(o)}</b>` : null,
    o.source ? `المصدر: ${ltr(escapeHtml(o.source))}` : null,
    `الوقت: ${ltr(o.time)}`,
    o.createdBy ? `أنشأه الفريق: ${ltr(formatIraqiMobile(o.createdBy))}` : null,
    o.cashierOrderId ? `رقم الكاشير: ${ltr(escapeHtml(o.cashierOrderId))}` : null,
    "",
    `<a href="${site.address}/admin?order=${encodeURIComponent(o.orderNumber)}">فتح الطلب في لوحة الطلبات</a>`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

// Up to 3 tries within a fixed time budget, so a slow Telegram never delays
// the customer's confirmation: the order is already saved before this runs.
const RETRY_DELAYS_MS = [0, 500, 1000];

export async function sendToTelegram(
  token: string,
  chatId: string,
  html: string,
  budgetMs = 9_000,
): Promise<boolean> {
  if (!token || !chatId) return false;
  const deadline = Date.now() + budgetMs;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const left = deadline - Date.now();
    if (left < 1_000) break;
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(Math.min(4_000, left)),
      });
      if (res.ok) return true;
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.error("Telegram rejected the message:", res.status, await res.text().catch(() => ""));
        return false;
      }
    } catch (err) {
      console.error("Telegram request failed:", err);
    }
  }
  return false;
}

// One message to one chat (a courier's channel or group), with the reason when
// Telegram refuses, so the admin can fix the chat id. Two tries for network or
// server hiccups; a clear refusal (wrong id, bot not in the chat) is not retried.
export type TelegramResult = { ok: true } | { ok: false; error: string };

export function telegramReason(description: string): string {
  const d = description.toLowerCase();
  if (d.includes("chat not found")) return "لم يجد تيليغرام هذه القناة: تأكد من الرقم، وأن البوت مضاف إليها كمشرف.";
  if (d.includes("not a member") || d.includes("kicked") || d.includes("bot was blocked")) return "البوت غير مضاف إلى هذه القناة أو المجموعة. أضفه كمشرف.";
  if (d.includes("not enough rights") || d.includes("have no rights") || d.includes("need administrator")) return "البوت في القناة لكن بلا صلاحية النشر. اجعله مشرفاً يستطيع إرسال الرسائل.";
  if (d.includes("group chat was upgraded")) return "تحوّلت المجموعة إلى مجموعة كبيرة وتغيّر رقمها. استخدم الرقم الجديد.";
  return description.slice(0, 160) || "رفض تيليغرام الرسالة.";
}

export async function telegramSend(token: string, chatId: string, html: string): Promise<TelegramResult> {
  if (!token) return { ok: false, error: "بوت تيليغرام غير مضبوط." };
  if (!chatId) return { ok: false, error: "لا يوجد رقم قناة تيليغرام." };
  let last = "تعذّر الاتصال بتيليغرام.";
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 700));
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", link_preview_options: { is_disabled: true } }),
        signal: AbortSignal.timeout(6_000),
      });
      if (res.ok) return { ok: true };
      const body = (await res.json().catch(() => ({}))) as { description?: string };
      last = telegramReason(body.description ?? `HTTP ${res.status}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return { ok: false, error: last };
    } catch (err) {
      console.error("Telegram request failed:", err);
    }
  }
  return { ok: false, error: last };
}
