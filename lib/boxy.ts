// Boxy (delivery company) — shared by the boxy function and the admin page.
// Plain TypeScript with relative imports only, so it bundles into the function.

import { deliveryPayOf, site } from "./site";
import { modonCollect } from "./modon";
import { spreadDiscount } from "./coupons";

// Boxy's province codes (docs: Provinces & Regions). Halabja is served from Sulaymaniyah.
export const BOXY_PROVINCE: Record<string, string> = {
  بغداد: "BGD",
  كربلاء: "KRB",
  بابل: "BBL",
  القادسية: "DWN",
  النجف: "NJF",
  البصرة: "BAS",
  ميسان: "AMA",
  "صلاح الدين": "SAH",
  الأنبار: "ANB",
  "ذي قار": "NAS",
  واسط: "KOT",
  المثنى: "SAM",
  كركوك: "KRK",
  السليمانية: "SMH",
  حلبجة: "SMH",
  أربيل: "ARB",
  دهوك: "DOH",
  نينوى: "MOS",
  ديالى: "DYL",
};

export type BoxyRegion = { id: number; name: string };

// Order statuses (docs: Order Flow). Our order status from a Boxy status slug.
// null = leave it as it is (not collected yet, or a problem the team should look at).
export function statusFromBoxy(slug: string | null | undefined): "OUT_FOR_DELIVERY" | "DELIVERED" | null {
  const s = String(slug ?? "").toLowerCase().replace(/_/g, "-");
  if (s === "delivered") return "DELIVERED";
  if (["collected", "in-transit", "out-for-delivery"].includes(s)) return "OUT_FOR_DELIVERY";
  return null; // new, scheduled, collecting, on-hold, postponed, partially-delivered, returns…
}

// Boxy statuses that need the team to look (customer unreachable, postponed, returns, partial, failed…).
// Anything Boxy adds later that is not a normal forward step is shown too, so nothing is missed.
export function boxyNeedsAttention(slug: string | null | undefined): boolean {
  const s = String(slug ?? "").toLowerCase().replace(/_/g, "-");
  if (!s) return false;
  const normal = ["new", "scheduled", "collecting", "collected", "in-transit", "out-for-delivery", "delivered", "ready-to-pick-up", "ready-for-pickup", "ready-to-collect"];
  return !normal.includes(s);
}

// What the customer sees on their order (our own wording). null = internal.
export function boxyTrack(slug: string | null | undefined): string | null {
  const s = String(slug ?? "").toLowerCase().replace(/_/g, "-");
  const map: Record<string, string> = {
    new: "طلبك جاهز وبانتظار استلام شركة التوصيل",
    scheduled: "حُجز موعد استلام طلبك من شركة التوصيل",
    collecting: "مندوب التوصيل في طريقه لاستلام طلبك",
    collected: "استلمت شركة التوصيل طلبك",
    "in-transit": "طلبك في طريقه إليك",
    "out-for-delivery": "طلبك مع مندوب التوصيل في طريقه إليك",
    delivered: "تم تسليم طلبك. بالهناء والعافية",
    "partially-delivered": "سُلّم جزء من طلبك. سنتواصل معك",
    returned: "سيُعاد إرسال طلبك إليك قريبًا",
    "on-hold": "نحتاج إلى تأكيد رقم هاتفك أو عنوانك. سنتواصل معك",
    postponed: "تأجّل التوصيل",
    "returned-warehouse": "سيُعاد إرسال طلبك إليك قريبًا",
    "returning-origin": "سيُعاد إرسال طلبك إليك قريبًا",
  };
  return map[s] ?? null;
}

// Boxy takes the order as products; the driver collects their total. Jars (price 0 when the
// customer already paid) plus the delivery fee line when the driver collects it, so the total
// always equals what the driver must collect (same rule as Modon).
export function boxyProducts(o: {
  items?: ({ nameAr?: string | null; qty: number; price: number } | null)[] | null;
  total: number;
  paid?: boolean | null;
  freeDelivery?: boolean | null;
  deliveryPaid?: boolean | null;
}): { title: string; price: number; quantity: number }[] {
  const paid = Boolean(o.paid);
  const jars = (o.items ?? [])
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .map((i) => ({ title: String(i.nameAr ?? "ترافل ÉLUE"), price: paid ? 0 : i.price, quantity: i.qty }));
  // A coupon or credit: the jars' prices are lowered so they add up to the order's total.
  const goods = jars.reduce((n, l) => n + l.price * l.quantity, 0);
  const lines = paid ? jars : spreadDiscount(jars, goods - o.total);
  if (deliveryPayOf(o) === "driver") lines.push({ title: "رسوم التوصيل", price: site.deliveryFee, quantity: 1 });
  return lines;
}

export const boxyCollect = (o: Parameters<typeof boxyProducts>[0]) => modonCollect(o.total, Boolean(o.paid), deliveryPayOf(o));
