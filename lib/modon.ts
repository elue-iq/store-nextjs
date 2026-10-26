// Modon Express (delivery company) — shared by the modon function and the admin page.
// Plain TypeScript with relative imports only, so it bundles into the function.

import { site } from "./site";

// Modon's city ids (GET /citys). Halabja has no city of its own at Modon: it is
// served from Sulaymaniyah.
export const MODON_CITY: Record<string, number> = {
  بغداد: 1,
  كربلاء: 2,
  الأنبار: 3,
  بابل: 4,
  البصرة: 5,
  دهوك: 6,
  ديالى: 7,
  أربيل: 8,
  كركوك: 9,
  ميسان: 10,
  المثنى: 11,
  النجف: 12,
  نينوى: 13,
  القادسية: 14,
  "صلاح الدين": 15,
  السليمانية: 16,
  حلبجة: 16,
  "ذي قار": 17,
  واسط: 18,
};

export type ModonRegion = { id: number; name: string };

// What the driver collects from the customer. Two independent cases:
// - paid: the customer already paid the jars (e.g. Qi transfer), so the jars
//   drop out and only the delivery fee is collected.
// - freeDelivery: ÉLUE covers the delivery, so the fee drops out and only the
//   jars are collected. Modon still keeps its fee and pays ÉLUE that much less.
// Both can be true at once (prepaid jars + free delivery = driver collects 0).
export function modonCollect(total: number, paid = false, freeDelivery = false): number {
  return (paid ? 0 : total) + (freeDelivery ? 0 : site.deliveryFee);
}

// One short line describing how the collected amount breaks down, for the admin.
export function collectBreakdown(total: number, paid: boolean, freeDelivery: boolean): string {
  const parts: string[] = [];
  parts.push(paid ? "الطلب مدفوع مسبقاً" : `${total.toLocaleString("en-US")} الطلب`);
  parts.push(freeDelivery ? "التوصيل مجاني" : `${site.deliveryFee.toLocaleString("en-US")} التوصيل`);
  return parts.join(" · ");
}

// Arabic spelling differences that shouldn't matter when matching an area name.
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ْـ]/g, "") // harakat, tatweel
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^ء-ي0-9a-z\s]/gi, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^ال(?=..)/, ""))
    .filter(Boolean)
    .join(" ");
}

// The Modon region that best matches what the customer typed (area first, then
// the address line). null when nothing shares a word.
export function suggestRegion(regions: ModonRegion[], area: string, address: string): ModonRegion | null {
  const areaWords = normalizeArabic(area).split(" ").filter((w) => w.length > 1);
  const addressWords = normalizeArabic(address).split(" ").filter((w) => w.length > 2);
  let best: ModonRegion | null = null;
  let bestScore = 0;
  for (const r of regions) {
    const name = normalizeArabic(r.name);
    const words = name.split(" ");
    let score = 0;
    for (const w of areaWords) if (words.includes(w)) score += 10;
    for (const w of addressWords) if (words.includes(w)) score += 4;
    if (!score) continue;
    if (normalizeArabic(area) === name) score += 20; // exact area name
    score -= words.length * 0.5; // prefer the general name over long variants
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// Modon's status ids (from their /statuses list). Only the ones that matter to us.
// Our order status from a Modon status update. null = leave it as it is (still
// at ÉLUE, or a problem the team should look at: returned, refused, can't reach…).
export function statusFromModon(m: {
  status_id?: string | number | null;
  status?: string | null;
  deliver_done?: string | number | null;
}): "OUT_FOR_DELIVERY" | "DELIVERED" | null {
  const id = String(m.status_id ?? "");
  // Delivered: Modon's own flag, «تم تسليم الطلب الى الزبون» (4), or delivered with a return taken back (21).
  if (String(m.deliver_done ?? "") === "1" || id === "4" || id === "21") return "DELIVERED";
  // In the courier's hands, on its way, or sorted at one of its offices/warehouses.
  if (["2", "3", "5", "6", "7", "12", "13", "14", "22", "44"].includes(id)) return "OUT_FOR_DELIVERY";
  return null; // new at Modon (1), returned / refused / postponed / unreachable / disabled…
}

// What the customer sees on their order for a Modon status (our own wording).
// null = internal to the courier, not shown to the customer.
export function customerTrack(statusId: string | number | null | undefined): string | null {
  const id = String(statusId ?? "");
  const map: Record<string, string> = {
    "1": "طلبك جاهز وبانتظار استلام شركة التوصيل",
    "2": "استلمت شركة التوصيل طلبك",
    "3": "طلبك مع مندوب التوصيل في طريقه إليك",
    "4": "تم تسليم طلبك. بالهناء والعافية",
    "5": "طلبك في موقع الفرز في بغداد",
    "6": "طلبك في مكتب محافظتك",
    "7": "طلبك في طريقه إلى محافظتك",
    "12": "طلبك في مخازن شركة التوصيل",
    "13": "طلبك في مخازن شركة التوصيل",
    "14": "سيُعاد إرسال طلبك إليك قريبًا",
    "44": "سيُعاد إرسال طلبك إليك قريبًا",
    "22": "يُعاد فرز طلبك",
    "25": "تعذّر الوصول إليك هاتفيًا. أبقِ هاتفك مفتوحًا",
    "26": "تعذّر الوصول إليك هاتفيًا. أبقِ هاتفك مفتوحًا",
    "27": "تعذّر الوصول إليك هاتفيًا. أبقِ هاتفك مفتوحًا",
    "28": "تعذّر الوصول إليك هاتفيًا. أبقِ هاتفك مفتوحًا",
    "41": "تعذّر الوصول إليك هاتفيًا. أبقِ هاتفك مفتوحًا",
    "29": "تأجّل التوصيل",
    "30": "تأجّل التوصيل",
    "36": "نحتاج إلى تأكيد رقم هاتفك أو عنوانك. سنتواصل معك",
    "37": "نحتاج إلى تأكيد رقم هاتفك أو عنوانك. سنتواصل معك",
    "38": "نحتاج إلى تأكيد رقم هاتفك أو عنوانك. سنتواصل معك",
  };
  return map[id] ?? null;
}

// Modon times are Baghdad local time, "2026-10-26 12:32:20". null when empty/zero.
export function modonTime(s: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m || m[1] === "0000") return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export type TrackEvent = { at: string; text: string };

export function parseTrackEvents(raw: unknown): TrackEvent[] {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(v)
      ? v.filter((e): e is TrackEvent => Boolean(e) && typeof e.at === "string" && typeof e.text === "string")
      : [];
  } catch {
    return [];
  }
}
