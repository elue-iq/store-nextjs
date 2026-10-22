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
  codeSenderNote: "يصلك الرمز في رسالة واتساب باسم Premium Technology، وهي خدمة التحقق التي نستخدمها.",
  currency: "د.ع",
  // Delivery fee the customer pays the driver on top of the jars (Modon keeps it).
  deliveryFee: 5000,
  // Public address used in links the server sends (Telegram).
  address: "https://elue-iq.com",
};

// The site's public address. Link previews (WhatsApp, Instagram, Telegram,
// Google) need full https addresses for the image and page, so this must be
// right on every host:
// 1. NEXT_PUBLIC_SITE_URL if set (use it for the real domain, e.g. https://elue-iq.com)
// 2. AWS Amplify: the branch address, from the build's AWS_BRANCH / AWS_APP_ID
// 3. Vercel: the production domain
export function siteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.AWS_APP_ID && process.env.AWS_BRANCH) {
    return `https://${process.env.AWS_BRANCH.replace(/[^a-zA-Z0-9-]/g, "-")}.${process.env.AWS_APP_ID}.amplifyapp.com`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

export function formatIQD(amount: number): string {
  return `${amount.toLocaleString("en-US")} ${site.currency}`;
}

// Under the order total (checkout, receipt, «طلباتي»): delivery is paid to the driver.
export function deliveryNote(): string {
  return `+ أجور التوصيل ${formatIQD(site.deliveryFee)} تُدفع للمندوب عند الاستلام`;
}
