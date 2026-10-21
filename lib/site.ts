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
  codeSenderNote: "يصلكم الرمز في رسالة واتساب باسم Premium Technology، وهي خدمة التحقق التي نستخدمها.",
  currency: "د.ع",
};

// The site's public address, used for links shared to Google, WhatsApp and Instagram.
// On Vercel this follows the production domain automatically (including a custom
// domain once you add one). Set NEXT_PUBLIC_SITE_URL to override.
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

export function formatIQD(amount: number): string {
  return `${amount.toLocaleString("en-US")} ${site.currency}`;
}
