"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "./Toast";
import { dataClient, type Campaign, type CouponRecord, type Order } from "@/lib/data";
import {
  COUPON_KIND_LABELS,
  COUPON_KINDS,
  codeValid,
  couponLabel,
  normalizeCode,
  type CouponKind,
} from "@/lib/coupons";
import { formatIQD, minusIQD } from "@/lib/site";

// «الكوبونات»: discount codes. Each card shows how the code is doing (orders, discount given,
// sales), and the form covers every kind with its limits. Rules: lib/coupons.ts.

type Draft = {
  editing: boolean;
  code: string;
  title: string;
  kind: CouponKind;
  value: string;
  maxDiscount: string;
  buyQty: string;
  freeQty: string;
  minJars: string;
  startsAt: string; // YYYY-MM-DD (Baghdad)
  endsAt: string;
  maxUses: string;
  perCustomer: string;
  firstOrderOnly: boolean;
  active: boolean;
};

const EMPTY: Draft = {
  editing: false,
  code: "",
  title: "",
  kind: "PERCENT",
  value: "10",
  maxDiscount: "",
  buyQty: "2",
  freeQty: "1",
  minJars: "",
  startsAt: "",
  endsAt: "",
  maxUses: "",
  perCustomer: "1",
  firstOrderOnly: false,
  active: true,
};

// Ready-made starting points: one tap fills the form.
const PRESETS: { label: string; draft: Partial<Draft> }[] = [
  { label: "10% لأول طلب", draft: { kind: "PERCENT", value: "10", firstOrderOnly: true, code: "WELCOME10", title: "ترحيب بالعملاء الجدد" } },
  { label: "توصيل مجاني", draft: { kind: "FREE_DELIVERY", code: "FREEDEL", title: "توصيل مجاني" } },
  { label: "2 + 1 مجاناً", draft: { kind: "FREE_JARS", buyQty: "2", freeQty: "1", minJars: "3", code: "TAKE3", title: "علبة مجانية مع كل علبتين" } },
  { label: "كاش باك 10%", draft: { kind: "CASHBACK", value: "10", maxDiscount: "5000", code: "BACK10", title: "رصيد للطلب الجاي" } },
];

const int = (s: string) => {
  const n = Math.floor(Number(String(s).replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00+03:00`).toISOString() : null);
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59+03:00`).toISOString() : null);
const toDay = (iso?: string | null) =>
  iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date(iso)) : "";

export function couponState(c: Pick<CouponRecord, "active" | "startsAt" | "endsAt">, now = new Date()): { text: string; tone: "on" | "off" | "wait" } {
  if (c.active === false) return { text: "موقوف", tone: "off" };
  if (c.endsAt && now > new Date(c.endsAt)) return { text: "منتهي", tone: "off" };
  if (c.startsAt && now < new Date(c.startsAt)) return { text: `يبدأ ${toDay(c.startsAt)}`, tone: "wait" };
  return { text: "فعّال", tone: "on" };
}

export function AdminCoupons({ orders, onOpenOrder }: { orders: Order[] | null; onOpenOrder: (n: string) => void }) {
  const toast = useToast();
  const [list, setList] = useState<CouponRecord[] | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, k] = await Promise.all([
      dataClient.models.Coupon.list({ limit: 1000 }),
      dataClient.models.Campaign.list({ limit: 1000 }),
    ]);
    setList([...(c.data ?? [])].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
    setCampaigns(k.data ?? []);
  }, []);
  useEffect(() => {
    void load().catch(() => setList([]));
  }, [load]);

  // Orders per code (cancelled ones don't count).
  const usage = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders ?? []) {
      if (!o.couponCode || o.status === "CANCELLED") continue;
      m.set(o.couponCode, [...(m.get(o.couponCode) ?? []), o]);
    }
    return m;
  }, [orders]);

  function edit(c: CouponRecord) {
    setError("");
    setDraft({
      editing: true,
      code: c.code,
      title: c.title ?? "",
      kind: (c.kind as CouponKind) ?? "PERCENT",
      value: c.value ? String(c.value) : "",
      maxDiscount: c.maxDiscount ? String(c.maxDiscount) : "",
      buyQty: c.buyQty ? String(c.buyQty) : "2",
      freeQty: c.freeQty ? String(c.freeQty) : "1",
      minJars: c.minJars ? String(c.minJars) : "",
      startsAt: toDay(c.startsAt),
      endsAt: toDay(c.endsAt),
      maxUses: c.maxUses ? String(c.maxUses) : "",
      perCustomer: c.perCustomer ? String(c.perCustomer) : "1",
      firstOrderOnly: Boolean(c.firstOrderOnly),
      active: c.active !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!draft) return;
    const code = normalizeCode(draft.code);
    if (!codeValid(code)) return setError("الكود من 3 إلى 32: حروف إنجليزية وأرقام فقط، مثل NOOR10.");
    if (!draft.editing && list?.some((c) => c.code === code)) return setError("هذا الكود موجود. اختر كود ثاني.");
    const value = int(draft.value);
    if ((draft.kind === "PERCENT" || draft.kind === "CASHBACK") && (!value || value > 100)) return setError("اكتب نسبة من 1 إلى 100.");
    if (draft.kind === "FIXED" && !value) return setError("اكتب مبلغ الخصم بالدينار.");
    if (draft.kind === "FREE_JARS" && (!int(draft.buyQty) || !int(draft.freeQty))) return setError("اكتب كم علبة يشتري وكم علبة مجانية.");
    if (draft.startsAt && draft.endsAt && draft.endsAt < draft.startsAt) return setError("تاريخ النهاية قبل تاريخ البداية.");
    setError("");
    const rec = {
      code,
      title: draft.title.trim() || null,
      kind: draft.kind,
      value: draft.kind === "FREE_DELIVERY" || draft.kind === "FREE_JARS" ? null : value,
      maxDiscount: draft.kind === "PERCENT" || draft.kind === "CASHBACK" ? int(draft.maxDiscount) : null,
      buyQty: draft.kind === "FREE_JARS" ? int(draft.buyQty) : null,
      freeQty: draft.kind === "FREE_JARS" ? int(draft.freeQty) : null,
      minJars: int(draft.minJars),
      startsAt: dayStart(draft.startsAt),
      endsAt: dayEnd(draft.endsAt),
      maxUses: int(draft.maxUses),
      perCustomer: int(draft.perCustomer) ?? 1,
      firstOrderOnly: draft.firstOrderOnly,
      active: draft.active,
    };
    setBusy("save");
    const { errors } = draft.editing ? await dataClient.models.Coupon.update(rec) : await dataClient.models.Coupon.create(rec);
    setBusy(null);
    if (errors?.length) {
      console.error("coupon save failed", errors);
      return toast({ id: "coupon", tone: "attention", message: "تعذّر حفظ الكود. حاول مجددًا." });
    }
    toast({ id: "coupon", message: `حُفظ الكود ${code}.` });
    setDraft(null);
    await load();
  }

  async function toggle(c: CouponRecord) {
    setBusy(c.code);
    await dataClient.models.Coupon.update({ code: c.code, active: c.active === false });
    setBusy(null);
    await load();
  }

  async function remove(c: CouponRecord) {
    setBusy(c.code);
    const { errors } = await dataClient.models.Coupon.delete({ code: c.code });
    setBusy(null);
    if (errors?.length) return toast({ id: "coupon", tone: "attention", message: "تعذّر الحذف." });
    toast({ id: "coupon", message: `حُذف الكود ${c.code}.` });
    await load();
  }

  const preview = draft
    ? couponLabel({
        code: draft.code,
        kind: draft.kind,
        value: int(draft.value),
        maxDiscount: int(draft.maxDiscount),
        buyQty: int(draft.buyQty),
        freeQty: int(draft.freeQty),
      })
    : "";

  const form = draft && (
    <section className="order-detail__block">
      <h2>{draft.editing ? `تعديل ${draft.code}` : "كود خصم جديد"}</h2>
      {!draft.editing && (
        <div className="chip-row" role="group" aria-label="قوالب جاهزة">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="chip" onClick={() => setDraft({ ...EMPTY, ...p.draft })}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <form
        className="panel-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          الكود
          <input
            value={draft.code}
            disabled={draft.editing}
            onChange={(e) => setDraft({ ...draft, code: normalizeCode(e.target.value) })}
            dir="ltr"
            autoCapitalize="characters"
            maxLength={32}
            placeholder="NOOR10"
          />
          <small className="field-hint">حروف إنجليزية وأرقام. ما يتغيّر بعد الحفظ.</small>
        </label>
        <label>
          وصف داخلي (اختياري)
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={80} placeholder="مثل: حملة رمضان مع نور" />
        </label>
        <label>
          نوع الكود
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as CouponKind })}>
            {COUPON_KINDS.map((k) => (
              <option key={k} value={k}>
                {COUPON_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        {(draft.kind === "PERCENT" || draft.kind === "CASHBACK") && (
          <div className="form-row">
            <label>
              النسبة %
              <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} inputMode="numeric" dir="ltr" />
            </label>
            <label>
              حد أعلى بالدينار (اختياري)
              <input value={draft.maxDiscount} onChange={(e) => setDraft({ ...draft, maxDiscount: e.target.value })} inputMode="numeric" dir="ltr" placeholder="5000" />
            </label>
          </div>
        )}
        {draft.kind === "FIXED" && (
          <label>
            مبلغ الخصم بالدينار
            <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} inputMode="numeric" dir="ltr" placeholder="5000" />
          </label>
        )}
        {draft.kind === "FREE_JARS" && (
          <div className="form-row">
            <label>
              يشتري
              <input value={draft.buyQty} onChange={(e) => setDraft({ ...draft, buyQty: e.target.value })} inputMode="numeric" dir="ltr" />
            </label>
            <label>
              ويحصل مجاناً على
              <input value={draft.freeQty} onChange={(e) => setDraft({ ...draft, freeQty: e.target.value })} inputMode="numeric" dir="ltr" />
            </label>
          </div>
        )}
        <p className="coupon-preview">
          يشوفه العميل: <strong>{preview}</strong>
        </p>
        <div className="form-row">
          <label>
            يبدأ (اختياري)
            <input type="date" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
          </label>
          <label>
            ينتهي (اختياري)
            <input type="date" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
          </label>
        </div>
        <div className="form-row">
          <label>
            أقل عدد علب
            <input value={draft.minJars} onChange={(e) => setDraft({ ...draft, minJars: e.target.value })} inputMode="numeric" dir="ltr" placeholder="بدون" />
          </label>
          <label>
            مرات لكل عميل
            <input value={draft.perCustomer} onChange={(e) => setDraft({ ...draft, perCustomer: e.target.value })} inputMode="numeric" dir="ltr" />
          </label>
        </div>
        <label>
          عدد الاستخدامات الكلي (اختياري)
          <input value={draft.maxUses} onChange={(e) => setDraft({ ...draft, maxUses: e.target.value })} inputMode="numeric" dir="ltr" placeholder="بدون حد" />
          <small className="field-hint">يُحسب كل طلب يُرسل بالكود، حتى لو أُلغي بعدين.</small>
        </label>
        <label className="admin-order-form__check">
          <input type="checkbox" checked={draft.firstOrderOnly} onChange={(e) => setDraft({ ...draft, firstOrderOnly: e.target.checked })} />
          <span>لأول طلب للعميل فقط</span>
        </label>
        <label className="admin-order-form__check">
          <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          <span>فعّال</span>
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="order-detail__actions">
          <button type="submit" className="btn btn--full" disabled={busy === "save"}>
            {busy === "save" ? "جارٍ الحفظ…" : "حفظ الكود"}
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
          + كود خصم جديد
        </button>
      )}
      {list === null && <p className="panel-loading">جارٍ التحميل…</p>}
      {list && list.length === 0 && !draft && (
        <p className="hint">ما عندكم أكواد بعد. ابدأوا بقالب جاهز مثل «10% لأول طلب».</p>
      )}
      <ul className="coupon-list">
        {(list ?? []).map((c) => {
          const used = usage.get(c.code) ?? [];
          const delivered = used.filter((o) => o.status === "DELIVERED");
          const given = used.reduce((n, o) => n + (o.discount ?? 0), 0);
          const sales = delivered.reduce((n, o) => n + o.total, 0);
          const st = couponState(c);
          const campaign = campaigns.find((k) => k.id === c.campaignId || normalizeCode(k.couponCode) === c.code);
          const label = couponLabel({ ...c, kind: c.kind as CouponKind });
          return (
            <li key={c.code} className={`coupon-card is-${st.tone}`}>
              <div className="coupon-card__head">
                <strong dir="ltr">{c.code}</strong>
                <span className={`coupon-card__state is-${st.tone}`}>{st.text}</span>
              </div>
              <p className="coupon-card__label">{label}</p>
              <p className="coupon-card__rules">
                {[
                  c.title,
                  c.minJars ? `من ${c.minJars} علب` : null,
                  c.firstOrderOnly ? "أول طلب فقط" : null,
                  `${c.perCustomer ?? 1} لكل عميل`,
                  c.maxUses ? `${used.length}/${c.maxUses} استخدام` : null,
                  c.endsAt ? `حتى ${toDay(c.endsAt)}` : null,
                  campaign ? `حملة: ${campaign.name}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <dl className="coupon-card__stats">
                <div>
                  <dt>طلبات</dt>
                  <dd>{used.length}</dd>
                </div>
                <div>
                  <dt>مُسلّمة</dt>
                  <dd>{delivered.length}</dd>
                </div>
                <div>
                  <dt>خصم مُعطى</dt>
                  <dd>{formatIQD(given)}</dd>
                </div>
                <div>
                  <dt>مبيعات</dt>
                  <dd>{formatIQD(sales)}</dd>
                </div>
              </dl>
              <div className="couriers__actions">
                <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => edit(c)}>
                  تعديل
                </button>
                <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => void toggle(c)}>
                  {c.active === false ? "تفعيل" : "إيقاف"}
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--small"
                  onClick={() => {
                    void navigator.clipboard?.writeText(c.code);
                    toast({ id: "coupon", message: `نُسخ الكود ${c.code}.` });
                  }}
                >
                  نسخ
                </button>
                {used.length > 0 && (
                  <button type="button" className="btn btn--quiet btn--small" onClick={() => setOpenCode(openCode === c.code ? null : c.code)}>
                    الطلبات
                  </button>
                )}
                {used.length === 0 && (
                  <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => void remove(c)}>
                    حذف
                  </button>
                )}
              </div>
              {openCode === c.code && (
                <ul className="coupon-card__orders">
                  {used.map((o) => (
                    <li key={o.id}>
                      <button type="button" className="link-button" onClick={() => onOpenOrder(o.orderNumber)}>
                        <span dir="ltr">{o.orderNumber}</span>
                      </button>
                      <span>{o.name}</span>
                      <span>{minusIQD(o.discount ?? 0)}</span>
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
