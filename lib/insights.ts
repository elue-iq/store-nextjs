// Numbers for the admin dashboard («لوحة المعلومات»), computed in the browser from
// the orders the admin already loads. Pure functions only (no React, no network),
// so they can be tested on their own.
//
// Definitions (shown on the dashboard too):
// - A day is a Baghdad calendar day (UTC+3, Iraq has no daylight saving).
// - Sales = the jars' value (order total). Delivery is paid to the courier and is not included.
// - With a flavor filter, sales and jars count only that flavor's lines; the order
//   count is the orders that contain it.
// - A customer is a WhatsApp number. An order is from a "new" customer when that
//   number has no earlier order that wasn't cancelled.
// - Test orders (source contains "test=") are hidden unless asked for.

import { giftLines, paidLines } from "./gifts";
import type { Order, OrderStatus } from "./data";
import { products } from "./products";
import { formatIraqiMobile } from "./phone";
import { PAY_KEY_LABELS, payKeyOf, site, type PayKey } from "./site";
import { heardLabel } from "./attribution";

// ---- Days ----------------------------------------------------------------------

const BAGHDAD_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

export const dayOf = (iso: string) => new Date(Date.parse(iso) + BAGHDAD_MS).toISOString().slice(0, 10);
export const hourOf = (iso: string) => new Date(Date.parse(iso) + BAGHDAD_MS).getUTCHours();
export const weekdayOf = (iso: string) => new Date(Date.parse(iso) + BAGHDAD_MS).getUTCDay(); // 0 = Sunday
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
export const todayBaghdad = () => dayOf(new Date().toISOString());

export const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

// "28 أكتوبر" / "28 أكتوبر – 3 نوفمبر"
export function dayLabel(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}
export function rangeLabel(r: Range): string {
  return r.from === r.to ? dayLabel(r.from) : `${dayLabel(r.from)} – ${dayLabel(r.to)}`;
}

// ---- Filters -------------------------------------------------------------------

export type Period = "today" | "yesterday" | "7d" | "30d" | "month" | "lastMonth" | "all" | "custom";

export const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "اليوم" },
  { id: "yesterday", label: "أمس" },
  { id: "7d", label: "آخر 7 أيام" },
  { id: "30d", label: "آخر 30 يوماً" },
  { id: "month", label: "هذا الشهر" },
  { id: "lastMonth", label: "الشهر الماضي" },
  { id: "all", label: "كل الفترة" },
  { id: "custom", label: "مخصص" },
];

export type Filters = {
  period: Period;
  from: string; // custom range (YYYY-MM-DD)
  to: string;
  flavors: string[]; // product slugs; empty = every flavor
  statuses: OrderStatus[]; // empty = every status
  province: string; // "" = all
  channel: "" | "web" | "team";
  source: string; // "" = all, otherwise a sourceLabel()
  payment: "" | "paid" | "cod" | "deliveryPaid" | "free";
  method: "" | PayKey; // how it was paid: cash, Qi Card, ZainCash…
  customer: "" | "new" | "returning";
  showTests: boolean;
};

export const ALL_STATUSES: OrderStatus[] = ["NEW", "CONFIRMED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

export const DEFAULT_FILTERS: Filters = {
  period: "30d",
  from: "",
  to: "",
  flavors: [],
  statuses: ["NEW", "CONFIRMED", "OUT_FOR_DELIVERY", "DELIVERED"], // sales leave out cancelled orders
  province: "",
  channel: "",
  source: "",
  payment: "",
  method: "",
  customer: "",
  showTests: false,
};

// How many filters differ from the defaults (the period is shown on its own).
export function activeFilterCount(f: Filters): number {
  const d = DEFAULT_FILTERS;
  return (
    (f.flavors.length ? 1 : 0) +
    (f.statuses.slice().sort().join() !== d.statuses.slice().sort().join() ? 1 : 0) +
    (f.province ? 1 : 0) +
    (f.channel ? 1 : 0) +
    (f.source ? 1 : 0) +
    (f.payment ? 1 : 0) +
    (f.method ? 1 : 0) +
    (f.customer ? 1 : 0) +
    (f.showTests ? 1 : 0)
  );
}

export type Range = { from: string; to: string };

// The period's days, and the period to compare it with (same length just before;
// a calendar month is compared with the same days of the month before).
export function resolveRange(f: Filters, today: string, firstDay: string): { cur: Range; prev: Range | null } {
  const y = today.slice(0, 7);
  const monthStart = `${y}-01`;
  const prevMonthStart = addDays(monthStart, -1).slice(0, 7) + "-01";
  const equalBefore = (r: Range): Range => {
    const len = daysBetween(r.from, r.to) + 1;
    return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
  };
  switch (f.period) {
    case "today":
      return { cur: { from: today, to: today }, prev: { from: addDays(today, -1), to: addDays(today, -1) } };
    case "yesterday": {
      const d = addDays(today, -1);
      return { cur: { from: d, to: d }, prev: { from: addDays(d, -1), to: addDays(d, -1) } };
    }
    case "7d":
    case "30d": {
      const cur = { from: addDays(today, f.period === "7d" ? -6 : -29), to: today };
      return { cur, prev: equalBefore(cur) };
    }
    case "month": {
      const n = Number(today.slice(8, 10));
      const prevEnd = addDays(monthStart, -1);
      const sameDay = addDays(prevMonthStart, n - 1);
      return { cur: { from: monthStart, to: today }, prev: { from: prevMonthStart, to: sameDay < prevEnd ? sameDay : prevEnd } };
    }
    case "lastMonth": {
      const end = addDays(monthStart, -1);
      const before = addDays(prevMonthStart, -1);
      return { cur: { from: prevMonthStart, to: end }, prev: { from: before.slice(0, 7) + "-01", to: before } };
    }
    case "custom": {
      let from = /^\d{4}-\d{2}-\d{2}$/.test(f.from) ? f.from : firstDay;
      let to = /^\d{4}-\d{2}-\d{2}$/.test(f.to) ? f.to : today;
      if (from > to) [from, to] = [to, from];
      const cur = { from, to };
      return { cur, prev: equalBefore(cur) };
    }
    default:
      return { cur: { from: firstDay < today ? firstDay : today, to: today }, prev: null };
  }
}

// ---- Order facts ---------------------------------------------------------------

export const isTest = (o: Order) => /(^|\s|&)test=/.test(o.source ?? "");

// The campaign details saved with a website order (utm_*, fbclid, referrer, landing page).
export type OrderAttribution = Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term" | "fbclid" | "ref" | "referrer" | "landing", string>> & {
  first?: Partial<Record<"utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term" | "fbclid" | "ref" | "referrer" | "landing", string>>;
};
export function attributionOf(o: Order): OrderAttribution {
  try {
    return o.attribution ? (JSON.parse(o.attribution) as OrderAttribution) : {};
  } catch {
    return {};
  }
}

export type AttributionBucket = "paid_ad" | "creator" | "organic_ig" | "other" | "unknown";

// Paid ad / creator / organic Instagram / other / unknown, from the saved link details and the
// customer's (or team's) «how did you hear». Order of the rules matters: a paid medium first,
// then a creator link, then an ad click id, then an ad id from the DM flow, then the answer.
export function attributionBucket(o: Order): AttributionBucket {
  const a = attributionOf(o);
  const touches = [a, a.first ?? {}];
  const any = (f: (t: OrderAttribution) => boolean) => touches.some(f);
  if (any((t) => /^(paid|cpc|ppc|paid[_-]?social|ads?)$/i.test(t.utm_medium ?? ""))) return "paid_ad";
  if (o.creatorRef || any((t) => Boolean(t.ref)) || o.heardFrom === "creator") return "creator";
  if (any((t) => Boolean(t.fbclid))) return "paid_ad";
  if (/^(ad[_-]?)?\d{6,}$/i.test(o.sourceRef ?? "")) return "paid_ad";
  if (o.heardFrom === "ig_ad") return "paid_ad";
  if (o.heardFrom === "ig_page") return "organic_ig";
  if (o.heardFrom) return "other";
  if (any((t) => /^(ig|instagram)$/i.test(t.utm_source ?? ""))) return "organic_ig";
  if (any((t) => Boolean(t.referrer))) return "other";
  return "unknown";
}

// Where the customer came from (the link they opened, kept with the order).
export function sourceLabel(o: Order): string {
  const s = (o.source ?? "").toLowerCase();
  if (!s) {
    if (o.createdBy) return "أنشأه الفريق";
    // No campaign link: an ad click (fbclid) or the customer's own answer is the best clue.
    if (attributionOf(o).fbclid) return "ميتا (إعلان)";
    return heardLabel(o.heardFrom) || "مباشر / غير معروف";
  }
  if (isTest(o)) return "تجريبي";
  if (/utm_source=(ig|instagram)/.test(s)) return "إنستغرام";
  if (/utm_source=(fb|facebook)/.test(s)) return "فيسبوك";
  if (/utm_source=(wa|whatsapp)/.test(s)) return "واتساب";
  if (/utm_source=tiktok/.test(s)) return "تيك توك";
  const ref = s.match(/(?:^|\s)ref=([^\s&]+)/)?.[1];
  if (ref) return `رابط: ${ref}`;
  const utm = s.match(/utm_source=([^\s&]+)/)?.[1];
  return utm ?? s.slice(0, 40);
}

// Paid lines only: gift jars (lib/gifts.ts) are not sales, so they stay out of jars and revenue.
const lines = (o: Order) => paidLines(o.items);

// The part of an order that counts under the flavor filter.
// Orders given away (payMethod GIFT) carry jars but no revenue.
export function isGift(o: Order): boolean {
  return payKeyOf(o) === "GIFT";
}

export function partOf(o: Order, flavors: string[]): { jars: number; revenue: number } {
  const gift = isGift(o);
  if (!flavors.length) return { jars: o.jars, revenue: gift ? 0 : o.total };
  let jars = 0;
  let revenue = 0;
  for (const l of lines(o)) {
    if (!flavors.includes(l.slug)) continue;
    jars += l.qty;
    revenue += gift ? 0 : l.qty * l.price;
  }
  return { jars, revenue };
}

// For each order: was it the customer's first order that wasn't cancelled?
// (A cancelled order counts as "new" when the number had nothing before it.)
export function customerTypes(orders: Order[]): Map<string, "new" | "returning"> {
  const byPhone = new Map<string, Order[]>();
  for (const o of orders) {
    if (isTest(o)) continue;
    const list = byPhone.get(o.phone);
    if (list) list.push(o);
    else byPhone.set(o.phone, [o]);
  }
  const out = new Map<string, "new" | "returning">();
  for (const list of byPhone.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let hadOrder = false;
    for (const o of list) {
      out.set(o.id, hadOrder ? "returning" : "new");
      if (o.status !== "CANCELLED") hadOrder = true;
    }
  }
  return out;
}

// ---- The numbers ---------------------------------------------------------------

export type Kpis = {
  orders: number;
  revenue: number;
  jars: number;
  aov: number; // average order value
  jarsPerOrder: number;
  customers: number;
  newCustomers: number;
  returningCustomers: number;
  delivered: number;
  prepaid: number; // jars paid in advance
  deliveryPrepaid: number; // delivery fee paid in advance by the customer
  freeDelivery: number; // delivery as a gift from ÉLUE
  freeDeliveryCost: number; // courier fees we covered (known once sent to Modon)
  gifts: number; // orders given away (not revenue)
  giftValue: number; // what they would have cost
};

export type Bucket = { key: string; label: string; from: string; to: string; revenue: number; orders: number; jars: number };
export type Row = { key: string; label: string; orders: number; jars: number; revenue: number };

export type Insights = {
  range: Range;
  prevRange: Range | null;
  orders: Order[]; // the filtered orders, newest first
  kpis: Kpis;
  prev: Kpis | null;
  cancelled: { count: number; of: number }; // in the period, every other filter applied, any status
  prevCancelled: { count: number; of: number } | null;
  statuses: Row[]; // every status in the period (ignores the status filter)
  trend: { unit: "day" | "week"; buckets: Bucket[] };
  flavors: (Row & { share: number; withOrders: number; selected: boolean })[];
  provinces: Row[];
  areas: Row[];
  sources: Row[];
  channels: Row[];
  payMethods: Row[]; // orders by how they were paid
  sizes: Row[]; // orders by number of jars
  hours: number[]; // orders per Baghdad hour 0–23
  weekdays: number[]; // orders per weekday, Sunday first
  topCustomers: { phone: string; name: string; orders: number; revenue: number }[];
  types: Map<string, "new" | "returning">;
  repeatRate: { repeat: number; of: number }; // every customer, all time
  testCount: number;
};

function kpisOf(list: Order[], flavors: string[], types: Map<string, "new" | "returning">): Kpis {
  let revenue = 0;
  let jars = 0;
  let delivered = 0;
  let prepaid = 0;
  let deliveryPrepaid = 0;
  let freeDelivery = 0;
  let freeDeliveryCost = 0;
  let gifts = 0;
  let giftValue = 0;
  const phones = new Set<string>();
  const newPhones = new Set<string>();
  for (const o of list) {
    const p = partOf(o, flavors);
    revenue += p.revenue;
    jars += p.jars;
    phones.add(o.phone);
    if (types.get(o.id) === "new" && o.status !== "CANCELLED") newPhones.add(o.phone);
    if (o.status === "DELIVERED") delivered += 1;
    if (isGift(o) && o.status !== "CANCELLED") {
      gifts += 1;
      giftValue += o.total;
    }
    if (o.paid && !isGift(o)) prepaid += 1;
    if (o.deliveryPaid) deliveryPrepaid += 1;
    if (o.freeDelivery && !o.deliveryPaid && o.status !== "CANCELLED") {
      freeDelivery += 1;
      freeDeliveryCost += o.modonFee ?? 0;
    }
  }
  return {
    orders: list.length,
    revenue,
    jars,
    // Average over the orders that were sold (gifts are not sales).
    aov: list.length - list.filter(isGift).length ? Math.round(revenue / (list.length - list.filter(isGift).length)) : 0,
    jarsPerOrder: list.length ? jars / list.length : 0,
    customers: phones.size,
    newCustomers: newPhones.size,
    returningCustomers: phones.size - newPhones.size,
    delivered,
    prepaid,
    deliveryPrepaid,
    freeDelivery,
    freeDeliveryCost,
    gifts,
    giftValue,
  };
}

function rank(map: Map<string, Row>): Row[] {
  return [...map.values()].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders);
}

function add(map: Map<string, Row>, key: string, label: string, jars: number, revenue: number) {
  const r = map.get(key) ?? { key, label, orders: 0, jars: 0, revenue: 0 };
  r.orders += 1;
  r.jars += jars;
  r.revenue += revenue;
  map.set(key, r);
}

export function computeInsights(all: Order[], f: Filters, today: string): Insights {
  const types = customerTypes(all);
  const testCount = all.filter(isTest).length;
  const real = f.showTests ? all : all.filter((o) => !isTest(o));
  const firstDay = real.reduce((d, o) => (dayOf(o.createdAt) < d ? dayOf(o.createdAt) : d), today);
  const resolved = resolveRange(f, today, firstDay);
  const cur = resolved.cur;
  // No comparison with days before the first order (nothing to compare with).
  const prev = resolved.prev && resolved.prev.to >= firstDay ? resolved.prev : null;

  // Every filter except the period and the status.
  const base = real.filter((o) => {
    if (f.flavors.length && !lines(o).some((l) => f.flavors.includes(l.slug) && l.qty > 0)) return false;
    if (f.province && (o.province ?? "") !== f.province) return false;
    if (f.channel === "web" && o.createdBy) return false;
    if (f.channel === "team" && !o.createdBy) return false;
    if (f.source && sourceLabel(o) !== f.source) return false;
    if (f.payment === "paid" && !o.paid) return false;
    if (f.payment === "cod" && o.paid) return false;
    if (f.payment === "deliveryPaid" && !o.deliveryPaid) return false;
    if (f.payment === "free" && (!o.freeDelivery || o.deliveryPaid)) return false;
    if (f.method && payKeyOf(o) !== f.method) return false;
    if (f.customer && types.get(o.id) !== f.customer) return false;
    return true;
  });
  const inRange = (r: Range) => base.filter((o) => {
    const d = dayOf(o.createdAt);
    return d >= r.from && d <= r.to;
  });
  const statusOk = (o: Order) => !f.statuses.length || f.statuses.includes(o.status);

  const period = inRange(cur);
  const list = period.filter(statusOk).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const prevPeriod = prev ? inRange(prev) : null;
  const prevList = prevPeriod ? prevPeriod.filter(statusOk) : null;

  const cancelledOf = (l: Order[]) => ({ count: l.filter((o) => o.status === "CANCELLED").length, of: l.length });

  // Status mix in the period (all statuses, so the filter can be changed from here).
  const statusMap = new Map<string, Row>();
  for (const s of ALL_STATUSES) statusMap.set(s, { key: s, label: s, orders: 0, jars: 0, revenue: 0 });
  for (const o of period) {
    const p = partOf(o, f.flavors);
    add(statusMap, o.status, o.status, p.jars, p.revenue);
  }

  // Trend: one bar per day, or per week for long periods.
  const span = daysBetween(cur.from, cur.to) + 1;
  const unit = span > 62 ? "week" : "day";
  const step = unit === "week" ? 7 : 1;
  const buckets: Bucket[] = [];
  for (let d = cur.from; d <= cur.to; d = addDays(d, step)) {
    const end = unit === "week" ? (addDays(d, 6) < cur.to ? addDays(d, 6) : cur.to) : d;
    buckets.push({ key: d, label: unit === "week" ? `${dayLabel(d)} – ${dayLabel(end)}` : dayLabel(d), from: d, to: end, revenue: 0, orders: 0, jars: 0 });
  }
  for (const o of list) {
    const d = dayOf(o.createdAt);
    const i = Math.min(buckets.length - 1, Math.floor(daysBetween(cur.from, d) / step));
    if (i < 0) continue;
    const p = partOf(o, f.flavors);
    buckets[i].revenue += p.revenue;
    buckets[i].jars += p.jars;
    buckets[i].orders += 1;
  }

  // Flavors: what was in these orders (every line, so a flavor filter also shows
  // what is bought with it).
  const flavorMap = new Map<string, Row>();
  for (const p of products) flavorMap.set(p.slug, { key: p.slug, label: p.nameAr, orders: 0, jars: 0, revenue: 0 });
  for (const o of list) {
    for (const l of lines(o)) {
      const r = flavorMap.get(l.slug) ?? { key: l.slug, label: l.nameAr, orders: 0, jars: 0, revenue: 0 };
      r.orders += 1;
      r.jars += l.qty;
      r.revenue += isGift(o) ? 0 : l.qty * l.price;
      flavorMap.set(l.slug, r);
    }
  }
  const allJars = [...flavorMap.values()].reduce((n, r) => n + r.jars, 0);
  const flavors = [...flavorMap.values()]
    .sort((a, b) => b.jars - a.jars || b.revenue - a.revenue)
    .map((r) => ({ ...r, share: allJars ? r.jars / allJars : 0, withOrders: r.orders, selected: f.flavors.includes(r.key) }));

  const provinces = new Map<string, Row>();
  const areas = new Map<string, Row>();
  const sources = new Map<string, Row>();
  const channels = new Map<string, Row>();
  const payMethods = new Map<string, Row>();
  const sizes = new Map<string, Row>();
  const hours = Array<number>(24).fill(0);
  const weekdays = Array<number>(7).fill(0);
  const customers = new Map<string, { phone: string; name: string; orders: number; revenue: number }>();
  for (const o of list) {
    const p = partOf(o, f.flavors);
    add(provinces, o.province || "—", o.province || "غير محددة", p.jars, p.revenue);
    const area = (o.area ?? "").trim().replace(/\s+/g, " ");
    if (area) add(areas, `${o.province}|${area}`, f.province ? area : `${area} (${o.province ?? ""})`, p.jars, p.revenue);
    const src = sourceLabel(o);
    add(sources, src, src, p.jars, p.revenue);
    add(channels, o.createdBy ? "team" : "web", o.createdBy ? "أنشأه الفريق" : "من الموقع", p.jars, p.revenue);
    add(payMethods, payKeyOf(o), PAY_KEY_LABELS[payKeyOf(o)], p.jars, p.revenue);
    const size = p.jars >= 5 ? "5+" : String(p.jars);
    add(sizes, size, p.jars >= 5 ? "5 علب أو أكثر" : p.jars === 1 ? "علبة واحدة" : p.jars === 2 ? "علبتان" : `${p.jars} علب`, p.jars, p.revenue);
    hours[hourOf(o.createdAt)] += 1;
    weekdays[weekdayOf(o.createdAt)] += 1;
    const c = customers.get(o.phone) ?? { phone: o.phone, name: o.name, orders: 0, revenue: 0 };
    c.orders += 1;
    c.revenue += p.revenue;
    customers.set(o.phone, c);
  }

  // Repeat customers, all time (numbers with 2+ orders that weren't cancelled).
  const counted = new Map<string, number>();
  for (const o of real) if (o.status !== "CANCELLED") counted.set(o.phone, (counted.get(o.phone) ?? 0) + 1);
  const repeat = [...counted.values()].filter((n) => n >= 2).length;

  return {
    range: cur,
    prevRange: prev,
    orders: list,
    kpis: kpisOf(list, f.flavors, types),
    prev: prevList ? kpisOf(prevList, f.flavors, types) : null,
    cancelled: cancelledOf(period),
    prevCancelled: prevPeriod ? cancelledOf(prevPeriod) : null,
    statuses: ALL_STATUSES.map((s) => statusMap.get(s)!),
    trend: { unit, buckets },
    flavors,
    provinces: rank(provinces),
    areas: [...areas.values()].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue),
    sources: rank(sources),
    channels: rank(channels),
    payMethods: rank(payMethods),
    sizes: [...sizes.values()].sort((a, b) => a.key.localeCompare(b.key)),
    hours,
    weekdays,
    topCustomers: [...customers.values()].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders).slice(0, 5),
    types,
    repeatRate: { repeat, of: counted.size },
    testCount,
  };
}

// Change against the previous period, as a fraction (0.25 = +25%). null when there
// is nothing to compare with.
export function change(cur: number, prev: number | undefined | null): number | null {
  if (prev === undefined || prev === null) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return (cur - prev) / prev;
}

// ---- Export --------------------------------------------------------------------

const STATUS_AR: Record<OrderStatus, string> = {
  NEW: "جديد",
  CONFIRMED: "مؤكَّد",
  OUT_FOR_DELIVERY: "قيد التوصيل",
  DELIVERED: "تم التوصيل",
  CANCELLED: "ملغى",
};

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote everything; neutralise spreadsheet formulas typed into names or notes.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

// The filtered orders as a CSV file Excel opens with Arabic intact (UTF-8 BOM).
export function ordersCsv(orders: Order[], types: Map<string, "new" | "returning">): string {
  const head = [
    "رقم الطلب",
    "التاريخ (بغداد)",
    "الحالة",
    "الاسم",
    "الهاتف",
    "المحافظة",
    "المنطقة",
    "العنوان",
    ...products.map((p) => p.nameAr),
    "العلب",
    "المجموع (د.ع)",
    "رسوم التوصيل (د.ع)",
    "العلب مدفوعة مسبقاً",
    "طريقة الدفع",
    "رقم العملية",
    "أجور التوصيل",
    "أجور مدن",
    "رقم مدن",
    "حالة مدن",
    "رقم الكاشير",
    "القناة",
    "المصدر",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "fbclid",
    "الموقع المحيل",
    "صفحة الدخول",
    "كيف سمع عنا",
    "تفصيل (كيف سمع)",
    "creator_ref",
    "source_ref",
    "first_touch_utm_source",
    "first_touch_utm_medium",
    "first_touch_utm_campaign",
    "attribution_bucket",
    "gift_units",
    "gift_campaign_id",
    "gift_items",
    "marketing_consent",
    "العميل",
    "ملاحظة",
  ];
  const rows = orders.map((o) => {
    const qty = (slug: string) => lines(o).filter((l) => l.slug === slug).reduce((n, l) => n + l.qty, 0);
    const at = new Date(Date.parse(o.createdAt) + BAGHDAD_MS).toISOString().slice(0, 16).replace("T", " ");
    const attr = attributionOf(o);
    return [
      o.orderNumber,
      at,
      STATUS_AR[o.status],
      o.name,
      formatIraqiMobile(o.phone), // "0770 123 4567": stays text in Excel
      o.province,
      o.area,
      o.address,
      ...products.map((p) => qty(p.slug) || ""),
      o.jars,
      o.total,
      o.freeDelivery ? 0 : site.deliveryFee,
      o.paid ? "نعم" : "",
      PAY_KEY_LABELS[payKeyOf(o)],
      o.payRef,
      o.deliveryPaid ? "مدفوعة مسبقاً" : o.freeDelivery ? "هدية (توصيل مجاني)" : "عند الاستلام",
      o.modonFee ?? "",
      o.modonQr,
      o.modonStatus,
      o.cashierOrderId,
      o.createdBy ? "الفريق" : "الموقع",
      sourceLabel(o),
      attr.utm_source,
      attr.utm_medium,
      attr.utm_campaign,
      attr.utm_content,
      attr.utm_term,
      attr.fbclid,
      attr.referrer,
      attr.landing,
      heardLabel(o.heardFrom),
      o.heardNote,
      o.creatorRef,
      o.sourceRef,
      attr.first?.utm_source,
      attr.first?.utm_medium,
      attr.first?.utm_campaign,
      attributionBucket(o),
      o.giftUnits ?? 0,
      o.giftCampaignId,
      giftLines(o.items).map((i) => `${i.slug}×${i.qty}`).join(" "),
      o.marketingConsent == null ? "" : o.marketingConsent ? "yes" : "no",
      types.get(o.id) === "returning" ? "عائد" : "جديد",
      o.note,
    ]
      .map(cell)
      .join(",");
  });
  return "﻿" + [head.map(cell).join(","), ...rows].join("\r\n");
}
