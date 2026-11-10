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
  // Printed on every courier label (note), sent to Telegram, and shown to the customer.
  courierNote: "يرجى التأكد من الطلب عند الاستلام",
  // A customer must review their latest delivered order before ordering again
  // (a short, playful form). false = reviews are optional (current choice).
  reviewRequiredToReorder: false,
  // WhatsApp "we received your order" (OTPIQ template). Empty = off. See lib/orderConfirmation.ts.
  orderConfirmation: { templateName: "", whatsappAccountId: "", whatsappPhoneId: "" },
  // Meta Pixel (dataset) ID: the number from Events Manager. Leave empty to keep the pixel off.
  metaPixelId: "1885278566155685",
  // The meta tag content from Business Settings > Brand safety > Domains (domain verification). Empty = no tag.
  metaDomainVerification: "",
  // Meta does not take Iraqi dinar for the pixel, so values go as US dollars at this fixed rate.
  pixelIqdPerUsd: 1600,
  // Orders placed before this hour are delivered the next day (shown to customers).
  deliveryCutoff: "8 مساءً",
  // Delivery inside Baghdad happens in this window; the customer must accept it
  // before ordering (a note + checkbox when the province is Baghdad).
  baghdadWindow: {
    province: "بغداد",
    short: "من الساعة 6 إلى 10 مساءً",
    note: "التوصيل داخل بغداد يكون من الساعة 6 إلى 10 مساءً. وإذا ما كدرنا نوصّل طلبكم بنفس اليوم، ينتقل تلقائياً لليوم التالي.",
    accept: "اطلعت على موعد التوصيل وأوافق عليه",
  },
  // Modon Express support: where «الإبلاغ عن مشكلة» sends the report (WhatsApp).
  // International format, digits only (+964 535 111 991).
  modonSupport: { whatsapp: "964535111991", display: "+964 535 111 991" },
  // The cold-chain message: a site-wide banner, and in every message sent to a customer.
  coldNote: {
    // The short line in the site-wide banner at the top.
    banner: "يُحفظ مبرّد",
    title: "مهم: يُحفظ دائماً في البراد",
    text:
      "لأن منتجاتنا لا تحتوي على مواد حافظة أو سكر مضاف أو دهون مضافة، فلازم دائماً تكون مبرّدة. " +
      "بعد ما تستلمونه من المندوب، خلّوه بالبراد مباشرة.",
    problem: "في حال وصلكم المنتج مو بارد، يرجى التواصل مع فريق الدعم مباشرة",
    thanks: "شكراً لاختياركم ÉLUE",
  },
  // Who the WhatsApp code comes from. OTPIQ's default sender shows as
  // "Premium Technology" (+1 555 335 9750), not ELUE.
  // Change this once ELUE's own WhatsApp number is connected in OTPIQ.
  codeSenderNote: "يصلك الرمز في رسالة واتساب باسم Premium Technology، وهي خدمة التحقق التي نستخدمها.",
  currency: "د.ع",
  // Delivery fee the customer pays the driver on top of the jars (Modon keeps it).
  deliveryFee: 5000,
  // Orders with at least this many jars get free delivery (ÉLUE pays the courier).
  freeDeliveryMinJars: 4,
  // Public address used in links the server sends (Telegram).
  address: "https://elue-iq.com",
};

// "How your order gets to you", shown on the home page and in the cart.
export const deliverySteps = [
  { title: "اطلبوا", text: "اختاروا نكهاتكم وأكملوا الطلب، وسجّلوا الدخول برقم الواتساب لمتابعته." },
  { title: "نجهّزه بحب", text: "نستلم طلبكم، ونجهّزه ونغلّفه بعناية داخل بوكس الفلين." },
  { title: "يوصلكم المندوب", text: `اطلبوا قبل الساعة ${site.deliveryCutoff} ويصلكم غداً.` },
  { title: "للبراد مباشرة", text: "تأكدوا من الطلب، وحطّوا الترافل بالبراد فوراً." },
];

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

// A discount amount: «−4,500 د.ع». The minus and the number are kept together left-to-right,
// so in Arabic text the minus stays next to the number (not at the far end of the line).
export function minusIQD(amount: number): string {
  return `\u2066−${amount.toLocaleString("en-US")}\u2069 ${site.currency}`;
}

// How an order's delivery fee is settled (set by the team; customers always pay the driver):
// - "driver":  the customer pays it to the driver on delivery (normal)
// - "prepaid": the customer already paid it (card, Qi transfer…). Not a cost to ÉLUE.
// - "gift":    ÉLUE pays it: free delivery as a gift / offer. A real cost to ÉLUE.
// Stored as two fields on the order: deliveryPaid (prepaid) and freeDelivery (gift).
export type DeliveryPay = "driver" | "prepaid" | "gift";

export function deliveryPayOf(o: { freeDelivery?: boolean | null; deliveryPaid?: boolean | null }): DeliveryPay {
  if (o.deliveryPaid) return "prepaid";
  if (o.freeDelivery) return "gift";
  return "driver";
}

export const DELIVERY_PAY_LABELS: Record<DeliveryPay, string> = {
  driver: "يدفعها العميل للمندوب",
  prepaid: "أجور التوصيل مدفوعة مسبقاً",
  gift: "توصيل مجاني (هدية من ÉLUE)",
};

// Under the order total (checkout, receipt, «طلباتي»): delivery is paid to the driver.
// One sentence saying what the driver collects and why. The same wording goes on
// the courier label (note), the Telegram message, and the customer's screens.
export function collectStatement(total: number, paid = false, delivery: DeliveryPay = "driver"): string {
  const fee = site.deliveryFee;
  if (paid && delivery === "gift") return "الطلب مدفوع مسبقاً والتوصيل مجاني. لا يُطلب أي مبلغ عند الاستلام";
  if (paid && delivery === "prepaid") return "الطلب وأجور التوصيل مدفوعة مسبقاً. لا يُطلب أي مبلغ عند الاستلام";
  if (paid) return `الطلب مدفوع مسبقاً. المطلوب عند الاستلام ${formatIQD(fee)} (أجور التوصيل فقط)`;
  if (delivery === "gift") return `التوصيل مجاني. المطلوب عند الاستلام ${formatIQD(total)} (ثمن الطلب فقط)`;
  if (delivery === "prepaid") return `أجور التوصيل مدفوعة مسبقاً. المطلوب عند الاستلام ${formatIQD(total)} (ثمن الطلب فقط)`;
  return `المطلوب عند الاستلام ${formatIQD(total + fee)} (الطلب ${formatIQD(total)} + التوصيل ${formatIQD(fee)})`;
}

// Free delivery for orders of site.freeDeliveryMinJars jars or more.
export function freeDeliveryFor(jars: number): boolean {
  return jars >= site.freeDeliveryMinJars;
}

// Under the cart total: how many more jars until delivery is free (empty once it is).
export function freeDeliveryHint(jars: number): string {
  const left = site.freeDeliveryMinJars - jars;
  if (left <= 0) return "";
  const n = left === 1 ? "علبة وحدة" : left === 2 ? "علبتين" : `${left} علب`;
  return `أضيفوا ${n} ويصير التوصيل مجاني 🚚`;
}

export function deliveryNote(): string {
  return `+ أجور التوصيل ${formatIQD(site.deliveryFee)} تُدفع للمندوب عند الاستلام`;
}

// How the customer paid in advance (jars and/or delivery fee). Stored on the order as
// payMethod (+ payRef, the transfer / transaction number the team types in).
// No payMethod and nothing prepaid = cash to the driver.
export type PayMethod = "QI" | "ZAINCASH" | "OTHER" | "GIFT";

export const PAY_METHOD_LABELS: Record<PayMethod, string> = {
  QI: "Qi Card",
  ZAINCASH: "زين كاش",
  OTHER: "دفع آخر",
  GIFT: "هدية",
};

// The methods the team picks when the customer paid in advance (GIFT is chosen on the jars line).
export const PAID_METHODS: PayMethod[] = ["QI", "ZAINCASH", "OTHER"];

// Methods that need a transaction / transfer number.
export function needsPayRef(m?: string | null): boolean {
  return m === "QI" || m === "ZAINCASH" || m === "OTHER";
}

type PayFields = {
  paid?: boolean | null;
  deliveryPaid?: boolean | null;
  freeDelivery?: boolean | null;
  payMethod?: string | null;
  paidNote?: string | null;
};

// One key per way an order was paid, for filters and breakdowns:
// "cod" = cash to the driver, a PayMethod, or "unknown" = paid in advance but the
// method was never recorded (older orders).
export type PayKey = "cod" | PayMethod | "unknown";

export function payKeyOf(o: PayFields): PayKey {
  if (o.payMethod === "QI" || o.payMethod === "ZAINCASH" || o.payMethod === "OTHER" || o.payMethod === "GIFT") return o.payMethod;
  if (o.paid || o.deliveryPaid) return "unknown";
  return "cod";
}

export const PAY_KEY_LABELS: Record<PayKey, string> = {
  cod: "نقداً عند الاستلام",
  QI: "Qi Card",
  ZAINCASH: "زين كاش",
  OTHER: "دفع آخر",
  GIFT: "هدية",
  unknown: "مدفوع بلا طريقة محددة",
};

// Short text for the method of an order, e.g. "Qi Card" or "دفع آخر (حوالة بنكية)".
export function payMethodText(o: PayFields): string {
  const key = payKeyOf(o);
  if (key === "cod") return PAY_KEY_LABELS.cod;
  if (key === "unknown") return PAY_KEY_LABELS.unknown;
  if (key === "OTHER" && o.paidNote) return `${PAY_KEY_LABELS.OTHER} (${o.paidNote})`;
  return PAY_KEY_LABELS[key];
}
