// Messages about delivery: the order sent to a local courier (Telegram), and the
// problem report sent to a courier or to Modon support (Telegram or WhatsApp).
// Plain TypeScript with relative imports only, so it bundles into a function and
// also runs in the browser.

import { itemNameAr, piecesOf } from "./gifts";
import { formatIraqiMobile } from "./phone";
import { fullAddress } from "./iraq";
import { deliveryPayOf, formatIQD, payMethodText, site } from "./site";
import { escapeHtml } from "./telegram";
import { slotText } from "./delivery-slot";

export type DispatchOrder = {
  orderNumber: string;
  name: string;
  phone: string; // 9647XXXXXXXXX
  phone2?: string | null; // optional second number
  province?: string | null;
  area?: string | null;
  address: string;
  note?: string | null;
  deliverySlot?: string | null; // Baghdad delivery period
  deliveryDate?: string | null; // wanted day (YYYY-MM-DD)
  items?: ({ slug?: string; nameAr: string; qty: number; gift?: boolean | null } | null)[] | null;
  jars?: number | null; // paid jars
  giftUnits?: number | null; // gift jars in the same parcel (lib/gifts.ts)
  total: number;
  paid?: boolean | null;
  freeDelivery?: boolean | null;
  deliveryPaid?: boolean | null;
  payMethod?: string | null;
  paidNote?: string | null;
  status?: string | null;
  modonQr?: string | null;
  modonStatus?: string | null;
  courierName?: string | null;
  courierSentAt?: string | null;
};

// Problem kinds the admin picks from (the text goes into the report as written).
export const ISSUE_KINDS = [
  ["late", "تأخّر الطلب"],
  ["no_answer", "الزبون لا يرد"],
  ["bad_address", "العنوان غير واضح أو غير صحيح"],
  ["refused", "الزبون رفض الاستلام"],
  ["not_cold", "الطلب وصل غير مبرّد أو تالف"],
  ["wrong_amount", "خطأ في المبلغ المطلوب"],
  ["other", "مشكلة أخرى"],
] as const;

export type IssueKind = (typeof ISSUE_KINDS)[number][0];

export function issueLabel(kind: string): string {
  return ISSUE_KINDS.find(([k]) => k === kind)?.[1] ?? kind;
}

const STATUS_AR: Record<string, string> = {
  NEW: "جديد",
  CONFIRMED: "مؤكَّد",
  OUT_FOR_DELIVERY: "قيد التوصيل",
  DELIVERED: "تم التوصيل",
  CANCELLED: "ملغى",
};

function jarsWord(n: number): string {
  if (n === 1) return "علبة واحدة";
  if (n === 2) return "علبتان";
  if (n <= 10) return `${n} علب`;
  return `${n} علبة`;
}

function baghdadTime(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

// What the driver takes from the customer.
export function collectAmount(o: Pick<DispatchOrder, "total" | "paid" | "freeDelivery" | "deliveryPaid">): number {
  return (o.paid ? 0 : o.total) + (deliveryPayOf(o) === "driver" ? site.deliveryFee : 0);
}

function collectParts(o: DispatchOrder): string {
  const delivery = deliveryPayOf(o);
  return [
    o.paid ? "الطلب مدفوع" : `الطلب ${formatIQD(o.total)}`,
    delivery === "driver" ? `التوصيل ${formatIQD(site.deliveryFee)}` : delivery === "prepaid" ? "التوصيل مدفوع" : "التوصيل مجاني",
  ].join(" + ");
}

// Numbers keep their order inside Arabic text (Telegram shows it right-to-left).
const ltr = (s: string) => `⁦${s}⁩`;

type Style = { esc: (s: string) => string; b: (s: string) => string; num: (s: string) => string };
const HTML: Style = { esc: escapeHtml, b: (s) => `<b>${s}</b>`, num: ltr };
const PLAIN: Style = { esc: (s) => s, b: (s) => `*${s}*`, num: (s) => `‎${s}` };

function itemLines(o: DispatchOrder, st: Style): string[] {
  return (o.items ?? []).filter((i): i is NonNullable<typeof i> => Boolean(i)).map((i) => `• ${st.esc(itemNameAr(i))}: ${jarsWord(i.qty)}`);
}

// A new order for a local courier. Kept short on purpose: the driver is busy.
// Order number, phone numbers, address, note (if any), items, and what to collect.
function courierText(o: DispatchOrder, st: Style, test: boolean): string {
  const collect = collectAmount(o);
  const phones = [o.phone, o.phone2].filter((p): p is string => Boolean(p)).map((p) => st.num(formatIraqiMobile(p).replace(/ /g, "")));
  return [
    test ? "🧪 نسخة تجريبية: لا تنفّذ هذا الطلب" : null,
    `🛵 ${st.b(st.num(o.orderNumber))}`,
    `📞 ${phones.join(" / ")}`,
    `📍 ${st.esc(fullAddress(o))}`,
    o.note ? `📝 ${st.esc(o.note)}` : null,
    o.province === site.baghdadWindow.province && slotText(o) ? `🕐 ${st.b(slotText(o)!)}` : null,
    "",
    ...(o.items ?? []).filter((i): i is NonNullable<typeof i> => Boolean(i)).map((i) => `• ${st.esc(itemNameAr(i))} × ${st.num(String(i.qty))}`),
    o.giftUnits ? `📦 ${st.b(`عدد العلب: ${st.num(String(piecesOf(o)))}`)} (منها ${st.num(String(o.giftUnits))} هدية)` : null,
    "",
    collect > 0 ? `💵 ${st.b(formatIQD(collect))} (شامل التوصيل)` : "✅ مدفوع: لا يُطلب شيء",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export const courierHtml = (o: DispatchOrder, test = false) => courierText(o, HTML, test);

// The order was taken away from this courier (changed to another, or cancelled).
export function courierCancelHtml(o: Pick<DispatchOrder, "orderNumber" | "name">, why: "cancelled" | "reassigned" | "withdrawn"): string {
  const reason = {
    cancelled: "تم إلغاء الطلب. لا تنفّذه.",
    reassigned: "أُسند هذا الطلب إلى جهة توصيل أخرى. لا تنفّذه.",
    withdrawn: "سُحب هذا الطلب منك. لا تنفّذه.",
  }[why];
  return [`❌ ${HTML.b("أُلغي طلب التوصيل")} ${ltr(o.orderNumber)}`, `الزبون: ${escapeHtml(o.name)}`, reason].join("\n");
}

// A problem report with everything the receiver needs to find the order.
function issueText(o: DispatchOrder, kind: string, text: string, st: Style, to: string): string {
  const collect = collectAmount(o);
  const pay = o.paid || o.deliveryPaid || o.payMethod ? payMethodText(o) : null;
  return [
    `⚠️ ${st.b("مشكلة في توصيل طلب ÉLUE")}`,
    `إلى: ${st.esc(to)}`,
    "",
    `• نوع المشكلة: ${st.b(issueLabel(kind))}`,
    text.trim() ? `• التفاصيل: ${st.esc(text.trim())}` : null,
    "",
    `• رقم الطلب: ${st.num(o.orderNumber)}`,
    o.modonQr ? `• رقم مدن: ${st.num(o.modonQr)}` : null,
    o.modonQr && o.modonStatus ? `• حالته لدى مدن: ${st.esc(o.modonStatus)}` : null,
    o.status ? `• حالة الطلب لدينا: ${STATUS_AR[o.status] ?? o.status}` : null,
    o.courierSentAt ? `• أُرسل للتوصيل: ${st.num(baghdadTime(o.courierSentAt))}` : null,
    `• الزبون: ${st.esc(o.name)}`,
    `• الهاتف: ${st.num(formatIraqiMobile(o.phone).replace(/ /g, ""))}`,
    `• العنوان: ${st.esc(fullAddress(o))}`,
    o.note ? `• ملاحظة الطلب: ${st.esc(o.note)}` : null,
    "",
    ...itemLines(o, st),
    collect > 0 ? `• المطلوب من الزبون: ${formatIQD(collect)} (${collectParts(o)})` : "• مدفوع بالكامل: لا يُطلب شيء من الزبون",
    pay ? `• الدفع: ${st.esc(pay)}` : null,
    "",
    `للتواصل مع ÉLUE: ${st.num(site.whatsappDisplay.replace(/ /g, ""))}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

// Telegram (a local courier's channel) and WhatsApp (Modon support).
export const issueHtml = (o: DispatchOrder, kind: string, text: string, to: string) => issueText(o, kind, text, HTML, to);
export const issuePlain = (o: DispatchOrder, kind: string, text: string, to: string) => issueText(o, kind, text, PLAIN, to);

export function modonSupportUrl(message: string): string {
  return `https://wa.me/${site.modonSupport.whatsapp}?text=${encodeURIComponent(message)}`;
}

// A Telegram chat id: a number (channels and groups start with -100 / -) or @name of a public channel.
export function chatIdError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "اكتب رقم قناة تيليغرام.";
  if (/^-?\d{5,20}$/.test(v) || /^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v)) return null;
  return "الصيغة غير صحيحة: رقم مثل -1001234567890 أو اسم القناة العامة مثل @my_channel.";
}
