// Wholesale (B2B) orders: placed by the team only, for a business, at a team-set jar price.
// No coupons, credit or gift campaigns, and never reported to Meta (team orders never are).
// Retail stays the default: an order without saleType is a retail order.

export const WHOLESALE = "WHOLESALE";
export const DEFAULT_WHOLESALE_PRICE = 12_000; // until the team saves its own (WholesaleSetting)
export const WHOLESALE_SETTING_ID = "default";

export type SaleKind = "retail" | "wholesale";
export const SALE_LABELS: Record<SaleKind, string> = { retail: "مفرد", wholesale: "جملة" };

export const isWholesale = (o: { saleType?: string | null } | null | undefined) => o?.saleType === WHOLESALE;
export const saleKindOf = (o: { saleType?: string | null }): SaleKind => (isWholesale(o) ? "wholesale" : "retail");

// A jar price the team typed: whole dinars, 250 to 1,000,000.
export function cleanUnitPrice(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[^\d]/g, "")) : Number(v);
  return Number.isInteger(n) && n >= 250 && n <= 1_000_000 ? n : null;
}
