"use client";

import { itemNameAr } from "@/lib/gifts";
import { useMemo, useState } from "react";
import { useStock } from "./StockProvider";
import { products } from "@/lib/products";
import { STATUS_LABELS, type Order } from "@/lib/data";

type Filter = "CONFIRMED" | "NEW" | "ALL";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "CONFIRMED", label: "مؤكَّد" },
  { key: "NEW", label: "جديد" },
  { key: "ALL", label: "الكل" },
];

// «التجهيز» in /admin: what has to be prepared. Orders that are not yet on their way (confirmed by
// default: that is the point where the team starts preparing), added up per flavor, so whoever packs
// sees at once how many jars of each flavor are needed and whether a flavor is sold out.
export function AdminPrep({ orders, onOpenOrder }: { orders: Order[] | null; onOpenOrder: (orderNumber: string) => void }) {
  const stock = useStock();
  const [filter, setFilter] = useState<Filter>("CONFIRMED");

  const counts = useMemo(() => {
    const open = (orders ?? []).filter((o) => o.status === "NEW" || o.status === "CONFIRMED");
    return { CONFIRMED: open.filter((o) => o.status === "CONFIRMED").length, NEW: open.filter((o) => o.status === "NEW").length, ALL: open.length };
  }, [orders]);

  const picked = useMemo(
    () =>
      (orders ?? [])
        .filter((o) => (filter === "ALL" ? o.status === "NEW" || o.status === "CONFIRMED" : o.status === filter))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)), // oldest first: prepared first
    [orders, filter],
  );

  const perFlavor = useMemo(() => {
    const map = new Map<string, { slug: string; nameAr: string; jars: number; orders: number }>();
    for (const p of products) map.set(p.slug, { slug: p.slug, nameAr: p.nameAr, jars: 0, orders: 0 });
    for (const o of picked) {
      for (const i of o.items ?? []) {
        if (!i) continue;
        const slug = i.slug ?? i.nameAr;
        const row = map.get(slug) ?? { slug, nameAr: i.nameAr, jars: 0, orders: 0 };
        row.jars += i.qty;
        row.orders += 1;
        map.set(slug, row);
      }
    }
    return [...map.values()];
  }, [picked]);

  const totalJars = perFlavor.reduce((n, r) => n + r.jars, 0);

  if (orders === null) return <p className="panel-loading">جارٍ التحميل…</p>;

  return (
    <section className="admin-section admin-section--screen prep">
      <div className="prep__filters" role="group" aria-label="أي طلبات تُجهَّز">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" className={`prep__filter${filter === f.key ? " is-on" : ""}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label} <small>{counts[f.key]}</small>
          </button>
        ))}
      </div>
      <p className="hint">{filter === "ALL" ? "الكل: الطلبات الجديدة والمؤكَّدة التي لم تخرج للتوصيل بعد." : filter === "CONFIRMED" ? "الطلبات المؤكَّدة: جاهزة للتجهيز." : "طلبات جديدة لم تُؤكَّد بعد."}</p>

      {picked.length === 0 ? (
        <p className="prep__empty">ما كو طلبات بانتظار التجهيز.</p>
      ) : (
        <>
          <div className="prep__total">
            <strong>{totalJars}</strong> علبة للتجهيز
            <small>من {picked.length} طلب</small>
          </div>

          <ul className="prep__flavors">
            {perFlavor.map((r) => {
              const out = r.jars > 0 && !stock.isAvailable(r.slug);
              return (
                <li key={r.slug} className={`prep__flavor${r.jars === 0 ? " is-zero" : ""}${out ? " is-out" : ""}`}>
                  <span>
                    {r.nameAr}
                    {r.jars > 0 && <small>في {r.orders} {r.orders === 1 ? "طلب" : "طلبات"}</small>}
                    {out && <small className="prep__warn">⚠ نفدت الكمية في المتجر</small>}
                  </span>
                  <strong>{r.jars}</strong>
                </li>
              );
            })}
          </ul>

          <h2 className="prep__h">الطلبات (الأقدم أولاً)</h2>
          <ul className="prep__orders">
            {picked.map((o) => (
              <li key={o.id}>
                <button type="button" onClick={() => onOpenOrder(o.orderNumber)}>
                  <span>
                    <strong dir="ltr">{o.orderNumber}</strong> · {o.name}
                    {filter === "ALL" && <em className={`prep__chip is-${o.status.toLowerCase()}`}>{STATUS_LABELS[o.status]}</em>}
                  </span>
                  <small>
                    {(o.items ?? [])
                      .filter((i): i is NonNullable<typeof i> => Boolean(i))
                      .map((i) => `${itemNameAr(i)} × ${i.qty}`)
                      .join("، ")}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
