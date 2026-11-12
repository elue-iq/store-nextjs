// WhatsApp message the team sends a customer: a short text summary of the order
// (flavors, jars, total, delivery, what the driver collects) and the link to
// follow it. The customer opens the link, logs in once with the WhatsApp code sent
// to their own number, and sees everything under «طلباتي».
// (Works for orders the customer made and for orders the team made for them.)

import { formatIraqiMobile } from "./phone";
import { deliveryPayOf, formatIQD, minusIQD, site } from "./site";
import { slotText } from "./delivery-slot";
import { giftLines, paidLines } from "./gifts";

type Who = { name: string; phone: string; orderNumber: string };

type OrderInfo = Who & {
  items?: ({ slug: string; nameAr: string; qty: number; price: number; gift?: boolean | null } | null)[] | null;
  jars?: number | null;
  total?: number | null;
  paid?: boolean | null;
  freeDelivery?: boolean | null;
  deliveryPaid?: boolean | null;
  province?: string | null;
  deliverySlot?: string | null;
  deliveryDate?: string | null;
  discount?: number | null;
  creditUsed?: number | null;
  couponCode?: string | null;
  couponLabel?: string | null;
  cashback?: number | null;
};

function origin(): string {
  return typeof window === "undefined" ? "https://elue-iq.com" : window.location.origin;
}

function jarsWord(n: number): string {
  if (n === 1) return "علبة واحدة";
  if (n === 2) return "علبتان";
  if (n <= 10) return `${n} علب`;
  return `${n} علبة`;
}

// The order in a few lines: what, what to pay on delivery, when, and the number.
function summary(o: OrderInfo): string[] {
  const items = (o.items ?? []).filter((i): i is NonNullable<typeof i> => Boolean(i));
  if (!items.length || o.total == null) return [];
  const delivery = deliveryPayOf(o);
  const collect = (o.paid ? 0 : o.total) + (delivery === "driver" ? site.deliveryFee : 0);
  return [
    `• ${paidLines(items).map((i) => `${i.nameAr} × ${i.qty}`).join("، ")}`,
    giftLines(items).length ? `🎁 هدية من ÉLUE: ${giftLines(items).map((i) => `${i.nameAr} × ${i.qty}`).join("، ")}` : null,
    o.discount ? `🎁 ${o.couponLabel ?? "خصم"}: ${minusIQD(o.discount)}` : null,
    o.creditUsed ? `🎁 من رصيدكم: ${minusIQD(o.creditUsed)}` : null,
    o.cashback ? `🎁 تنضاف لرصيدكم ${formatIQD(o.cashback)} بعد التسليم` : null,
    collect > 0 ? `💵 عند الاستلام: ${formatIQD(collect)}${delivery === "driver" ? " (شامل التوصيل)" : ""}` : "✅ مدفوع، ولا يُطلب شي عند الاستلام",
    o.province === site.baghdadWindow.province ? `🕐 التوصيل: ${slotText(o) ?? site.baghdadWindow.short}` : null,
    `🔖 ${o.orderNumber}`,
  ].filter((l): l is string => l !== null);
}

// The message for the customer (short: it is read on a phone, in one screen).
export function orderMessage(o: OrderInfo, link = `${origin()}/account?order=${encodeURIComponent(o.orderNumber)}`): string {
  const lines = [
    `مرحباً ${o.name} 🧡`,
    "استلمنا طلبكم من ÉLUE وراح نجهزه بكل حب وحرص.",
    "",
    ...summary(o),
    "",
    `📦 تابعوا طلبكم: ${link}`,
    "",
    "❄️ يُحفظ دائماً بالبراد",
  ];
  return lines.join("\n");
}

// Opens that number's WhatsApp chat with the message ready to send. Without a
// number, WhatsApp asks which chat (or group) to send it to.
export function chatUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function shareOrderUrl(o: OrderInfo): string {
  return chatUrl(o.phone, orderMessage(o));
}

// From the customer screen: the account link, without an order summary.
export function shareAccountUrl(o: Who): string {
  return chatUrl(o.phone, orderMessage({ name: o.name, phone: o.phone, orderNumber: o.orderNumber }, `${origin()}/account`));
}

// Asks a customer for their review after delivery (the team sends it on WhatsApp).
export function reviewRequestMessage(o: { name: string; orderNumber: string }, origin: string): string {
  return [
    "*بأقل من 20 ثانية قيّموا تجربتكم*",
    "",
    `مرحباً ${o.name.trim().split(/\s+/)[0]} 🧡`,
    "",
    "تقييمكم كلش يهمنا، لأن كل ملاحظة تساعدنا نتطور ونقدم تجربة أحلى وأفضل 😍",
    "",
    `${origin}/review?order=${encodeURIComponent(o.orderNumber)}`,
    "",
    "شكراً لاختياركم ÉLUE",
  ].join("\n");
}

// A gentle second ask, when the first request got no review.
export function reviewReminderMessage(o: { name: string; orderNumber: string }, origin: string): string {
  return [
    `مرحباً ${o.name.trim().split(/\s+/)[0]} 🧡`,
    "",
    "نتمنى عجبكم طلبكم من ÉLUE. إذا عندكم 20 ثانية، رأيكم يفرق ويانا كلش:",
    "",
    `${origin}/review?order=${encodeURIComponent(o.orderNumber)}`,
    "",
    "وإذا صار أي شي ما عجبكم، گولولنا هنا ونصلحه 🙏",
  ].join("\n");
}

// From the courier to the customer, once the order is on its way (sent from the courier's own WhatsApp).
export function courierComingMessage(o: OrderInfo, courierName: string): string {
  return [
    `مرحباً ${o.name} 🧡`,
    `أنا ${courierName}، مندوب توصيل ÉLUE. طلبكم ${o.orderNumber} بالطريق إليكم الآن 🚗`,
    "",
    ...summary(o),
    "",
    "❄️ يُحفظ دائماً بالبراد",
    "📞 إذا احتجتم أي شي، تواصلوا معي على هذا الرقم.",
  ].join("\n");
}
