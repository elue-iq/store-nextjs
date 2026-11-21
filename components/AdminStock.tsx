"use client";

import { useEffect, useState } from "react";
import { products } from "@/lib/products";
import { dataClient } from "@/lib/data";
import { useToast } from "./Toast";
import { useStock } from "./StockProvider";
import { formatIQD } from "@/lib/site";
import { cleanUnitPrice } from "@/lib/wholesale";
import { cleanDiscount } from "@/lib/product-settings";
import { loadWholesalePrice, saveWholesalePrice } from "@/lib/wholesale-admin";

// The «المنتجات» screen of /admin, per flavor: in stock or sold out, shown in the shop or
// hidden (kept in the system), and a discount in dinars off each jar (shown to customers).
// The shop reads this straight away; placeOrder checks and prices every order with it.
type Setting = { available: boolean; hidden: boolean; discount: number };

export function AdminStock() {
  const toast = useToast();
  const stock = useStock();
  const [settings, setSettings] = useState<Record<string, Setting> | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [discountText, setDiscountText] = useState<Record<string, string>>({});

  useEffect(() => {
    dataClient.models.ProductSetting.list({ limit: 100 })
      .then(({ data }) => {
        const map: Record<string, Setting> = {};
        for (const p of products) map[p.slug] = { available: true, hidden: false, discount: 0 };
        for (const s of data ?? []) map[s.slug] = { available: s.available, hidden: Boolean(s.hidden), discount: s.discount ?? 0 };
        setSettings(map);
      })
      .catch(() => toast({ id: "stock", tone: "attention", message: "تعذّر تحميل حالة المنتجات. حدّث الصفحة." }));
  }, [toast]);

  async function save(slug: string, nameAr: string, change: Partial<Setting>, done: string) {
    if (!settings) return;
    setSaving(slug);
    let res = await dataClient.models.ProductSetting.update({ slug, ...change });
    if (!res.data) res = await dataClient.models.ProductSetting.create({ slug, ...settings[slug], ...change });
    setSaving(null);
    if (!res.data || res.errors?.length) {
      console.error("product setting update failed", res.errors);
      toast({ id: "stock", tone: "attention", message: `تعذّر حفظ ${nameAr}. حاول مجددًا.` });
      return false;
    }
    setSettings({ ...settings, [slug]: { ...settings[slug], ...change } });
    void stock.refresh();
    toast({ id: "stock", message: `${nameAr}: ${done}` });
    return true;
  }

  return (
    <section className="admin-section admin-section--screen">
      <WholesalePrice />
      <p className="hint">
        لكل نكهة: «متوفر» أو «نفدت الكمية»، «ظاهر» أو «مخفي» (يختفي من المتجر ويبقى بالنظام وبالطلبات القديمة، والفريق يگدر يبيعه)،
        وخصم بالدينار على العلبة يشوفه الزبون. يظهر التغيير بالمتجر فوراً.
      </p>
      {settings === null ? (
        <p className="panel-loading">جارٍ تحميل المنتجات…</p>
      ) : (
        <ul className="stock-list">
          {products.map((p) => {
            const st = settings[p.slug];
            const typed = discountText[p.slug] ?? (st.discount ? String(st.discount) : "");
            const off = cleanDiscount(typed, p.price);
            const busy = saving === p.slug;
            return (
              <li key={p.slug} className={`stock-item${st.hidden ? " is-hidden" : ""}`}>
                <span className="stock-item__name">
                  {p.nameAr}
                  {st.hidden && <span className="stock-item__tag">مخفي</span>}
                  <small dir="ltr">{p.nameEn}</small>
                </span>
                <span className="stock-switch" role="group" aria-label={`حالة ${p.nameAr}`}>
                  <button type="button" className="is-on" aria-pressed={st.available} disabled={busy} onClick={() => st.available || void save(p.slug, p.nameAr, { available: true }, "متوفر")}>
                    متوفر
                  </button>
                  <button type="button" className="is-off" aria-pressed={!st.available} disabled={busy} onClick={() => !st.available || void save(p.slug, p.nameAr, { available: false }, "نفدت الكمية")}>
                    نفدت الكمية
                  </button>
                </span>
                <span className="stock-switch" role="group" aria-label={`ظهور ${p.nameAr} بالمتجر`}>
                  <button type="button" className="is-on" aria-pressed={!st.hidden} disabled={busy} onClick={() => !st.hidden || void save(p.slug, p.nameAr, { hidden: false }, "ظاهر بالمتجر")}>
                    ظاهر
                  </button>
                  <button type="button" className="is-off" aria-pressed={st.hidden} disabled={busy} onClick={() => st.hidden || void save(p.slug, p.nameAr, { hidden: true }, "مخفي من المتجر")}>
                    مخفي
                  </button>
                </span>
                <form
                  className="stock-discount"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(p.slug, p.nameAr, { discount: off }, off ? `خصم ${formatIQD(off)}، السعر ${formatIQD(p.price - off)}` : "بلا خصم").then(
                      (ok) => ok && setDiscountText((t) => ({ ...t, [p.slug]: off ? String(off) : "" })),
                    );
                  }}
                >
                  <label>
                    خصم على العلبة (دينار)
                    <input
                      inputMode="numeric"
                      dir="ltr"
                      placeholder="0"
                      value={typed}
                      onChange={(e) => setDiscountText((t) => ({ ...t, [p.slug]: e.target.value.replace(/[^\d]/g, "") }))}
                    />
                  </label>
                  <button type="submit" className="btn btn--quiet btn--small" disabled={busy || off === st.discount}>
                    حفظ
                  </button>
                  <small>
                    {off ? (
                      <>
                        <del>{formatIQD(p.price)}</del> ← <strong>{formatIQD(p.price - off)}</strong>
                      </>
                    ) : (
                      `السعر ${formatIQD(p.price)}`
                    )}
                  </small>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// The default wholesale (B2B) jar price: filled in on every new wholesale order, and can still
// be changed on the order itself. Retail stays the site price.
function WholesalePrice() {
  const toast = useToast();
  const [saved, setSaved] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void loadWholesalePrice().then((p) => {
      setSaved(p);
      setText(String(p));
    });
  }, []);
  const value = cleanUnitPrice(text);

  async function save() {
    if (!value || busy) return;
    setBusy(true);
    const ok = await saveWholesalePrice(value);
    setBusy(false);
    if (!ok) return toast({ id: "wholesale", tone: "attention", message: "تعذّر حفظ سعر الجملة. حاول مجددًا." });
    setSaved(value);
    toast({ id: "wholesale", message: `سعر الجملة صار ${formatIQD(value)} للعلبة.` });
  }

  return (
    <div className="wholesale-price">
      <h2>سعر الجملة</h2>
      <p className="hint">ينكتب تلقائياً بكل طلب جملة جديد، وتگدر تغيّره بالطلب نفسه. سعر المفرد يبقى سعر الموقع.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className={text && !value ? "has-error" : undefined}>
          سعر العلبة (دينار)
          <input inputMode="numeric" dir="ltr" value={text} onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))} disabled={saved === null} />
        </label>
        <button type="submit" className="btn" disabled={!value || value === saved || busy}>
          حفظ
        </button>
      </form>
    </div>
  );
}
