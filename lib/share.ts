// WhatsApp message the team sends a customer so they can follow their order,
// points and past orders. The customer opens the link, logs in once with the
// WhatsApp code sent to their own number, and sees everything under «طلباتي».
// (Works for orders the customer made and for orders the team made for them.)

import { formatIraqiMobile } from "./phone";
import { site } from "./site";

type Who = { name: string; phone: string; orderNumber: string };

function origin(): string {
  return typeof window === "undefined" ? "https://elue-iq.com" : window.location.origin;
}

// Same short message for both buttons; only the link (and the order number) differ.
function message(o: Who, link: string, withNumber: boolean): string {
  const lines = [
    `مرحباً ${o.name} 🧡`,
    `شكراً لطلبكم من ÉLUE، استلمنا طلبكم${withNumber ? ` (${o.orderNumber})` : ""} وراح نجهزه بكل حب وحرص.`,
    "",
    "📦 لمتابعة الطلب:",
    link,
    `🔑 قد تحتاجون لتسجيل الدخول برقم الواتساب: ${formatIraqiMobile(o.phone)}`,
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

export function shareOrderUrl(o: Who): string {
  const link = `${origin()}/account?order=${encodeURIComponent(o.orderNumber)}`;
  return `https://wa.me/${o.phone}?text=${encodeURIComponent(message(o, link, true))}`;
}

export function shareAccountUrl(o: Who): string {
  return `https://wa.me/${o.phone}?text=${encodeURIComponent(message(o, `${origin()}/account`, false))}`;
}
