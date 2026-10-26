// WhatsApp message the team sends a customer so they can follow their order,
// points and past orders. The customer opens the link, logs in once with the
// WhatsApp code sent to their own number, and sees everything under «طلباتي».
// (Works for orders the customer made and for orders the team made for them.)

import { formatIraqiMobile } from "./phone";

type Who = { name: string; phone: string; orderNumber: string };

function origin(): string {
  return typeof window === "undefined" ? "https://elue-iq.com" : window.location.origin;
}

export function shareOrderUrl(o: Who): string {
  const link = `${origin()}/account?order=${encodeURIComponent(o.orderNumber)}`;
  const text =
    `مرحباً ${o.name}، سجّلنا طلبك ${o.orderNumber} من ÉLUE.\n` +
    `تابع حالة الطلب ونقاطك من هنا:\n${link}\n` +
    `سجّل الدخول برقم الواتساب ${formatIraqiMobile(o.phone)}، يصلك رمز على الواتساب.`;
  return `https://wa.me/${o.phone}?text=${encodeURIComponent(text)}`;
}

export function shareAccountUrl(o: Who): string {
  const link = `${origin()}/account`;
  const text =
    `مرحباً ${o.name}، هذا رابط حسابك في ÉLUE لمتابعة طلباتك ونقاطك:\n${link}\n` +
    `سجّل الدخول برقم الواتساب ${formatIraqiMobile(o.phone)}، يصلك رمز على الواتساب.`;
  return `https://wa.me/${o.phone}?text=${encodeURIComponent(text)}`;
}
