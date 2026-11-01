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
    collect > 0 ? `💵 المبلغ عند الاستلام: ${formatIQD(collect)}` : "✅ لا يُطلب أي مبلغ عند الاستلام",
    `• رقم الطلب: ${o.orderNumber}`,
    "",
  ];
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

// For a delivery team (e.g. تيم الفهود): who, where, what, and how much to collect.
export function courierMessage(o: OrderInfo & { province?: string | null; area?: string | null; address: string; note?: string | null }): string {
  const items = (o.items ?? []).filter((i): i is NonNullable<typeof i> => Boolean(i));
  const jars = o.jars ?? items.reduce((n, i) => n + i.qty, 0);
  const total = o.total ?? 0;
  const delivery = deliveryPayOf(o);
  const collect = (o.paid ? 0 : total) + (delivery === "driver" ? site.deliveryFee : 0);
  const parts = [
    o.paid ? "الطلب مدفوع" : `الطلب ${formatIQD(total)}`,
    delivery === "driver" ? `التوصيل ${formatIQD(site.deliveryFee)}` : delivery === "prepaid" ? "التوصيل مدفوع" : "التوصيل مجاني",
  ];
  const lines = [
    "🛵 طلب توصيل من ÉLUE",
    `• رقم الطلب: ${o.orderNumber}`,
    `• الزبون: ${o.name}`,
    `• الهاتف: \u200E${formatIraqiMobile(o.phone).replace(/ /g, "")}`,
    `• العنوان: ${[o.province, o.area, o.address].filter(Boolean).join("، ")}`,
    o.note ? `• ملاحظة: ${o.note}` : null,
    "",
    "📦 الطلب:",
    ...items.map((i) => `• ${i.nameAr}: ${jarsWord(i.qty)}`),
    `• عدد العلب: ${jars}`,
    "",
    collect > 0 ? `💵 المطلوب من الزبون: ${formatIQD(collect)} (${parts.join(" + ")})` : "✅ لا يُطلب أي مبلغ من الزبون (مدفوع مسبقاً)",
    "",
    "❄️ الطلب يجب أن يبقى مبرّداً حتى التسليم",
    "• بعد التسليم، استرجع بوكس الفلين من الزبون وتأكد من الطلب",
    `📞 للاستفسار: \u200E${site.whatsappDisplay.replace(/ /g, "")}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

export function shareOrderUrl(o: OrderInfo): string {
  return chatUrl(o.phone, orderMessage(o));
}

// From the customer screen: the account link, without an order summary.
export function shareAccountUrl(o: Who): string {
  return chatUrl(o.phone, orderMessage({ name: o.name, phone: o.phone, orderNumber: o.orderNumber }, `${origin()}/account`));
}
