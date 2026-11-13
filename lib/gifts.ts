// Gift jars: a real product line on the order (price 0, gift = true), given by a gift
// campaign (set by the team on /admin) or added by hand by the team («هدية يدوية»).
// Plain TypeScript with relative imports only: shared by the website and the functions.
//
// On an order:
//   items[]         paid lines, then gift lines ({ gift: true, price: 0, campaignId })
//   jars            PAID jars only (free delivery, coupons, commission and stats count these)
//   giftUnits       gift jars on the order
//   giftCampaignId  the campaign the gifts belong to, or "manual"
// Everything that counts pieces to pack or deliver uses piecesOf() = jars + giftUnits.

import { getProduct } from "./products";

export const MANUAL_GIFT = "manual";
export const GIFT_TAG = "هدية";
export const MAX_GIFT_UNITS = 20;

export type GiftPick = { slug: string; qty: number };

type ItemLike = { slug?: string | null; nameAr?: string | null; nameEn?: string | null; qty: number; price?: number | null; gift?: boolean | null; campaignId?: string | null };

const real = <T>(items: readonly (T | null | undefined)[] | null | undefined): T[] =>
  (items ?? []).filter((i): i is T => Boolean(i));

export const isGiftLine = (i: { gift?: boolean | null } | null | undefined): boolean => Boolean(i?.gift);

export function paidLines<T extends { gift?: boolean | null }>(items: readonly (T | null | undefined)[] | null | undefined): T[] {
  return real(items).filter((i) => !i.gift);
}

export function giftLines<T extends { gift?: boolean | null }>(items: readonly (T | null | undefined)[] | null | undefined): T[] {
  return real(items).filter((i) => Boolean(i.gift));
}

export function giftUnitsOf(items: readonly (ItemLike | null | undefined)[] | null | undefined): number {
  return giftLines(items).reduce((n, i) => n + i.qty, 0);
}

// Pieces in the parcel: paid jars + gift jars.
export function piecesOf(o: { jars?: number | null; giftUnits?: number | null; items?: readonly (ItemLike | null | undefined)[] | null }): number {
  const paid = o.jars ?? paidLines(o.items).reduce((n, i) => n + i.qty, 0);
  const gifts = o.giftUnits ?? giftUnitsOf(o.items);
  return paid + gifts;
}

// «بندق (هدية)» for lists and messages.
export function itemNameAr(i: ItemLike): string {
  const name = getProduct(i.slug ?? "")?.nameAr ?? i.nameAr ?? "";
  return i.gift ? `${name} (${GIFT_TAG})` : name;
}

// «2 علب + 1 هدية» when there are gifts, else null.
export function giftCountText(o: { jars?: number | null; giftUnits?: number | null }): string | null {
  return o.giftUnits ? `${o.jars ?? 0} + ${o.giftUnits} ${GIFT_TAG}` : null;
}

// What the browser sends: [{slug, qty}], cleaned (known flavors, whole numbers, merged per flavor).
export function cleanGiftPicks(raw: unknown): GiftPick[] {
  let list: unknown = raw;
  for (let i = 0; i < 3 && typeof list === "string"; i++) {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const merged = new Map<string, number>();
  for (const item of list.slice(0, 40)) {
    const slug = String((item as GiftPick | null)?.slug ?? "");
    const qty = Math.floor(Number((item as GiftPick | null)?.qty));
    if (!getProduct(slug) || !Number.isFinite(qty) || qty < 1) continue;
    merged.set(slug, Math.min(MAX_GIFT_UNITS, (merged.get(slug) ?? 0) + qty));
  }
  return [...merged].map(([slug, qty]) => ({ slug, qty }));
}

// The offer as the shop shows it (query «giftOffer», and «quote» for a cart).
export type GiftOffer = {
  id: string;
  banner: string;
  products: string[]; // flavors the customer may choose from
  perOrder: number; // gift jars per order
  minPaidJars: number;
  endsAt: string | null;
};

// For one cart and customer: can they get the gift now, and if not, why.
export type GiftReason = "min_jars" | "limit";
export type GiftQuote = GiftOffer & { eligible: boolean; reason: GiftReason | null };

// Why an order was placed without the gift the customer chose (placeOrder's giftNote).
export type GiftDrop = "ended" | "cap" | "limit" | "min_jars" | "changed";

export const GIFT_DROP_TEXT: Record<GiftDrop, string> = {
  ended: "انتهى عرض الهدية قبل لحظات، فثبّتنا طلبكم بدون الهدية.",
  cap: "خلصت كمية الهدايا قبل لحظات، فثبّتنا طلبكم بدون الهدية.",
  limit: "الهدية مرة وحدة لكل رقم، وهذا الرقم استلمها من قبل. ثبّتنا طلبكم بدون الهدية.",
  min_jars: "الطلب ما وصل للحد المطلوب للهدية، فثبّتناه بدون الهدية.",
  changed: "تغيّر عرض الهدية قبل لحظات، فثبّتنا طلبكم بدون الهدية.",
};

// The team's own errors when a campaign gift can't be added to an order.
export const GIFT_TEAM_ERROR: Record<string, string> = {
  ended: "الحملة غير فعّالة الآن (متوقفة أو خارج وقتها). اختر «هدية يدوية».",
  cap: "خلصت كمية هدايا الحملة. اختر «هدية يدوية» إذا تريد تضيفها.",
  limit: "هذا الرقم استلم هدية الحملة من قبل. اختر «هدية يدوية» إذا تريد تضيفها.",
  min_jars: "الطلب أقل من الحد المطلوب للهدية بهذه الحملة.",
  product: "واحدة من النكهات مو ضمن هدايا الحملة.",
  qty: "عدد الهدايا أكثر من المسموح بالطلب الواحد بهذه الحملة.",
  changed: "تغيّرت الحملة. حدّث الصفحة وحاول مجدداً.",
};

// ---- Campaign times: typed and shown in Baghdad time (UTC+3, no daylight saving) ----

const BAGHDAD_OFFSET = "+03:00";

// "2026-11-15T23:59" (a datetime-local value, Baghdad time) -> ISO in UTC. "" -> null.
export function baghdadInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00${BAGHDAD_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ISO -> "2026-11-15T23:59" in Baghdad time (for a datetime-local input). null -> "".
export function isoToBaghdadInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + 3 * 3600_000).toISOString().slice(0, 16);
}

export type GiftCampaignLike = {
  active?: boolean | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

// Live = switched on and inside its dates.
export function giftCampaignLive(c: GiftCampaignLike | null | undefined, now = new Date()): boolean {
  if (!c || c.active !== true) return false;
  if (c.startsAt && now < new Date(c.startsAt)) return false;
  if (c.endsAt && now > new Date(c.endsAt)) return false;
  return true;
}
