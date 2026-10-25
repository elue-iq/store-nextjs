// Telegram order message. Used by the place-order function (AWS Lambda).
// Plain TypeScript with relative imports only, so it bundles into the function.

import { formatIraqiMobile } from "./phone";
import { collectStatement, formatIQD, site } from "./site";
import type { OrderLine } from "./order-text";
import { fullAddress } from "./iraq";

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
  source?: string | null;
  returning: boolean;
  createdBy?: string | null; // team member who placed it for the customer
  cashierOrderId?: string | null;
  paid?: boolean | null; // customer already paid the jars
  paidNote?: string | null;
  freeDelivery?: boolean | null; // ÉLUE covers the delivery fee
}): string {
  const jars = o.lines.reduce((n, l) => n + l.qty, 0);
  const collect = (o.paid ? 0 : o.total) + (o.freeDelivery ? 0 : site.deliveryFee);
  const special = [
    o.paid ? `مدفوع مسبقاً${o.paidNote ? ` (${escapeHtml(o.paidNote)})` : ""}` : null,
    o.freeDelivery ? "توصيل مجاني (نتحمّل الأجور)" : null,
  ].filter(Boolean);
  return [
    `<b>طلب جديد ${ltr(o.orderNumber)}</b>${o.returning ? " · عميل سابق" : ""}`,
    "",
    ...o.lines.map((l) => `• ${ltr(`${l.qty} × ${escapeHtml(l.product.nameEn)}`)} — ${formatIQD(l.subtotal)}`),
    `عدد العلب: ${jars}`,
    `<b>المجموع: ${formatIQD(o.total)}</b>`,
    special.length ? `<b>${special.join(" · ")}</b>` : null,
    `<b>يستلم المندوب من العميل: ${formatIQD(collect)}</b>`,
    collectStatement(o.total, Boolean(o.paid), Boolean(o.freeDelivery)),
    o.paid || o.freeDelivery ? null : site.paymentNote,
    site.courierNote,
    "",
    `الاسم: ${escapeHtml(o.name)}`,
    `الرقم: <a href="https://wa.me/${o.phone}">${ltr(formatIraqiMobile(o.phone))}</a>`,
    `العنوان: ${escapeHtml(fullAddress(o))}`,
    o.note ? `ملاحظة: ${escapeHtml(o.note)}` : null,
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
