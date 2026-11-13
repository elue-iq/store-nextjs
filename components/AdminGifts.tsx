"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "./Toast";
import { dataClient, type Order } from "@/lib/data";
import { products } from "@/lib/products";
import { baghdadInputToIso, giftCampaignLive, giftLines, isoToBaghdadInput } from "@/lib/gifts";
import { callGiftAdmin, listGiftCampaigns, type GiftCampaign, type GiftStatus } from "@/lib/gift-admin";

// «حملات الهدايا»: free jars given as real product lines on the order. The team sets the
// campaign here; the checkout shows it and placeOrder checks every rule again on the server
// (rules: lib/gifts.ts). One campaign is live at a time: switching one on switches the others off.

type Draft = {
  id: string | null;
  name: string;
  active: boolean;
  startsAt: string; // datetime-local, Baghdad time
  endsAt: string;
  banner: string;
  products: string[];
  perOrder: string;
  minPaidJars: string;
  cap: string;
  perPhone: string;
};

const EMPTY: Draft = {
  id: null,
  name: "",
  active: true,
  startsAt: "",
  endsAt: "",
  banner: "",
  products: products.map((p) => p.slug),
  perOrder: "1",
  minPaidJars: "1",
  cap: "",
  perPhone: "1",
};

const int = (s: string) => {
  const n = Math.floor(Number(String(s).replace(/[^\d]/g, "")));
  return Number.isFinite(n) ? n : NaN;
};

const when = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "";

function stateOf(c: GiftCampaign, now = new Date()): { text: string; tone: "on" | "off" | "wait" } {
  if (c.active !== true) return { text: "موقوفة", tone: "off" };
  if (c.endsAt && now > new Date(c.endsAt)) return { text: "انتهت", tone: "off" };
  if (c.startsAt && now < new Date(c.startsAt)) return { text: `تبدأ ${when(c.startsAt)}`, tone: "wait" };
  return { text: "فعّالة الآن", tone: "on" };
}

export function AdminGifts({ orders, onOpenOrder }: { orders: Order[] | null; onOpenOrder: (n: string) => void }) {
  const toast = useToast();
  const [list, setList] = useState<GiftCampaign[] | null>(null);
  const [status, setStatus] = useState<Record<string, GiftStatus>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const all = await listGiftCampaigns();
    setList(all);
    // Jars taken so far, from the server's own count (cancelled orders give theirs back).
    const entries = await Promise.all(
      all.map(async (c) => {
        const { data } = await callGiftAdmin({ action: "status", campaignId: c.id });
        return data ? ([c.id, data as unknown as GiftStatus] as const) : null;
      }),
    );
    setStatus(Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => Boolean(e))));
  }, []);
  useEffect(() => {
    void load().catch(() => setList([]));
  }, [load]);

  // Orders carrying each campaign's gift (cancelled ones don't count).
  const usage = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders ?? []) {
      if (!o.giftCampaignId || o.status === "CANCELLED") continue;
      m.set(o.giftCampaignId, [...(m.get(o.giftCampaignId) ?? []), o]);
    }
    return m;
  }, [orders]);

  function edit(c: GiftCampaign) {
    setError("");
    setDraft({
      id: c.id,
      name: c.name,
      active: c.active === true,
      startsAt: isoToBaghdadInput(c.startsAt),
      endsAt: isoToBaghdadInput(c.endsAt),
      banner: c.banner ?? "",
      products: (c.products ?? []).filter((s): s is string => Boolean(s)),
      perOrder: String(c.perOrder ?? 1),
      minPaidJars: String(c.minPaidJars ?? 1),
      cap: c.cap == null ? "" : String(c.cap),
      perPhone: String(c.perPhone ?? 1),
    });
    window.scrollTo({ top: 0 });
  }

  // One live campaign at a time: the others are switched off.
  async function switchOffOthers(keepId: string) {
    for (const c of list ?? []) {
      if (c.id !== keepId && c.active === true) await dataClient.models.GiftCampaign.update({ id: c.id, active: false });
    }
  }

  async function save() {
    if (!draft || busy) return;
    const perOrder = int(draft.perOrder);
    const minPaidJars = int(draft.minPaidJars);
    const cap = int(draft.cap);
    const perPhone = int(draft.perPhone);
    const startsAt = draft.startsAt ? baghdadInputToIso(draft.startsAt) : null;
    const endsAt = draft.endsAt ? baghdadInputToIso(draft.endsAt) : null;
    if (!draft.name.trim()) return setError("اكتب اسم الحملة.");
    if (!draft.products.length) return setError("اختر نكهة واحدة على الأقل كهدية.");
    if (!(perOrder >= 1 && perOrder <= 10)) return setError("عدد الهدايا بالطلب: من 1 إلى 10.");
    if (!(minPaidJars >= 0)) return setError("أقل عدد علب مدفوعة: رقم صحيح.");
    if (!(cap >= 1)) return setError("اكتب الكمية الكلية للهدايا (علبة واحدة على الأقل).");
    if (!(perPhone >= 1)) return setError("عدد الطلبات المهداة لكل رقم: 1 أو أكثر.");
    if (draft.startsAt && !startsAt) return setError("وقت البداية غير صحيح.");
    if (draft.endsAt && !endsAt) return setError("وقت النهاية غير صحيح.");
    if (startsAt && endsAt && endsAt <= startsAt) return setError("وقت النهاية لازم يكون بعد البداية.");
    setError("");
    setBusy("save");
    const fields = {
      name: draft.name.trim().slice(0, 80),
      active: draft.active,
      startsAt,
      endsAt,
      banner: draft.banner.trim().slice(0, 200) || null,
      products: draft.products,
      perOrder,
      minPaidJars,
      cap,
      perPhone,
    };
    const { data, errors } = draft.id
      ? await dataClient.models.GiftCampaign.update({ id: draft.id, ...fields })
      : await dataClient.models.GiftCampaign.create(fields);
    if (errors?.length || !data) {
      console.error("gift campaign save failed", errors);
      setBusy(null);
      return setError("تعذّر حفظ الحملة. حاول مجددًا.");
    }
    if (fields.active) await switchOffOthers(data.id);
    setBusy(null);
    setDraft(null);
    toast({ id: "gift", message: `حُفظت حملة «${fields.name}».` });
    await load();
  }

  async function toggle(c: GiftCampaign) {
    setBusy(c.id);
    const on = c.active !== true;
    const { errors } = await dataClient.models.GiftCampaign.update({ id: c.id, active: on });
    if (!errors?.length && on) await switchOffOthers(c.id);
    setBusy(null);
    if (errors?.length) return toast({ id: "gift", tone: "attention", message: "تعذّر تغيير حالة الحملة." });
    toast({ id: "gift", message: on ? `فُعّلت «${c.name}». أي حملة ثانية توقّفت.` : `أُوقفت «${c.name}».` });
    await load();
  }

  const form = draft && (
    <section className="order-detail__block">
      <h2>{draft.id ? `تعديل «${draft.name}»` : "حملة هدايا جديدة"}</h2>
      <form
        className="panel-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          اسم الحملة
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={80} placeholder="World Diabetes Day gift" />
        </label>
        <label>
          نص الشريط بالموقع (عربي)
          <textarea value={draft.banner} onChange={(e) => setDraft({ ...draft, banner: e.target.value })} rows={2} maxLength={200} placeholder="هدية من ELUE: علبة بالنكهة اللي تختارونها مع أي طلب" />
          <small className="field-hint">يظهر بأعلى الموقع طول ما الحملة فعّالة والكمية ما خلصت.</small>
        </label>
        <div className="form-row">
          <label>
            تبدأ (توقيت بغداد)
            <input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} dir="ltr" />
            <small className="field-hint">فارغ = من الآن.</small>
          </label>
          <label>
            تنتهي (توقيت بغداد)
            <input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} dir="ltr" />
          </label>
        </div>
        <fieldset className="admin-order-form__group">
          <legend>النكهات اللي يختار منها العميل هديته</legend>
          {products.map((p) => (
            <label key={p.slug} className="admin-order-form__check">
              <input
                type="checkbox"
                checked={draft.products.includes(p.slug)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    products: e.target.checked ? [...draft.products, p.slug] : draft.products.filter((s) => s !== p.slug),
                  })
                }
              />
              <span>
                {p.nameAr} <small dir="ltr">{p.nameEn}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="form-row">
          <label>
            هدايا بكل طلب
            <input value={draft.perOrder} onChange={(e) => setDraft({ ...draft, perOrder: e.target.value })} inputMode="numeric" dir="ltr" />
          </label>
          <label>
            أقل عدد علب مدفوعة
            <input value={draft.minPaidJars} onChange={(e) => setDraft({ ...draft, minPaidJars: e.target.value })} inputMode="numeric" dir="ltr" />
          </label>
        </div>
        <div className="form-row">
          <label>
            الكمية الكلية للهدايا
            <input value={draft.cap} onChange={(e) => setDraft({ ...draft, cap: e.target.value })} inputMode="numeric" dir="ltr" placeholder="60" />
            <small className="field-hint">من تخلص، يختفي العرض تلقائياً.</small>
          </label>
          <label>
            طلبات مهداة لكل رقم
            <input value={draft.perPhone} onChange={(e) => setDraft({ ...draft, perPhone: e.target.value })} inputMode="numeric" dir="ltr" />
          </label>
        </div>
        <label className="admin-order-form__check">
          <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          <span>فعّالة (تفعيلها يوقف أي حملة ثانية)</span>
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="order-detail__actions">
          <button type="submit" className="btn btn--full" disabled={busy === "save"}>
            {busy === "save" ? "جارٍ الحفظ…" : "حفظ الحملة"}
          </button>
          <button type="button" className="btn btn--quiet btn--full" onClick={() => setDraft(null)}>
            إلغاء
          </button>
        </div>
      </form>
    </section>
  );

  return (
    <div className="couriers coupons">
      {form ?? (
        <button type="button" className="btn btn--full" onClick={() => (setError(""), setDraft({ ...EMPTY }))}>
          + حملة هدايا جديدة
        </button>
      )}
      {list === null && <p className="panel-loading">جارٍ التحميل…</p>}
      {list && list.length === 0 && !draft && <p className="hint">ما عندكم حملات هدايا بعد.</p>}
      <ul className="coupon-list">
        {(list ?? []).map((c) => {
          const st = stateOf(c);
          const s = status[c.id];
          const used = usage.get(c.id) ?? [];
          const units = used.reduce((n, o) => n + (o.giftUnits ?? 0), 0);
          const byFlavor = new Map<string, number>();
          for (const o of used) for (const i of giftLines(o.items)) byFlavor.set(i.nameAr, (byFlavor.get(i.nameAr) ?? 0) + i.qty);
          const names = (c.products ?? []).map((slug) => products.find((p) => p.slug === slug)?.nameAr).filter(Boolean);
          const soldOut = giftCampaignLive(c) && s?.left === 0;
          return (
            <li key={c.id} className={`coupon-card is-${soldOut ? "off" : st.tone}`}>
              <div className="coupon-card__head">
                <strong>{c.name}</strong>
                <span className={`coupon-card__state is-${soldOut ? "off" : st.tone}`}>{soldOut ? "خلصت الكمية" : st.text}</span>
              </div>
              {c.banner && <p className="coupon-card__label">{c.banner}</p>}
              <p className="coupon-card__rules">
                {[
                  `${c.perOrder ?? 1} هدية بالطلب`,
                  `من ${c.minPaidJars ?? 1} علبة مدفوعة`,
                  `${c.perPhone ?? 1} لكل رقم`,
                  names.length === products.length ? "كل النكهات" : names.join("، "),
                  c.startsAt ? `من ${when(c.startsAt)}` : null,
                  c.endsAt ? `حتى ${when(c.endsAt)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <dl className="coupon-card__stats">
                <div>
                  <dt>هدايا مأخوذة</dt>
                  <dd>{s ? `${s.used}${s.cap != null ? ` / ${s.cap}` : ""}` : units}</dd>
                </div>
                <div>
                  <dt>المتبقي</dt>
                  <dd>{s?.left ?? "—"}</dd>
                </div>
                <div>
                  <dt>طلبات</dt>
                  <dd>{used.length}</dd>
                </div>
                <div>
                  <dt>علب مدفوعة</dt>
                  <dd>{used.reduce((n, o) => n + o.jars, 0)}</dd>
                </div>
              </dl>
              {byFlavor.size > 0 && <p className="coupon-card__rules">الهدايا حسب النكهة: {[...byFlavor].map(([n, q]) => `${n} × ${q}`).join("، ")}</p>}
              <div className="couriers__actions">
                <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => edit(c)}>
                  تعديل
                </button>
                <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => void toggle(c)}>
                  {c.active === true ? "إيقاف" : "تفعيل"}
                </button>
                {used.length > 0 && (
                  <button type="button" className="btn btn--quiet btn--small" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
                    الطلبات
                  </button>
                )}
              </div>
              {openId === c.id && (
                <ul className="coupon-card__orders">
                  {used.map((o) => (
                    <li key={o.id}>
                      <button type="button" className="link-button" onClick={() => onOpenOrder(o.orderNumber)}>
                        <span dir="ltr">{o.orderNumber}</span>
                      </button>
                      <span>{o.name}</span>
                      <span>
                        {giftLines(o.items)
                          .map((i) => `${i.nameAr} × ${i.qty}`)
                          .join("، ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
