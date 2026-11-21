"use client";

// A flavor's jar price in the shop. With a discount from the team: the old price crossed out,
// the new one, and how much is saved. Without the settings yet: the site price.

import { getProduct } from "@/lib/products";
import { formatIQD } from "@/lib/site";
import { useStock } from "./StockProvider";

export function ProductPrice({ slug, suffix, className }: { slug: string; suffix?: string; className?: string }) {
  const stock = useStock();
  const p = getProduct(slug);
  if (!p) return null;
  const off = stock.discountOf(slug);
  if (!off) {
    return (
      <p className={className}>
        {formatIQD(p.price)}
        {suffix}
      </p>
    );
  }
  return (
    <p className={`${className ?? ""} has-discount`}>
      <del aria-label={`السعر قبل الخصم ${formatIQD(p.price)}`}>{formatIQD(p.price)}</del>{" "}
      <strong>{formatIQD(p.price - off)}</strong>
      {suffix}
      <span className="price-off">خصم {formatIQD(off)}</span>
    </p>
  );
}

// Shown only while the flavor is in the shop (not hidden by the team).
export function Listed({ slug, children }: { slug: string; children: React.ReactNode }) {
  const stock = useStock();
  return stock.isListed(slug) ? <>{children}</> : null;
}
