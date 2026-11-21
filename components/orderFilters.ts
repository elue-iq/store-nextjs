// The order list's filters (/admin): one state object, plain functions.
// Every filter is a set of choices. «فقط» keeps orders that match any choice, «بدون» keeps the rest.
// Counts are «faceted»: a choice shows how many orders it gives with the OTHER filters as they are.

import { orderTime } from "@/lib/order-time";
import { STATUS_LABELS, STATUS_ORDER, type Order, type OrderStatus } from "@/lib/data";
import { payKeyOf, PAY_KEY_LABELS, type PayKey } from "@/lib/site";
import { products } from "@/lib/products";
import { baghdadDay, reviewState, REVIEW_STATE_LABELS, type ReviewState } from "./AdminOrderRow";

export type FacetKey = "status" | "when" | "flavors" | "province" | "pay" | "courier" | "review";
export type When = "today" | "yesterday" | "7d" | "30d";
export type PayChoice = PayKey | "freeDelivery";
export type Sort = "newest" | "oldest";

export type OrderFilters = {
  status: OrderStatus[];
  when: When[]; // one at most (the periods overlap)
  flavors: string[];
  province: string[];
  pay: PayChoice[];
  courier: string[]; // "MODON" | "BOXY" | "LOCAL" (any local courier) | a local courier's id | "none"
  review: ReviewState[];
  not: Partial<Record<FacetKey, boolean>>;
};

export const EMPTY_FILTERS: OrderFilters = { status: [], when: [], flavors: [], province: [], pay: [], courier: [], review: [], not: {} };
export const FACETS: FacetKey[] = ["status", "when", "flavors", "province", "pay", "courier", "review"];
export const FACET_TITLES: Record<FacetKey, string> = {
  status: "الحالة",
  when: "الفترة",
  flavors: "النكهة",
  province: "المحافظة",
  pay: "الدفع",
  courier: "التوصيل",
  review: "التقييم",
};
const SINGLE: Partial<Record<FacetKey, true>> = { when: true };
export const isSingle = (k: FacetKey) => Boolean(SINGLE[k]);

export const WHEN_LABELS: Record<When, string> = { today: "اليوم", yesterday: "أمس", "7d": "آخر 7 أيام", "30d": "آخر 30 يوماً" };
const PAY_ORDER: PayChoice[] = ["cod", "QI", "ZAINCASH", "OTHER", "GIFT", "unknown", "freeDelivery"];

export function courierOf(o: Order): string {
  if (o.modonQr || o.courierKind === "MODON") return "MODON";
  if (o.boxyUid || o.courierKind === "BOXY") return "BOXY";
  if (o.courierKind === "LOCAL" && o.courierId) return o.courierId;
  return "none";
}

// Does the order carry this choice?
function has(o: Order, k: FacetKey, v: string, today: string): boolean {
  switch (k) {
    case "status":
      return o.status === v;
    case "when": {
      const day = baghdadDay(orderTime(o));
      const ago = (n: number) => baghdadDay(new Date(Date.now() - n * 86_400_000).toISOString());
      return v === "today" ? day === today : v === "yesterday" ? day === ago(1) : day >= ago(v === "7d" ? 6 : 29);
    }
    case "flavors":
      // Every jar in the parcel counts, gifts included: «بدون جزر» = no carrot jar at all.
      return o.items.some((i) => i?.slug === v);
    case "province":
      return o.province === v;
    case "pay":
      return v === "freeDelivery" ? Boolean(o.freeDelivery && !o.deliveryPaid) : payKeyOf(o) === v;
    case "courier":
      return v === "LOCAL" ? Boolean(o.courierKind === "LOCAL" && o.courierId) : courierOf(o) === v;
    case "review":
      return reviewState(o) === v;
  }
}

export const activeFacets = (f: OrderFilters) => FACETS.filter((k) => f[k].length > 0);

// Kept by every filter (except `skip`, used for that filter's own counts)?
export function passes(o: Order, f: OrderFilters, today: string, skip?: FacetKey): boolean {
  for (const k of FACETS) {
    if (k === skip || !f[k].length) continue;
    const hit = (f[k] as string[]).some((v) => has(o, k, v, today));
    if (hit === Boolean(f.not[k])) return false;
  }
  return true;
}

export type Choice = { value: string; label: string; count: number };

// Each filter's choices with their counts. `base` = the orders left after the search.
export function facetChoices(
  base: Order[],
  f: OrderFilters,
  today: string,
  extra: { provinces: string[]; couriers: [string, string][] },
): Record<FacetKey, Choice[]> {
  const options: Record<FacetKey, [string, string][]> = {
    status: STATUS_ORDER.map((s) => [s, STATUS_LABELS[s]]),
    when: (Object.keys(WHEN_LABELS) as When[]).map((w) => [w, WHEN_LABELS[w]]),
    flavors: products.map((p) => [p.slug, p.nameAr]),
    province: extra.provinces.map((p) => [p, p]),
    pay: PAY_ORDER.map((k) => [k, k === "freeDelivery" ? "توصيل مجاني (هدية)" : PAY_KEY_LABELS[k]]),
    courier: [
      ["MODON", "مدن Express"],
      ["BOXY", "بوكسي"],
      ...(extra.couriers.length ? ([["LOCAL", "كل التوصيل المحلي"]] as [string, string][]) : []),
      ...extra.couriers,
      ["none", "بلا شركة توصيل"],
    ],
    review: (["notAsked", "waiting", "reviewed"] as ReviewState[]).map((r) => [r, REVIEW_STATE_LABELS[r]]),
  };
  const out = {} as Record<FacetKey, Choice[]>;
  for (const k of FACETS) {
    const pool = base.filter((o) => passes(o, f, today, k));
    out[k] = options[k].map(([value, label]) => ({ value, label, count: pool.filter((o) => has(o, k, value, today)).length }));
  }
  return out;
}

// Short text for an active filter's chip: «الحالة: جديد، مؤكد» or «بدون: البصرة».
export function chipText(k: FacetKey, f: OrderFilters, labels: Map<string, string>): string {
  const names = (f[k] as string[]).map((v) => labels.get(`${k}:${v}`) ?? v);
  const list = names.length > 2 ? `${names.slice(0, 2).join("، ")} +${names.length - 2}` : names.join("، ");
  return f.not[k] ? `بدون ${list}` : k === "when" || k === "province" || k === "flavors" ? list : `${FACET_TITLES[k]}: ${list}`;
}

export function toggleChoice(f: OrderFilters, k: FacetKey, v: string): OrderFilters {
  const cur = f[k] as string[];
  const next = cur.includes(v) ? cur.filter((x) => x !== v) : isSingle(k) ? [v] : [...cur, v];
  return { ...f, [k]: next, not: next.length ? f.not : { ...f.not, [k]: false } };
}

export function clearFacet(f: OrderFilters, k: FacetKey): OrderFilters {
  return { ...f, [k]: [], not: { ...f.not, [k]: false } };
}

// Kept on this phone so the list opens with the filters the person left it with.
const KEY = "elue-admin-filters-v1";
export function loadFilters(): { f: OrderFilters; sort: Sort } {
  try {
    const raw = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw === "object") {
      const f = { ...EMPTY_FILTERS, not: {} } as OrderFilters;
      for (const k of FACETS) if (Array.isArray(raw.f?.[k])) (f[k] as string[]) = raw.f[k].filter((x: unknown) => typeof x === "string");
      f.not = raw.f?.not && typeof raw.f.not === "object" ? raw.f.not : {};
      return { f, sort: raw.sort === "oldest" ? "oldest" : "newest" };
    }
  } catch {}
  return { f: EMPTY_FILTERS, sort: "newest" };
}
export function saveFilters(f: OrderFilters, sort: Sort) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ f, sort }));
  } catch {}
}
