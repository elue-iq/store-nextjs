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

// What the driver collects: the jars plus the delivery fee. Modon keeps the fee
// and pays ÉLUE the jars total.
export function modonCollect(total: number): number {
  return total + site.deliveryFee;
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

// Our status from a Modon status update. null = leave our status as it is
// (still at ÉLUE, or a problem the team should look at: returned, refused…).
export function statusFromModon(m: {
  status_id?: string | number | null;
  status?: string | null;
  deliver_done?: string | number | null;
}): "OUT_FOR_DELIVERY" | "DELIVERED" | null {
  const id = String(m.status_id ?? "");
  const text = String(m.status ?? "");
  if (String(m.deliver_done ?? "") === "1" || /تم التسليم|تم تسليم|واصل/.test(text)) return "DELIVERED";
  if (/راجع|رفض|الغاء|إلغاء|مؤجل|تأجيل|لا يرد|مغلق/.test(text)) return null;
  if (id && id !== "1") return "OUT_FOR_DELIVERY";
  return null;
}
