"use client";

import { useEffect, useState } from "react";
import { products } from "@/lib/products";
import { dataClient } from "@/lib/data";
import { useToast } from "./Toast";
import { useStock } from "./StockProvider";

// The «المنتجات» screen of /admin: switch each flavor between in stock and sold out.
// The shop reads this straight away; placeOrder refuses sold-out flavors.
export function AdminStock() {
  const toast = useToast();
  const stock = useStock();
  const [available, setAvailable] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    dataClient.models.ProductSetting.list({ limit: 100 })
      .then(({ data }) => {
        const map: Record<string, boolean> = {};
        for (const p of products) map[p.slug] = true;
        for (const s of data ?? []) map[s.slug] = s.available;
        setAvailable(map);
      })
      .catch(() => toast({ id: "stock", tone: "attention", message: "تعذّر تحميل حالة المنتجات. حدّث الصفحة." }));
  }, [toast]);

  async function set(slug: string, nameAr: string, value: boolean) {
    if (!available || available[slug] === value) return;
    setSaving(slug);
    let res = await dataClient.models.ProductSetting.update({ slug, available: value });
    if (!res.data) res = await dataClient.models.ProductSetting.create({ slug, available: value });
    setSaving(null);
    if (!res.data || res.errors?.length) {
      console.error("stock update failed", res.errors);
      toast({ id: "stock", tone: "attention", message: `تعذّر حفظ حالة ${nameAr}. حاول مجددًا.` });
      return;
    }
    setAvailable({ ...available, [slug]: value });
    void stock.refresh();
    toast({ id: "stock", message: value ? `${nameAr}: متوفر` : `${nameAr}: نفدت الكمية` });
  }

  return (
    <section className="admin-section admin-section--screen">
      <p className="hint">
        بدّل حالة كل نكهة بين «متوفر» و«نفدت الكمية». يظهر التغيير في المتجر فورًا، ولا يقبل الموقع طلبًا لنكهة نفدت.
      </p>
      {available === null ? (
        <p className="panel-loading">جارٍ تحميل المنتجات…</p>
      ) : (
        <ul className="stock-list">
          {products.map((p) => (
            <li key={p.slug} className="stock-item">
              <span className="stock-item__name">
                {p.nameAr}
                <small dir="ltr">{p.nameEn}</small>
              </span>
              <span className="stock-switch" role="group" aria-label={`حالة ${p.nameAr}`}>
                <button
                  type="button"
                  className="is-on"
                  aria-pressed={available[p.slug]}
                  disabled={saving === p.slug}
                  onClick={() => void set(p.slug, p.nameAr, true)}
                >
                  متوفر
                </button>
                <button
                  type="button"
                  className="is-off"
                  aria-pressed={!available[p.slug]}
                  disabled={saving === p.slug}
                  onClick={() => void set(p.slug, p.nameAr, false)}
                >
                  نفدت الكمية
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
