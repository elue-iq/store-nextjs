// WhatsApp message the team sends a customer: a short text summary of the order
// (flavors, jars, total, delivery, what the driver collects) and the link to
// follow it. The customer opens the link, logs in once with the WhatsApp code sent
// to their own number, and sees everything under «طلباتي».
// (Works for orders the customer made and for orders the team made for them.)

import { formatIraqiMobile } from "./phone";
import { deliveryPayOf, formatIQD, site } from "./site";

type Who = { name: string; phone: string; orderNumber: string };

type OrderInfo = Who & {
  items?: ({ slug: string; nameAr: string; qty: number; price: number } | null)[] | null;
  jars?: number | null;
  total?: number | null;
  paid?: boolean | null;
  freeDelivery?: boolean | null;
  deliveryPaid?: boolean | null;
  province?: string | null;
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

// The order in a few lines, the same facts as the team's Telegram message.
function summary(o: OrderInfo): string[] {
  const items = (o.items ?? []).filter((i): i is NonNullable<typeof i> => Boolean(i));
  if (!items.length || o.total == null) return [];
  const jars = o.jars ?? items.reduce((n, i) => n + i.qty, 0);
  const delivery = deliveryPayOf(o);
  const collect = (o.paid ? 0 : o.total) + (delivery === "driver" ? site.deliveryFee : 0);
  return [
    "🧾 ملخص الطلب:",
    ...items.map((i) => `• ${i.nameAr}: ${jarsWord(i.qty)}`),
    `• المجموع (${jarsWord(jars)}): ${formatIQD(o.total)}${o.paid ? " ✅ مدفوع" : ""}`,
    delivery === "gift"
      ? "• التوصيل: مجاني 🎁"
      : delivery === "prepaid"
        ? "• أجور التوصيل: مدفوعة ✅"
        : `• أجور التوصيل: ${formatIQD(site.deliveryFee)}`,
    o.province === site.baghdadWindow.province ? `• موعد التوصيل: ${site.baghdadWindow.short} (وإذا تعذّر بنفس اليوم يتأجل لليوم التالي)` : null,
    collect > 0 ? `💵 المبلغ عند الاستلام: ${formatIQD(collect)}` : "✅ لا يُطلب أي مبلغ عند الاستلام",
    `• رقم الطلب: ${o.orderNumber}`,
    "",
  ].filter((l): l is string => l !== null);
}

// The message for the customer. With the order's items it starts with the summary.
export function orderMessage(o: OrderInfo, link = `${origin()}/account?order=${encodeURIComponent(o.orderNumber)}`): string {
  const lines = [
    `مرحباً ${o.name} 🧡`,
    "شكراً لطلبكم من ÉLUE، استلمنا طلبكم وراح نجهزه بكل حب وحرص.",
    "",
    ...summary(o),
    "📦 لمتابعة الطلب:",
    link,
    // Digits without spaces (and a left-to-right mark) so the number never flips in Arabic text.
    `🔑 قد تحتاجون لتسجيل الدخول برقم الواتساب: ‎${formatIraqiMobile(o.phone).replace(/ /g, "")}`,
    "",
    `❄️ ${site.coldNote.title}`,
    "• منتجاتنا بلا مواد حافظة أو سكر مضاف أو دهون مضافة، لذلك يلزم أن تبقى مبرّدة",
    "• عند الاستلام، نرجو تسليم بوكس الفلين للمندوب ووضع المنتج في البراد مباشرة",
    `• في حال وصول طلبكم غير مبرّد، يرجى التواصل معنا فوراً 📞 ${site.whatsappDisplay.replace(/ /g, "")}`,
    "",
    "💬 يسعدنا سماع اقتراحاتكم واستفساراتكم",
    `${site.coldNote.thanks} 🧡`,
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
    "*بأقل من 20 ثانية قيّم تجربتك*",
    "",
    `مرحباً ${o.name.trim().split(/\s+/)[0]} 🧡`,
    "",
    "رأيك يهمنا فعلاً، لأن كل ملاحظة منك تساعدنا نتطور ونقدم تجربة أحلى",
    "",
    `${origin}/review?order=${encodeURIComponent(o.orderNumber)}`,
    "",
    "شكراً لاختياركم ÉLUE",
  ].join("\n");
}

// From the courier to the customer, once the order is on its way (sent from the courier's own WhatsApp).
export function courierComingMessage(o: OrderInfo, courierName: string): string {
  return [
    `مرحباً ${o.name} 🧡`,
    `أنا ${courierName}، مندوب توصيل ÉLUE. طلبكم ${o.orderNumber} بالطريق إليكم الآن 🚗`,
    "",
    ...summary(o),
    `❄️ ${site.coldNote.title}`,
    "• عند الاستلام، نرجو تسليم بوكس الفلين لي ووضع المنتج في البراد مباشرة",
    "",
    "📞 إذا احتجتم أي شيء، تواصلوا معي على هذا الرقم.",
  ].join("\n");
}
