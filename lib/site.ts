// Everything a non-developer might want to change lives here.

export const site = {
  name: "ÉLUE",
  // WhatsApp number used for the "send the order on WhatsApp" fallback button.
  // International format, digits only (07716335533 -> 9647716335533).
  whatsappNumber: "9647716335533",
  whatsappDisplay: "0771 633 5533",
  instagramUrl: "https://www.instagram.com/elue.iq",
  instagramHandle: "@elue.iq",
  // Shown on the order page. Change it if you start taking online payments.
  paymentNote: "الدفع نقداً عند الاستلام",
  // Who the WhatsApp code comes from. OTPIQ's default sender shows as
  // "Premium Technology" (+1 555 335 9750), not ELUE.
  // Change this once ELUE's own WhatsApp number is connected in OTPIQ.
  codeSenderNote: "الرمز يوصلكم برسالة واتساب باسم Premium Technology (خدمة التحقق اللي نستخدمها).",
  currency: "د.ع",
};

export function formatIQD(amount: number): string {
  return `${amount.toLocaleString("en-US")} ${site.currency}`;
}
