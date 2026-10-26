// WhatsApp message the team sends a customer so they can follow their order,
// points and past orders. The customer opens the link, logs in once with the
// WhatsApp code sent to their own number, and sees everything under «طلباتي».
// (Works for orders the customer made and for orders the team made for them.)

import { formatIraqiMobile } from "./phone";

type Who = { name: string; phone: string; orderNumber: string };

function origin(): string {
  return typeof window === "undefined" ? "https://elue-iq.com" : window.location.origin;
}

// Same warm message for both buttons; only the link (and the order number) differ.
function message(o: Who, link: string, withNumber: boolean): string {
  return (
    `مرحباً ${o.name} 🧡\n\n` +
    `شكراً لطلبكم من ÉLUE.\n` +
    `استلمنا طلبكم${withNumber ? ` (${o.orderNumber})` : ""} وراح نجهزه بكل حب وحرص.\n\n` +
    `لمتابعة الطلب:\n${link}\n\n` +
    `قد تحتاجون لتسجيل الدخول من خلال رقم الواتساب ${formatIraqiMobile(o.phone)} 🧡\n\n` +
    `فريق دعم ÉLUE دائماً سعيد بسماع أي اقتراح أو استفسار.`
  );
}

export function shareOrderUrl(o: Who): string {
  const link = `${origin()}/account?order=${encodeURIComponent(o.orderNumber)}`;
  return `https://wa.me/${o.phone}?text=${encodeURIComponent(message(o, link, true))}`;
}

export function shareAccountUrl(o: Who): string {
  return `https://wa.me/${o.phone}?text=${encodeURIComponent(message(o, `${origin()}/account`, false))}`;
}
