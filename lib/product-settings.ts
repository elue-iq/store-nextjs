// What the team sets per flavor on /admin «المنتجات» (ProductSetting), read by the shop and the server:
// - available: false = «نفدت الكمية» (shown, can't be ordered);
// - hidden: true = taken off the shop (not shown, can't be ordered by customers; kept in the
//   system, old orders keep it, and the team can still sell it);
// - discount: dinars off each jar (not a percentage), shown to customers as the old price crossed out.

import type { Product } from "./products";

export type ProductSettingRow = { slug: string; available: boolean; hidden?: boolean | null; discount?: number | null };

export const MIN_JAR_PRICE = 250;

// A discount that leaves at least MIN_JAR_PRICE: whole dinars, 0 = none.
export function cleanDiscount(v: unknown, price: number): number {
  const n = typeof v === "string" ? Number(v.replace(/[^\d]/g, "")) : Number(v);
  if (!Number.isInteger(n) || n <= 0) return 0;
  return Math.min(n, Math.max(0, price - MIN_JAR_PRICE));
}

export type Catalog = {
  available: (slug: string) => boolean; // can a customer order it now
  listed: (slug: string) => boolean; // is it shown in the shop
  hidden: (slug: string) => boolean;
  soldOut: (slug: string) => boolean;
  discount: (p: Product) => number;
  price: (p: Product) => number; // the jar price customers pay (site price − discount)
};

export function catalogFrom(rows: ProductSettingRow[] | null | undefined): Catalog {
  const by = new Map((rows ?? []).map((r) => [r.slug, r]));
  const hidden = (slug: string) => Boolean(by.get(slug)?.hidden);
  const soldOut = (slug: string) => by.get(slug)?.available === false;
  const discount = (p: Product) => cleanDiscount(by.get(p.slug)?.discount, p.price);
  return {
    available: (slug) => !hidden(slug) && !soldOut(slug),
    listed: (slug) => !hidden(slug),
    hidden,
    soldOut,
    discount,
    price: (p) => p.price - discount(p),
  };
}
