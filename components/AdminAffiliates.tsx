"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "./Toast";
import { dataClient, type Campaign, type CouponRecord, type Order, type Sponsor } from "@/lib/data";
import { couponLabel, normalizeCode, type CouponKind } from "@/lib/coupons";
import { formatIraqiMobile, normalizeIraqiMobile } from "@/lib/phone";
import { chatUrl } from "@/lib/share";
import { formatIQD } from "@/lib/site";
import { requestOrdersRefresh } from "@/lib/ordersRefresh";
import { parseJsonResult } from "@/lib/json-result";

// «الشركاء»: sponsors (influencers, partners) and their campaigns. Each campaign has its own
// link (?ref=slug), optional coupon and a commission per delivered jar. The numbers come from
// the orders the campaign brought (link or coupon); commission counts once an order is delivered.

const toDay = (iso?: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad" }).format(new Date(iso)) : "");
const dayStart = (d: string) => (d ? new Date(`${d}T00:00:00+03:00`).toISOString() : null);
const dayEnd = (d: string) => (d ? new Date(`${d}T23:59:59+03:00`).toISOString() : null);
const int = (s: string) => {
  const n = Math.floor(Number(String(s).replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

type SponsorDraft = { id?: string; name: string; phone: string; instagram: string; note: string };
type CampaignDraft = {
  id?: string;
  sponsorId: string;
  name: string;
  slug: string;
  startsAt: string;
  endsAt: string;
  couponCode: string;
  commissionPerJar: string;
  active: boolean;
};

function campaignState(c: Campaign, now = new Date()): { text: string; tone: "on" | "off" | "wait" } {
  if (c.active === false) return { text: "موقوفة", tone: "off" };
  if (c.endsAt && now > new Date(c.endsAt)) return { text: "منتهية", tone: "off" };
  if (c.startsAt && now < new Date(c.startsAt)) return { text: `تبدأ ${toDay(c.startsAt)}`, tone: "wait" };
  return { text: "فعّالة", tone: "on" };
}

type Stats = {
  orders: Order[];
  delivered: Order[];
  jars: number;
  sales: number;
  discount: number;
  earned: number;
  paid: number;
  owed: number;
  toPay: Order[];
};

function statsFor(orders: Order[]): Stats {
  const live = orders.filter((o) => o.status !== "CANCELLED");
  const delivered = live.filter((o) => o.status === "DELIVERED");
  const earned = delivered.reduce((n, o) => n + (o.commission ?? 0), 0);
  const paid = delivered.filter((o) => o.commissionPaidAt).reduce((n, o) => n + (o.commission ?? 0), 0);
  return {
    orders: live,
    delivered,
    jars: delivered.reduce((n, o) => n + o.jars, 0),
    sales: delivered.reduce((n, o) => n + o.total, 0),
    discount: live.reduce((n, o) => n + (o.discount ?? 0), 0),
    earned,
    paid,
    owed: earned - paid,
    toPay: delivered.filter((o) => !o.commissionPaidAt && (o.commission ?? 0) > 0),
  };
}

export function AdminAffiliates({ orders, onOpenOrder }: { orders: Order[] | null; onOpenOrder: (n: string) => void }) {
  const toast = useToast();
  const [sponsors, setSponsors] = useState<Sponsor[] | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [visits, setVisits] = useState<Record<string, number>>({});
  const [sDraft, setSDraft] = useState<SponsorDraft | null>(null);
  const [cDraft, setCDraft] = useState<CampaignDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmPay, setConfirmPay] = useState<string | null>(null);
  const [openList, setOpenList] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, c, k] = await Promise.all([
      dataClient.models.Sponsor.list({ limit: 1000 }),
      dataClient.models.Campaign.list({ limit: 1000 }),
      dataClient.models.Coupon.list({ limit: 1000 }),
    ]);
    setSponsors([...(s.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ar")));
    const list = [...(c.data ?? [])].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    setCampaigns(list);
    setCoupons(k.data ?? []);
    if (list.length) {
      const { data } = await dataClient.queries.campaignStats({ slugs: list.map((x) => x.slug) });
      setVisits(parseJsonResult<{ visits: Record<string, number> }>(data)?.visits ?? {});
    }
  }, []);
  useEffect(() => {
    void load().catch((err) => {
      console.error("affiliates load failed", err);
      setSponsors([]);
    });
  }, [load]);

  const byCampaign = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of orders ?? []) if (o.campaignId) m.set(o.campaignId, [...(m.get(o.campaignId) ?? []), o]);
    return m;
  }, [orders]);

  const link = (slug: string) => `${typeof window === "undefined" ? "https://elue-iq.com" : window.location.origin}/?ref=${slug}`;

  // ---- Sponsors ----

  async function saveSponsor() {
    if (!sDraft) return;
    if (sDraft.name.trim().length < 2) return setError("اكتب اسم الشريك.");
    const phone = sDraft.phone.trim() ? normalizeIraqiMobile(sDraft.phone) : null;
    if (sDraft.phone.trim() && !phone) return setError("رقم الواتساب غير صحيح.");
    setError("");
    setBusy("sponsor");
    const rec = {
      name: sDraft.name.trim(),
      phone,
      instagram: sDraft.instagram.trim().replace(/^@/, "") || null,
      note: sDraft.note.trim() || null,
      active: true,
    };
    const { errors } = sDraft.id ? await dataClient.models.Sponsor.update({ id: sDraft.id, ...rec }) : await dataClient.models.Sponsor.create(rec);
    setBusy(null);
    if (errors?.length) return toast({ id: "aff", tone: "attention", message: "تعذّر الحفظ." });
    setSDraft(null);
    await load();
  }

  // ---- Campaigns ----

  function newCampaign(s: Sponsor) {
    setError("");
    setSDraft(null);
    setCDraft({
      sponsorId: s.id,
      name: "",
      slug: slugify(s.instagram || s.name) || "",
      startsAt: toDay(new Date().toISOString()),
      endsAt: "",
      couponCode: "",
      commissionPerJar: "1000",
      active: true,
    });
  }

  function editCampaign(c: Campaign) {
    setError("");
    setSDraft(null);
    setCDraft({
      id: c.id,
      sponsorId: c.sponsorId,
      name: c.name,
      slug: c.slug,
      startsAt: toDay(c.startsAt),
      endsAt: toDay(c.endsAt),
      couponCode: c.couponCode ?? "",
      commissionPerJar: c.commissionPerJar ? String(c.commissionPerJar) : "",
      active: c.active !== false,
    });
  }

  async function saveCampaign() {
    if (!cDraft) return;
    const slug = slugify(cDraft.slug);
    if (cDraft.name.trim().length < 2) return setError("اكتب اسم الحملة.");
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) return setError("رمز الرابط: حروف إنجليزية صغيرة وأرقام وشرطة فقط.");
    if (campaigns.some((c) => c.slug === slug && c.id !== cDraft.id)) return setError("هذا الرابط مستخدم لحملة ثانية.");
    if (cDraft.startsAt && cDraft.endsAt && cDraft.endsAt < cDraft.startsAt) return setError("تاريخ النهاية قبل تاريخ البداية.");
    setError("");
    setBusy("campaign");
    const couponCode = normalizeCode(cDraft.couponCode) || null;
    const rec = {
      sponsorId: cDraft.sponsorId,
      name: cDraft.name.trim(),
      slug,
      startsAt: dayStart(cDraft.startsAt),
      endsAt: dayEnd(cDraft.endsAt),
      couponCode,
      commissionPerJar: int(cDraft.commissionPerJar) ?? 0,
      active: cDraft.active,
    };
    const res = cDraft.id ? await dataClient.models.Campaign.update({ id: cDraft.id, ...rec }) : await dataClient.models.Campaign.create(rec);
    if (res.errors?.length || !res.data) {
      setBusy(null);
      return toast({ id: "aff", tone: "attention", message: "تعذّر حفظ الحملة." });
    }
    // The coupon counts for this campaign (an influencer's code typed without the link).
    const id = res.data.id;
    for (const k of coupons) {
      if (k.campaignId === id && k.code !== couponCode) await dataClient.models.Coupon.update({ code: k.code, campaignId: null });
    }
    if (couponCode) await dataClient.models.Coupon.update({ code: couponCode, campaignId: id });
    setBusy(null);
    setCDraft(null);
    toast({ id: "aff", message: `حُفظت الحملة. الرابط: ${link(slug)}` });
    await load();
  }

  async function toggleCampaign(c: Campaign) {
    setBusy(c.id);
    await dataClient.models.Campaign.update({ id: c.id, active: c.active === false });
    setBusy(null);
    await load();
  }

  async function payCommission(c: Campaign, list: Order[]) {
    setBusy(c.id);
    const now = new Date().toISOString();
    let failed = 0;
    for (const o of list) {
      const { errors } = await dataClient.models.Order.update({ id: o.id, commissionPaidAt: now });
      if (errors?.length) failed += 1;
    }
    setBusy(null);
    setConfirmPay(null);
    requestOrdersRefresh();
    toast(
      failed
        ? { id: "aff", tone: "attention", message: `سُجّل ${list.length - failed} وفشل ${failed}. أعد المحاولة.` }
        : { id: "aff", message: `سُجّل دفع العمولة عن ${list.length} طلب.` },
    );
  }

  const inviteText = (s: Sponsor, c: Campaign) => {
    const k = coupons.find((x) => x.code === c.couponCode);
    return [
      `مرحباً ${s.name} 🧡`,
      `هذا رابطك الخاص لحملة «${c.name}» مع ÉLUE:`,
      link(c.slug),
      k ? `\nكود الخصم لمتابعينك: ${k.code} (${couponLabel({ ...k, kind: k.kind as CouponKind })})` : null,
      c.commissionPerJar ? `\nعمولتك ${formatIQD(c.commissionPerJar)} عن كل علبة تُسلَّم من طلبات الرابط أو الكود.` : null,
      c.endsAt ? `الحملة حتى ${toDay(c.endsAt)}.` : null,
    ]
      .filter(Boolean)
      .join("\n");
  };

  const statementText = (s: Sponsor, c: Campaign, st: Stats) =>
    [
      `كشف حملة «${c.name}» · ÉLUE`,
      `الطلبات: ${st.orders.length} · المُسلّمة: ${st.delivered.length}`,
      `العلب المُسلّمة: ${st.jars}`,
      `العمولة: ${formatIQD(st.earned)}`,
      `المدفوع: ${formatIQD(st.paid)}`,
      `المتبقي: ${formatIQD(st.owed)}`,
      "شكراً لشراكتك 🧡",
    ].join("\n");

  const totals = useMemo(() => {
    let owed = 0;
    let earned = 0;
    for (const c of campaigns) {
      const st = statsFor(byCampaign.get(c.id) ?? []);
      owed += st.owed;
      earned += st.earned;
    }
    return { owed, earned, live: campaigns.filter((c) => campaignState(c).tone === "on").length };
  }, [campaigns, byCampaign]);

  const campaignForm = cDraft && (
    <section className="order-detail__block">
      <h2>{cDraft.id ? "تعديل الحملة" : "حملة جديدة"}</h2>
      <form
        className="panel-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void saveCampaign();
        }}
      >
        <label>
          اسم الحملة
          <input value={cDraft.name} onChange={(e) => setCDraft({ ...cDraft, name: e.target.value })} maxLength={60} placeholder="مثل: ستوري نور – نوفمبر" />
        </label>
        <label>
          رمز الرابط
          <input value={cDraft.slug} onChange={(e) => setCDraft({ ...cDraft, slug: slugify(e.target.value) })} dir="ltr" maxLength={40} placeholder="noor" />
          <small className="field-hint" dir="ltr">
            {link(slugify(cDraft.slug) || "…")}
          </small>
        </label>
        <div className="form-row">
          <label>
            تبدأ
            <input type="date" value={cDraft.startsAt} onChange={(e) => setCDraft({ ...cDraft, startsAt: e.target.value })} />
          </label>
          <label>
            تنتهي (اختياري)
            <input type="date" value={cDraft.endsAt} onChange={(e) => setCDraft({ ...cDraft, endsAt: e.target.value })} />
          </label>
        </div>
        <label>
          كود الخصم للحملة (اختياري)
          <select value={cDraft.couponCode} onChange={(e) => setCDraft({ ...cDraft, couponCode: e.target.value })}>
            <option value="">بدون كود</option>
            {coupons.map((k) => (
              <option key={k.code} value={k.code}>
                {k.code} · {couponLabel({ ...k, kind: k.kind as CouponKind })}
              </option>
            ))}
          </select>
          <small className="field-hint">يتفعّل تلقائياً لمن يدخل من الرابط. ومن يكتب الكود بدون رابط يُحسب للحملة أيضاً. أنشئ الكود من «الكوبونات».</small>
        </label>
        <label>
          عمولة لكل علبة مُسلّمة (د.ع)
          <input value={cDraft.commissionPerJar} onChange={(e) => setCDraft({ ...cDraft, commissionPerJar: e.target.value })} inputMode="numeric" dir="ltr" placeholder="1000" />
        </label>
        <label className="admin-order-form__check">
          <input type="checkbox" checked={cDraft.active} onChange={(e) => setCDraft({ ...cDraft, active: e.target.checked })} />
          <span>فعّالة</span>
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="order-detail__actions">
          <button type="submit" className="btn btn--full" disabled={busy === "campaign"}>
            {busy === "campaign" ? "جارٍ الحفظ…" : "حفظ الحملة"}
          </button>
          <button type="button" className="btn btn--quiet btn--full" onClick={() => setCDraft(null)}>
            إلغاء
          </button>
        </div>
      </form>
    </section>
  );

  const sponsorForm = sDraft && (
    <section className="order-detail__block">
      <h2>{sDraft.id ? "تعديل الشريك" : "شريك جديد"}</h2>
      <form
        className="panel-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void saveSponsor();
        }}
      >
        <label>
          الاسم
          <input value={sDraft.name} onChange={(e) => setSDraft({ ...sDraft, name: e.target.value })} maxLength={60} />
        </label>
        <label>
          حساب إنستغرام (اختياري)
          <input value={sDraft.instagram} onChange={(e) => setSDraft({ ...sDraft, instagram: e.target.value })} dir="ltr" maxLength={40} placeholder="@name" />
        </label>
        <label>
          رقم الواتساب (اختياري)
          <input value={sDraft.phone} onChange={(e) => setSDraft({ ...sDraft, phone: e.target.value })} dir="ltr" inputMode="tel" maxLength={20} placeholder="0771 234 5678" />
          <small className="field-hint">لإرسال الرابط والكشف له. طلباته الشخصية ما تاخذ عمولة.</small>
        </label>
        <label>
          ملاحظة (اختياري)
          <input value={sDraft.note} onChange={(e) => setSDraft({ ...sDraft, note: e.target.value })} maxLength={120} />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="order-detail__actions">
          <button type="submit" className="btn btn--full" disabled={busy === "sponsor"}>
            حفظ
          </button>
          <button type="button" className="btn btn--quiet btn--full" onClick={() => setSDraft(null)}>
            إلغاء
          </button>
        </div>
      </form>
    </section>
  );

  return (
    <div className="couriers affiliates">
      <dl className="settle-summary">
        <div>
          <dt>حملات فعّالة</dt>
          <dd>{totals.live}</dd>
        </div>
        <div>
          <dt>عمولات مستحقة</dt>
          <dd>{formatIQD(totals.earned)}</dd>
        </div>
        <div>
          <dt>غير مدفوعة</dt>
          <dd>{formatIQD(totals.owed)}</dd>
        </div>
      </dl>

      {sponsorForm ?? campaignForm ?? (
        <button type="button" className="btn btn--full" onClick={() => (setError(""), setSDraft({ name: "", phone: "", instagram: "", note: "" }))}>
          + شريك جديد
        </button>
      )}

      {sponsors === null && <p className="panel-loading">جارٍ التحميل…</p>}
      {sponsors && sponsors.length === 0 && !sDraft && (
        <p className="hint">أضيفوا أول شريك (مؤثر أو صفحة)، وبعدها حملة برابط خاص وكود وعمولة لكل علبة.</p>
      )}

      {(sponsors ?? []).map((s) => {
        const mine = campaigns.filter((c) => c.sponsorId === s.id);
        return (
          <section key={s.id} className="order-detail__block sponsor-card">
            <div className="sponsor-card__head">
              <div>
                <h2>{s.name}</h2>
                <small>
                  {[s.instagram ? `@${s.instagram}` : null, s.phone ? formatIraqiMobile(s.phone) : null].filter(Boolean).join(" · ")}
                </small>
              </div>
              <div className="couriers__actions">
                <button type="button" className="btn btn--small" onClick={() => newCampaign(s)}>
                  + حملة
                </button>
                <button
                  type="button"
                  className="btn btn--quiet btn--small"
                  onClick={() => (setError(""), setCDraft(null), setSDraft({ id: s.id, name: s.name, phone: s.phone ? formatIraqiMobile(s.phone) : "", instagram: s.instagram ?? "", note: s.note ?? "" }))}
                >
                  تعديل
                </button>
              </div>
            </div>
            {mine.length === 0 && <p className="hint">ما عنده حملات بعد.</p>}
            {mine.map((c) => {
              const st = statsFor(byCampaign.get(c.id) ?? []);
              const state = campaignState(c);
              const v = visits[c.slug] ?? 0;
              const k = coupons.find((x) => x.code === c.couponCode);
              return (
                <article key={c.id} className={`campaign-card is-${state.tone}`}>
                  <div className="coupon-card__head">
                    <strong>{c.name}</strong>
                    <span className={`coupon-card__state is-${state.tone}`}>{state.text}</span>
                  </div>
                  <p className="coupon-card__rules">
                    {[
                      k ? `كود ${k.code} · ${couponLabel({ ...k, kind: k.kind as CouponKind })}` : "بدون كود",
                      `${formatIQD(c.commissionPerJar ?? 0)} لكل علبة`,
                      c.startsAt ? `من ${toDay(c.startsAt)}` : null,
                      c.endsAt ? `حتى ${toDay(c.endsAt)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <button
                    type="button"
                    className="campaign-card__link"
                    dir="ltr"
                    onClick={() => {
                      void navigator.clipboard?.writeText(link(c.slug));
                      toast({ id: "aff", message: "نُسخ الرابط." });
                    }}
                  >
                    {link(c.slug).replace(/^https?:\/\//, "")}
                    <small>نسخ</small>
                  </button>
                  <dl className="coupon-card__stats">
                    <div>
                      <dt>زيارات</dt>
                      <dd>{v}</dd>
                    </div>
                    <div>
                      <dt>طلبات</dt>
                      <dd>
                        {st.orders.length}
                        {v > 0 && <small> · {Math.round((st.orders.length / v) * 1000) / 10}%</small>}
                      </dd>
                    </div>
                    <div>
                      <dt>علب مُسلّمة</dt>
                      <dd>{st.jars}</dd>
                    </div>
                    <div>
                      <dt>مبيعات</dt>
                      <dd>{formatIQD(st.sales)}</dd>
                    </div>
                    <div>
                      <dt>عمولة مستحقة</dt>
                      <dd>{formatIQD(st.earned)}</dd>
                    </div>
                    <div>
                      <dt>غير مدفوعة</dt>
                      <dd className={st.owed > 0 ? "is-warn" : undefined}>{formatIQD(st.owed)}</dd>
                    </div>
                  </dl>
                  {st.toPay.length > 0 &&
                    (confirmPay === c.id ? (
                      <div className="settle__confirm">
                        <p>
                          تأكيد: دفعت {formatIQD(st.toPay.reduce((n, o) => n + (o.commission ?? 0), 0))} لـ {s.name} عن {st.toPay.length} طلب مُسلّم.
                        </p>
                        <button type="button" className="btn btn--full" disabled={busy !== null} onClick={() => void payCommission(c, st.toPay)}>
                          تأكيد الدفع
                        </button>
                        <button type="button" className="link-button" onClick={() => setConfirmPay(null)}>
                          تراجع
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="btn btn--full" onClick={() => setConfirmPay(c.id)}>
                        دفعت العمولة ({formatIQD(st.toPay.reduce((n, o) => n + (o.commission ?? 0), 0))})
                      </button>
                    ))}
                  <div className="couriers__actions">
                    {s.phone && (
                      <a className="btn btn--quiet btn--small" href={chatUrl(s.phone, inviteText(s, c))} target="_blank" rel="noopener noreferrer">
                        إرسال الرابط
                      </a>
                    )}
                    {s.phone && st.orders.length > 0 && (
                      <a className="btn btn--quiet btn--small" href={chatUrl(s.phone, statementText(s, c, st))} target="_blank" rel="noopener noreferrer">
                        إرسال الكشف
                      </a>
                    )}
                    <button type="button" className="btn btn--quiet btn--small" onClick={() => editCampaign(c)}>
                      تعديل
                    </button>
                    <button type="button" className="btn btn--quiet btn--small" disabled={busy !== null} onClick={() => void toggleCampaign(c)}>
                      {c.active === false ? "تفعيل" : "إيقاف"}
                    </button>
                    {st.orders.length > 0 && (
                      <button type="button" className="btn btn--quiet btn--small" onClick={() => setOpenList(openList === c.id ? null : c.id)}>
                        الطلبات
                      </button>
                    )}
                  </div>
                  {openList === c.id && (
                    <ul className="coupon-card__orders">
                      {st.orders.map((o) => (
                        <li key={o.id}>
                          <button type="button" className="link-button" onClick={() => onOpenOrder(o.orderNumber)}>
                            <span dir="ltr">{o.orderNumber}</span>
                          </button>
                          <span>{o.status === "DELIVERED" ? "مُسلّم" : "قيد التنفيذ"}</span>
                          <span>{o.commissionPaidAt ? "مدفوعة" : formatIQD(o.commission ?? 0)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
