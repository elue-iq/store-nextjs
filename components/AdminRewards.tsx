"use client";

// «المكافآت»: the loyalty program for the team.
// - the program's numbers (points earned, used, given, still with customers, what they're worth);
// - the rewards customers buy with points: create from a ready template or from scratch, edit,
//   stop, see how each one is used;
// - give (or take back) points to one customer by WhatsApp number, with the reason.
// Rules: lib/loyalty.ts (earning) and lib/rewards.ts (rewards); the server checks every use.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "./Toast";
import { useAuth } from "./AuthProvider";
import { dataClient, type Order } from "@/lib/data";
import type { Schema } from "@/amplify/data/resource";
import { formatPoints, pointsSummary } from "@/lib/loyalty";
import {
  liveReward,
  needsProduct,
  needsValue,
  pointValueIQD,
  REWARD_KIND_LABELS,
  REWARD_KINDS,
  REWARD_TEMPLATES,
  rewardTitle,
  sortRewards,
  type Reward,
  type RewardKind,
} from "@/lib/rewards";
import { products, getProduct } from "@/lib/products";
import { formatIQD, minusIQD } from "@/lib/site";
import { normalizeIraqiMobile, formatIraqiMobile } from "@/lib/phone";

type RewardRecord = Schema["Reward"]["type"];
type GrantRecord = Schema["PointsGrant"]["type"];

const nameOf = (slug: string) => getProduct(slug)?.nameAr;
const int = (s: string) => {
  const n = Math.floor(Number(String(s).replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00+03:00`).toISOString() : null);
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59+03:00`).toISOString() : null);
const toDay = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date(iso)) : "");

type Draft = {
  id: string | null;
  kind: RewardKind;
  points: string;
  value: string;
  slug: string;
  title: string;
  minJars: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};
const EMPTY: Draft = { id: null, kind: "ORDER_OFF", points: "300", value: "2000", slug: products[0]?.slug ?? "", title: "", minJars: "", startsAt: "", endsAt: "", active: true };

function rewardState(r: Reward): { text: string; tone: "on" | "off" | "wait" } {
  if (r.active === false) return { text: "موقوفة", tone: "off" };
  if (r.endsAt && new Date() > new Date(r.endsAt)) return { text: "منتهية", tone: "off" };
  if (r.startsAt && new Date() < new Date(r.startsAt)) return { text: `تبدأ ${toDay(r.startsAt)}`, tone: "wait" };
  return { text: "فعّالة", tone: "on" };
}

export function AdminRewards({ orders, onOpenOrder }: { orders: Order[] | null; onOpenOrder: (n: string) => void }) {
  const toast = useToast();
  const auth = useAuth();
  const [rewards, setRewards] = useState<RewardRecord[] | null>(null);
  const [grants, setGrants] = useState<GrantRecord[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, g] = await Promise.all([dataClient.models.Reward.list({ limit: 200 }), dataClient.models.PointsGrant.list({ limit: 1000 })]);
    setRewards(sortRewards(r.data ?? []));
    setGrants([...(g.data ?? [])].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "")));
  }, []);
  useEffect(() => {
    void load().catch(() => (setRewards([]), setGrants([])));
  }, [load]);

  // Every customer's points, from their orders and the points the team gave them.
  const program = useMemo(() => {
    const byPhone = new Map<string, Order[]>();
    for (const o of orders ?? []) byPhone.set(o.phone, [...(byPhone.get(o.phone) ?? []), o]);
    const grantsBy = new Map<string, GrantRecord[]>();
    for (const g of grants ?? []) grantsBy.set(g.phone, [...(grantsBy.get(g.phone) ?? []), g]);
    const phones = new Set([...byPhone.keys(), ...grantsBy.keys()]);
    const live = (rewards ?? []).filter((r) => liveReward(r));
    const cheapest = live.length ? Math.min(...live.map((r) => r.points)) : null;
    let earned = 0, spent = 0, granted = 0, pending = 0, balance = 0, canRedeem = 0;
    const balances = new Map<string, number>();
    for (const phone of phones) {
      const s = pointsSummary(byPhone.get(phone) ?? [], grantsBy.get(phone) ?? []);
      earned += s.earned;
      spent += s.spent;
      granted += s.granted;
      pending += s.pending;
      balance += s.balance;
      balances.set(phone, s.balance);
      if (cheapest != null && s.balance >= cheapest) canRedeem += 1;
    }
    const value = pointValueIQD(live);
    return { earned, spent, granted, pending, balance, canRedeem, cheapest, value, balances };
  }, [orders, grants, rewards]);

  // Orders that used each reward (cancelled ones gave their points back).
  const usage = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders ?? []) {
      if (!o.rewardId || o.status === "CANCELLED") continue;
      m.set(o.rewardId, [...(m.get(o.rewardId) ?? []), o]);
    }
    return m;
  }, [orders]);

  function edit(r: RewardRecord) {
    setError("");
    setDraft({
      id: r.id,
      kind: (r.kind as RewardKind) ?? "ORDER_OFF",
      points: String(r.points),
      value: r.value ? String(r.value) : "",
      slug: r.slug ?? products[0]?.slug ?? "",
      title: r.title ?? "",
      minJars: r.minJars ? String(r.minJars) : "",
      startsAt: toDay(r.startsAt),
      endsAt: toDay(r.endsAt),
      active: r.active !== false,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const asReward = (d: Draft): Omit<Reward, "id"> => ({
    kind: d.kind,
    points: int(d.points) ?? 0,
    value: needsValue(d.kind) ? int(d.value) : null,
    slug: needsProduct(d.kind) ? d.slug : null,
    title: d.title.trim() || null,
    minJars: int(d.minJars),
  });

  async function save() {
    if (!draft) return;
    const r = asReward(draft);
    if (!r.points) return setError("اكتب كم نقطة تكلف المكافأة.");
    if (needsValue(draft.kind) && !r.value) return setError("اكتب مبلغ الخصم بالدينار.");
    if (needsProduct(draft.kind) && !getProduct(draft.slug)) return setError("اختاروا النكهة.");
    if (draft.kind === "PRODUCT_OFF" && (r.value ?? 0) >= (getProduct(draft.slug)?.price ?? 0)) return setError("الخصم أكبر من سعر العلبة: استخدموا «علبة مجانية».");
    if (draft.startsAt && draft.endsAt && draft.endsAt < draft.startsAt) return setError("تاريخ النهاية قبل تاريخ البداية.");
    setError("");
    const rec = {
      ...r,
      active: draft.active,
      startsAt: dayStart(draft.startsAt),
      endsAt: dayEnd(draft.endsAt),
      sort: r.points,
    };
    setBusy("save");
    const { errors } = draft.id ? await dataClient.models.Reward.update({ id: draft.id, ...rec }) : await dataClient.models.Reward.create(rec);
    setBusy(null);
    if (errors?.length) {
      console.error("reward save failed", errors);
      return toast({ id: "reward", tone: "attention", message: "تعذّر حفظ المكافأة. حاول مجددًا." });
    }
    toast({ id: "reward", message: `حُفظت «${rewardTitle({ id: "", ...rec }, nameOf)}».` });
    setDraft(null);
    await load();
  }

  async function toggle(r: RewardRecord) {
    setBusy(r.id);
    await dataClient.models.Reward.update({ id: r.id, active: r.active === false });
    setBusy(null);
    await load();
  }

  async function remove(r: RewardRecord) {
    setBusy(r.id);
    const { errors } = await dataClient.models.Reward.delete({ id: r.id });
    setBusy(null);
    if (errors?.length) return toast({ id: "reward", tone: "attention", message: "تعذّر الحذف." });
    await load();
  }

  const preview = draft ? rewardTitle({ id: "", ...asReward(draft) }, nameOf) : "";

  const form = draft && (
    <section className="order-detail__block">
      <h2>{draft.id ? "تعديل المكافأة" : "مكافأة جديدة"}</h2>
      {!draft.id && (
        <div className="chip-row" role="group" aria-label="قوالب جاهزة">
          {REWARD_TEMPLATES.map((t, i) => (
            <button
              key={i}
              type="button"
              className="chip"
              onClick={() =>
                setDraft({
                  ...EMPTY,
                  kind: t.kind as RewardKind,
                  points: String(t.points),
                  value: t.value ? String(t.value) : "",
                  slug: t.slug ?? EMPTY.slug,
                  minJars: t.minJars ? String(t.minJars) : "",
                })
              }
            >
              {formatPoints(t.points)} ← {rewardTitle({ id: "", ...t }, nameOf)}
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
          نوع المكافأة
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as RewardKind })}>
            {REWARD_KINDS.map((k) => (
              <option key={k} value={k}>
                {REWARD_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <div className="form-row">
          <label>
            تكلف (نقطة)
            <input value={draft.points} onChange={(e) => setDraft({ ...draft, points: e.target.value })} inputMode="numeric" dir="ltr" />
          </label>
          {needsValue(draft.kind) && (
            <label>
              الخصم (دينار)
              <input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} inputMode="numeric" dir="ltr" placeholder="2000" />
            </label>
          )}
        </div>
        {needsProduct(draft.kind) && (
          <label>
            النكهة
            <select value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value })}>
              {products.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.nameAr}
                </option>
              ))}
            </select>
            <small className="field-hint">العميل يضيف علبة من هذه النكهة للسلة، والمكافأة تنطبق عليها.</small>
          </label>
        )}
        <label>
          اسم يشوفه العميل (اختياري)
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={60} placeholder={preview} />
        </label>
        <p className="coupon-preview">
          يشوفها العميل: <strong>{preview}</strong> · {formatPoints(int(draft.points) ?? 0)} نقطة
        </p>
        <div className="form-row">
          <label>
            أقل عدد علب (اختياري)
            <input value={draft.minJars} onChange={(e) => setDraft({ ...draft, minJars: e.target.value })} inputMode="numeric" dir="ltr" placeholder="بدون" />
          </label>
        </div>
        <div className="form-row">
          <label>
            تبدأ (اختياري)
            <input type="date" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} />
          </label>
          <label>
            تنتهي (اختياري)
            <input type="date" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} />
          </label>
        </div>
        <label className="admin-order-form__check">
          <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          <span>فعّالة</span>
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="order-detail__actions">
          <button type="submit" className="btn btn--full" disabled={busy === "save"}>
            {busy === "save" ? "جارٍ الحفظ…" : "حفظ المكافأة"}
          </button>
          <button type="button" className="btn btn--quiet btn--full" onClick={() => setDraft(null)}>
            إلغاء
          </button>
        </div>
      </form>
    </section>
  );

  return (
    <div className="couriers coupons rewards">
      <dl className="admin-stats rewards-stats">
        <div>
          <dt>نقاط عند العملاء الآن</dt>
          <dd>{formatPoints(program.balance)}</dd>
        </div>
        <div>
          <dt>قيمتها تقريباً</dt>
          <dd>{program.value ? formatIQD(Math.round((program.balance * program.value) / 250) * 250) : "—"}</dd>
        </div>
        <div>
          <dt>نقاط مستخدمة</dt>
          <dd>
            {formatPoints(program.spent)}
            {program.earned + program.granted > 0 && <small> ({Math.round((program.spent / (program.earned + program.granted)) * 100)}%)</small>}
          </dd>
        </div>
        <div>
          <dt>عملاء يگدرون يستخدمون مكافأة</dt>
          <dd>{program.cheapest == null ? "—" : program.canRedeem}</dd>
        </div>
      </dl>
      <p className="hint">
        العميل ياخذ 10 نقاط عن كل 1,000 د.ع بعد توصيل الطلب (طلبات الجملة ما تاخذ نقاط). مكتسبة {formatPoints(program.earned)}، منتظرة التوصيل{" "}
        {formatPoints(program.pending)}، ممنوحة يدوياً {formatPoints(program.granted)}.
      </p>

      {form ?? (
        <button type="button" className="btn btn--full" onClick={() => (setError(""), setDraft({ ...EMPTY }))}>
          + مكافأة جديدة
        </button>
      )}
      {rewards === null && <p className="panel-loading">جارٍ التحميل…</p>}
      {rewards && rewards.length === 0 && !draft && (
        <p className="hint">ما عندكم مكافآت بعد، فالنقاط ما إلها استخدام. ابدأوا بقالب جاهز: أول مكافأة توصل لها العميل بطلب واحد من علبتين.</p>
      )}
      <ul className="coupon-list">
        {(rewards ?? []).map((r) => {
          const used = usage.get(r.id) ?? [];
          const st = rewardState(r);
          const given = used.reduce((n, o) => n + (o.discount ?? 0), 0);
          const sales = used.filter((o) => o.status === "DELIVERED").reduce((n, o) => n + o.total, 0);
          return (
            <li key={r.id} className={`coupon-card is-${st.tone}`}>
              <div className="coupon-card__head">
                <strong>{formatPoints(r.points)} نقطة</strong>
                <span className={`coupon-card__state is-${st.tone}`}>{st.text}</span>
              </div>
              <p className="coupon-card__label">{rewardTitle(r, nameOf)}</p>
              <p className="coupon-card__rules">
                {[REWARD_KIND_LABELS[r.kind as RewardKind], r.minJars ? `من ${r.minJars} علب` : null, r.endsAt ? `حتى ${toDay(r.endsAt)}` : null].filter(Boolean).join(" · ")}
              </p>
              <dl className="coupon-card__stats">
                <div>
                  <dt>استُخدمت</dt>
                  <dd>{used.length}</dd>
                </div>
                <div>
                  <dt>نقاط</dt>
                  <dd>{formatPoints(used.reduce((n, o) => n + (o.pointsSpent ?? 0), 0))}</dd>
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
                <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => edit(r)}>
                  تعديل
                </button>
                <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => void toggle(r)}>
                  {r.active === false ? "تفعيل" : "إيقاف"}
                </button>
                {used.length > 0 ? (
                  <button type="button" className="btn btn--quiet btn--small" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                    الطلبات
                  </button>
                ) : (
                  <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => void remove(r)}>
                    حذف
                  </button>
                )}
              </div>
              {openId === r.id && (
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

      <GivePoints
        balances={program.balances}
        grants={grants}
        by={auth.status === "signedIn" ? auth.phone : ""}
        onSaved={load}
        nameFor={(phone) => (orders ?? []).find((o) => o.phone === phone)?.name}
      />
    </div>
  );
}

// Give a customer points by hand (a gift, an apology, a contest) or take some back (negative).
function GivePoints({
  balances,
  grants,
  by,
  onSaved,
  nameFor,
}: {
  balances: Map<string, number>;
  grants: GrantRecord[] | null;
  by: string;
  onSaved: () => Promise<void>;
  nameFor: (phone: string) => string | undefined;
}) {
  const toast = useToast();
  const [phoneText, setPhoneText] = useState("");
  const [pointsText, setPointsText] = useState("");
  const [take, setTake] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const phone = normalizeIraqiMobile(phoneText);
  const amount = int(pointsText);
  const name = phone ? nameFor(phone) : undefined;

  async function give() {
    if (!phone || !amount || busy) return;
    setBusy(true);
    const { errors } = await dataClient.models.PointsGrant.create({ phone, points: take ? -amount : amount, reason: reason.trim() || null, createdBy: by || null });
    setBusy(false);
    if (errors?.length) return toast({ id: "points", tone: "attention", message: "تعذّر الحفظ. حاول مجددًا." });
    toast({ id: "points", message: `${take ? "سحبنا" : "أضفنا"} ${formatPoints(amount)} نقطة ${take ? "من" : "لـ"} ${name ?? formatIraqiMobile(phone)}.` });
    setPointsText("");
    setReason("");
    await onSaved();
  }

  return (
    <section className="order-detail__block give-points">
      <h2>نقاط يدوية لعميل</h2>
      <p className="hint">هدية، تعويض عن مشكلة، مسابقة، أو تصحيح. تنضاف للرصيد فوراً.</p>
      <form
        className="panel-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void give();
        }}
      >
        <label>
          رقم واتساب العميل
          <input value={phoneText} onChange={(e) => setPhoneText(e.target.value)} inputMode="tel" dir="ltr" placeholder="0770 000 0000" />
          {phone && (
            <small className="field-hint">
              {name ? `${name} · ` : "رقم بدون طلبات · "}الرصيد الحالي {formatPoints(balances.get(phone) ?? 0)} نقطة
            </small>
          )}
        </label>
        <div className="form-row">
          <label>
            النقاط
            <input value={pointsText} onChange={(e) => setPointsText(e.target.value)} inputMode="numeric" dir="ltr" placeholder="100" />
          </label>
          <span className="not-toggle" role="group" aria-label="إضافة أو سحب">
            <button type="button" aria-pressed={!take} onClick={() => setTake(false)}>
              إضافة
            </button>
            <button type="button" aria-pressed={take} onClick={() => setTake(true)}>
              سحب
            </button>
          </span>
        </div>
        <label>
          السبب (يبقى عندكم)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={80} placeholder="مثل: تعويض تأخير الطلب EL-0240" />
        </label>
        <button type="submit" className="btn btn--full" disabled={!phone || !amount || busy}>
          {busy ? "جارٍ الحفظ…" : take ? "سحب النقاط" : "إضافة النقاط"}
        </button>
      </form>
      {grants && grants.length > 0 && (
        <ul className="coupon-card__orders give-points__log">
          {grants.slice(0, 30).map((g) => (
            <li key={g.id}>
              <span dir="ltr">{formatIraqiMobile(g.phone)}</span>
              <span>{g.reason ?? "—"}</span>
              <span className={g.points < 0 ? "is-minus" : undefined}>
                {g.points > 0 ? "+" : "−"}
                {formatPoints(Math.abs(g.points))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

