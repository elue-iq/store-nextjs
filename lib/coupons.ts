// Coupons, credit (cashback) and affiliate commission: the pricing rules.
// Plain TypeScript with relative imports only: the checkout shows the same numbers the
// server charges (the server always re-prices; the browser never decides a price).
//
// Price of an order:
//   subtotal   = jars at their price
//   discount   = the coupon's discount on the jars (PERCENT, FIXED, FREE_JARS)
//   creditUsed = the customer's credit from earlier cashback, spent automatically
//   total      = subtotal - discount - creditUsed   (what the jars cost; never below 0)
//   delivery   = free with a FREE_DELIVERY coupon or for big orders, else site.deliveryFee
// CASHBACK coupons give no discount now: they add credit once the order is delivered.
// One coupon per order.

import { freeDeliveryFor, minusIQD } from "./site";

export type CouponKind = "PERCENT" | "FIXED" | "FREE_DELIVERY" | "FREE_JARS" | "CASHBACK";
export const COUPON_KINDS: CouponKind[] = ["PERCENT", "FIXED", "FREE_DELIVERY", "FREE_JARS", "CASHBACK"];

export const COUPON_KIND_LABELS: Record<CouponKind, string> = {
  PERCENT: "نسبة خصم %",
  FIXED: "مبلغ خصم ثابت",
  FREE_DELIVERY: "توصيل مجاني",
  FREE_JARS: "علب مجانية (اشترِ واحصل)",
  CASHBACK: "كاش باك (رصيد للطلب الجاي)",
};

// The rule as stored on the order (a snapshot: later edits to the coupon don't change old orders).
export type CouponRule = {
  code: string;
  kind: CouponKind;
  value?: number | null;
  maxDiscount?: number | null;
  buyQty?: number | null;
  freeQty?: number | null;
  minJars?: number | null;
};

export type Coupon = CouponRule & {
  title?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  maxUses?: number | null;
  perCustomer?: number | null;
  firstOrderOnly?: boolean | null;
  active?: boolean | null;
  campaignId?: string | null;
};

type Line = { price: number; qty: number };

// Codes are typed by people: trim, drop spaces, Arabic-Indic digits to Latin, upper case.
export function normalizeCode(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, 32);
}
export const codeValid = (code: string) => /^[A-Z0-9_-]{3,32}$/.test(code);

// IQD amounts are rounded down to 250 (the smallest note in use).
const round250 = (n: number) => Math.max(0, Math.floor(n / 250) * 250);

export type CouponEffect = { discount: number; freeDelivery: boolean; cashback: number; freeJars: number };
const NONE: CouponEffect = { discount: 0, freeDelivery: false, cashback: 0, freeJars: 0 };

export function couponEffect(rule: CouponRule | null | undefined, lines: Line[]): CouponEffect {
  if (!rule) return NONE;
  const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  const jars = lines.reduce((n, l) => n + l.qty, 0);
  const value = Math.max(0, Number(rule.value ?? 0));
  const cap = rule.maxDiscount && rule.maxDiscount > 0 ? rule.maxDiscount : Infinity;
  switch (rule.kind) {
    case "PERCENT":
      return { ...NONE, discount: Math.min(round250((subtotal * Math.min(value, 100)) / 100), cap, subtotal) };
    case "FIXED":
      return { ...NONE, discount: Math.min(value, subtotal) };
    case "FREE_DELIVERY":
      return { ...NONE, freeDelivery: true };
    case "FREE_JARS": {
      const buy = Math.max(1, Number(rule.buyQty ?? 1));
      const free = Math.max(1, Number(rule.freeQty ?? 1));
      const count = Math.floor(jars / (buy + free)) * free;
      // The cheapest jars are the free ones (all jars cost the same today).
      const unitPrices = lines.flatMap((l) => Array.from({ length: l.qty }, () => l.price)).sort((a, b) => a - b);
      const discount = unitPrices.slice(0, count).reduce((n, p) => n + p, 0);
      return { ...NONE, discount, freeJars: count };
    }
    case "CASHBACK":
      return { ...NONE, cashback: Math.min(round250((subtotal * Math.min(value, 100)) / 100), cap) };
    default:
      return NONE;
  }
}

// «خصم 10%» etc. Shown to the customer.
export function couponLabel(rule: CouponRule): string {
  const v = Number(rule.value ?? 0);
  const iqd = (n: number) => `${(Number(n) || 0).toLocaleString("en-US")} د.ع`;
  switch (rule.kind) {
    case "PERCENT":
      return `خصم ${v}%${rule.maxDiscount ? ` (حتى ${iqd(rule.maxDiscount)})` : ""}`;
    case "FIXED":
      return `خصم ${iqd(v)}`;
    case "FREE_DELIVERY":
      return "توصيل مجاني";
    case "FREE_JARS": {
      const buy = Number(rule.buyQty ?? 1);
      const free = Number(rule.freeQty ?? 1);
      return `${free === 1 ? "علبة مجانية" : `${free} علب مجانية`} مع كل ${buy === 1 ? "علبة" : `${buy} علب`}`;
    }
    case "CASHBACK":
      return `رصيد ${v}% لطلبكم الجاي${rule.maxDiscount ? ` (حتى ${iqd(rule.maxDiscount)})` : ""}`;
  }
}

// Why a code can't be used (null = fine). Checks that need the customer's history take ctx.
export type CouponProblem =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "min_jars"
  | "used_up"
  | "per_customer"
  | "first_order_only"
  | "own_code";

export function couponProblem(
  c: Coupon | null | undefined,
  ctx: { now: Date; jars: number; customerUses?: number; previousOrders?: number },
): CouponProblem | null {
  if (!c) return "not_found";
  if (c.active === false) return "inactive";
  if (c.startsAt && ctx.now < new Date(c.startsAt)) return "not_started";
  if (c.endsAt && ctx.now > new Date(c.endsAt)) return "expired";
  if (c.minJars && ctx.jars < c.minJars) return "min_jars";
  if (ctx.customerUses != null && ctx.customerUses >= Math.max(1, c.perCustomer ?? 1)) return "per_customer";
  if (c.firstOrderOnly && (ctx.previousOrders ?? 0) > 0) return "first_order_only";
  return null;
}

export function couponProblemText(p: CouponProblem, c?: Coupon | null): string {
  switch (p) {
    case "not_found":
      return "هذا الكود غير صحيح.";
    case "inactive":
      return "هذا الكود متوقف حالياً.";
    case "not_started":
      return "هذا الكود يبدأ لاحقاً.";
    case "expired":
      return "انتهت صلاحية هذا الكود.";
    case "min_jars":
      return `هذا الكود يحتاج ${c?.minJars ?? ""} علب أو أكثر.`;
    case "used_up":
      return "انتهت الاستخدامات المتاحة لهذا الكود.";
    case "per_customer":
      return "استخدمتوا هذا الكود من قبل.";
    case "first_order_only":
      return "هذا الكود لأول طلب فقط.";
    case "own_code":
      return "ما يمكن استخدام كود الحملة الخاص بكم.";
  }
}

// What to add for the code to work, or for the next free jar. null = nothing to say.
export function couponHint(rule: CouponRule | null | undefined, jars: number): string | null {
  if (!rule) return null;
  const n = (k: number) => (k === 1 ? "علبة وحدة" : `${k} علب`);
  if (rule.minJars && jars < rule.minJars) return `أضيفوا ${n(rule.minJars - jars)} حتى يشتغل الكود.`;
  if (rule.kind === "FREE_JARS") {
    const buy = Math.max(1, Number(rule.buyQty ?? 1));
    const free = Math.max(1, Number(rule.freeQty ?? 1));
    const group = buy + free;
    if (jars < buy) return `أضيفوا ${n(buy - jars)} وبعدها ${free === 1 ? "علبة مجانية" : `${free} علب مجانية`}.`;
    const r = jars % group;
    if (r >= buy) return `أضيفوا ${n(group - r)} وتصير مجانية.`;
  }
  return null;
}

export type Pricing = {
  subtotal: number;
  discount: number;
  creditUsed: number;
  total: number;
  freeDelivery: boolean;
  cashback: number;
  freeJars: number;
  jars: number;
};

// The whole price. credit = the customer's available credit (spent automatically).
// freeDeliveryAlready: the team marked the delivery as a gift / prepaid.
export function priceOrder(lines: Line[], rule: CouponRule | null | undefined, credit = 0, freeDeliveryAlready = false): Pricing {
  const subtotal = lines.reduce((n, l) => n + l.price * l.qty, 0);
  const jars = lines.reduce((n, l) => n + l.qty, 0);
  const eff = couponEffect(rule, lines);
  const afterCoupon = Math.max(0, subtotal - eff.discount);
  const creditUsed = Math.max(0, Math.min(Math.floor(credit), afterCoupon));
  return {
    subtotal,
    discount: eff.discount,
    creditUsed,
    total: afterCoupon - creditUsed,
    freeDelivery: freeDeliveryAlready || eff.freeDelivery || freeDeliveryFor(jars),
    cashback: eff.cashback,
    freeJars: eff.freeJars,
    jars,
  };
}

// The customer's credit: cashback of delivered orders, minus credit spent on orders that
// are not cancelled (a cancelled order gives its credit back).
export function creditBalance(orders: { status: string; cashback?: number | null; creditUsed?: number | null }[]): number {
  let n = 0;
  for (const o of orders) {
    if (o.status === "DELIVERED") n += Number(o.cashback ?? 0);
    if (o.status !== "CANCELLED") n -= Number(o.creditUsed ?? 0);
  }
  return Math.max(0, n);
}

// The affiliate's commission: per paid jar (free jars from a coupon earn nothing).
export function commissionFor(jars: number, freeJars: number, perJar: number | null | undefined): number {
  return Math.max(0, jars - freeJars) * Math.max(0, Number(perJar ?? 0));
}

// Delivery companies get jars as product lines whose prices must add up to what the driver
// collects. With a discount, the discount is spread over the jars (whole dinars), splitting a
// line in two when the amounts can't be equal.
export function spreadDiscount<T extends { price: number; quantity: number }>(lines: T[], off: number): T[] {
  const units = lines.reduce((n, l) => n + l.quantity, 0);
  if (off <= 0 || units === 0) return lines;
  const goods = lines.reduce((n, l) => n + l.price * l.quantity, 0);
  if (off >= goods) return lines.map((l) => ({ ...l, price: 0 }));
  const each = Math.floor(off / units);
  let extra = off - each * units; // this many units take 1 IQD more off
  const out: T[] = [];
  for (const l of lines) {
    const more = Math.min(extra, l.quantity);
    extra -= more;
    if (more > 0) out.push({ ...l, price: l.price - each - 1, quantity: more });
    if (l.quantity - more > 0) out.push({ ...l, price: l.price - each, quantity: l.quantity - more });
  }
  return out;
}

// Order fields a discount touches, for screens and messages.
export type PricedOrder = {
  total: number;
  subtotal?: number | null;
  discount?: number | null;
  creditUsed?: number | null;
  couponCode?: string | null;
  couponLabel?: string | null;
};

// «خصم كود NOOR10 (خصم 10%): −1,500 د.ع» lines for messages; [] when there's no discount.
export function discountLines(o: PricedOrder, fmt: (n: number) => string): string[] {
  const out: string[] = [];
  if (o.discount) out.push(`خصم ${o.couponCode ?? ""}${o.couponLabel ? ` (${o.couponLabel})` : ""}: ${minusIQD(o.discount)}`.replace("خصم  ", "خصم "));
  if (o.creditUsed) out.push(`من رصيدكم: ${minusIQD(o.creditUsed)}`);
  return out;
}
