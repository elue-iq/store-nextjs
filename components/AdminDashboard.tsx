"use client";

import { useEffect, useMemo, useState } from "react";
import { OrderRow } from "./AdminOrderRow";
import { STATUS_LABELS, type Order, type OrderStatus } from "@/lib/data";
import { products } from "@/lib/products";
import { formatIQD, PAY_KEY_LABELS, type PayKey } from "@/lib/site";
import { formatIraqiMobile } from "@/lib/phone";
import {
  ALL_STATUSES,
  DEFAULT_FILTERS,
  PERIODS,
  WEEKDAYS,
  activeFilterCount,
  change,
  computeInsights,
  ordersCsv,
  rangeLabel,
  sourceLabel,
  todayBaghdad,
  isTest,
  type Filters,
  type Row,
} from "@/lib/insights";

// «لوحة المعلومات»: every number about the orders, for any period and any filter
// (flavor, status, province, channel, source, payment, new/returning customer).
// Everything below the filters uses the same filtered orders, so the numbers agree.

const STORE_KEY = "elue-admin-dashboard-v1";

function loadFilters(): Filters {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) return { ...DEFAULT_FILTERS, ...(JSON.parse(raw) as Partial<Filters>) };
  } catch {
    // private mode / blocked storage: start from the defaults
  }
  return DEFAULT_FILTERS;
}

const n0 = (n: number) => n.toLocaleString("en-US");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const trim = (x: number) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10).toString();
const compact = (n: number) => (n >= 1e6 ? `${trim(n / 1e6)}M` : n >= 1e3 ? `${trim(n / 1e3)}K` : String(Math.round(n)));
const jarsText = (n: number) => (n === 1 ? "علبة" : n === 2 ? "علبتان" : `${n0(n)} علبة`);
const ordersText = (n: number) => (n === 1 ? "طلب واحد" : n === 2 ? "طلبان" : `${n0(n)} طلب`);

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= max) return m * mag;
  return 10 * mag;
}

type Tone = "good" | "bad" | "flat";
type Delta = { text: string; tone: Tone } | null;

// "▲ 25%" against the previous period; up is good unless said otherwise.
function deltaOf(cur: number, prev: number | null | undefined, upIsGood = true): Delta {
  const c = change(cur, prev);
  if (c === null) return null;
  if (Math.abs(c) < 0.005) return { text: "بلا تغيير", tone: "flat" };
  const up = c > 0;
  return { text: `${up ? "▲" : "▼"} ${pct(Math.abs(c))}`, tone: up === upIsGood ? "good" : "bad" };
}

// ---- Small chart pieces --------------------------------------------------------

function StatTile({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: Delta }) {
  return (
    <div className="dash-tile">
      <dt>{label}</dt>
      <dd>
        <span className="dash-tile__value">{value}</span>
        {delta && <span className={`dash-delta dash-delta--${delta.tone}`}>{delta.text}</span>}
        {sub && <small>{sub}</small>}
      </dd>
    </div>
  );
}

type Col = { key: string; label: string; tick: string; value: number; display: string };

// Vertical bars (one hue). Each column is its own hover / focus / tap target and
// shows its value in a tooltip; the tallest bar is labelled; a table is one tap away.
function ColumnChart({ cols, name, tickEvery = 1, height = 150 }: { cols: Col[]; name: string; tickEvery?: number; height?: number }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(0, ...cols.map((c) => c.value));
  const top = niceMax(max);
  const peak = max > 0 ? cols.findIndex((c) => c.value === max) : -1;
  const a = active !== null ? cols[active] : null;
  return (
    <div className="dash-cols" dir="ltr" onPointerLeave={() => setActive(null)}>
      <div className="dash-cols__plot" style={{ height }}>
        {[1, 0.5, 0].map((t) => (
          <span key={t} className="dash-cols__grid" style={{ bottom: `${t * 100}%` }}>
            <span>{compact(top * t)}</span>
          </span>
        ))}
        <div className="dash-cols__bars" role="group" aria-label={name}>
          {cols.map((c, i) => (
            <div
              key={c.key}
              className={`dash-cols__slot${active === i ? " is-active" : ""}`}
              tabIndex={0}
              role="img"
              aria-label={`${c.label}: ${c.display}`}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(i)}
            >
              <span className="dash-cols__bar" style={{ height: `${(c.value / top) * 100}%` }}>
                {i === peak && <span className="dash-cols__peak">{compact(c.value)}</span>}
              </span>
            </div>
          ))}
        </div>
        {a && (
          <div
            className="dash-tip"
            dir="rtl"
            style={{
              left: `clamp(3.5rem, ${((active! + 0.5) / cols.length) * 100}%, calc(100% - 3.5rem))`,
              bottom: `calc(${(a.value / top) * 100}% + 6px)`,
            }}
            role="status"
          >
            <strong>{a.display}</strong>
            <span>{a.label}</span>
          </div>
        )}
      </div>
      <div className="dash-cols__x" aria-hidden="true">
        {cols.map((c, i) => (
          <span key={c.key}>{i % tickEvery === 0 ? c.tick : ""}</span>
        ))}
      </div>
    </div>
  );
}

type BarRow = { key: string; label: string; value: number; display: string; sub?: string; selected?: boolean };

// Ranked horizontal bars, largest first, one hue, the value printed at each bar.
// Tapping a row (when onPick is given) filters the whole dashboard by it.
function BarList({ rows, onPick, empty = "لا توجد بيانات." }: { rows: BarRow[]; onPick?: (key: string) => void; empty?: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max === 0) return <p className="hint">{empty}</p>;
  return (
    <ul className="dash-bars">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="dash-bars__label">
              {r.selected && <span className="dash-bars__check" aria-hidden="true">✓</span>}
              {r.label}
            </span>
            <strong className="dash-bars__value">{r.display}</strong>
            <span className="dash-bars__track" aria-hidden="true">
              <span className="dash-bars__bar" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            {r.sub && <small className="dash-bars__sub">{r.sub}</small>}
          </>
        );
        return (
          <li key={r.key} className={r.selected ? "is-selected" : undefined}>
            {onPick ? (
              <button type="button" className="dash-bars__row" aria-pressed={Boolean(r.selected)} onClick={() => onPick(r.key)}>
                {inner}
              </button>
            ) : (
              <div className="dash-bars__row">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Card({ title, sub, children, wide, action }: { title: string; sub?: string; children: React.ReactNode; wide?: boolean; action?: React.ReactNode }) {
  return (
    <section className={`dash-card${wide ? " dash-card--wide" : ""}`}>
      <div className="dash-card__head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ---- The dashboard -------------------------------------------------------------

type Metric = "revenue" | "orders" | "jars";

export function AdminDashboard({
  orders,
  onOpenOrder,
  onOpenCustomer,
}: {
  orders: Order[] | null;
  onOpenOrder: (orderNumber: string) => void;
  onOpenCustomer: (phone: string) => void;
}) {
  const [f, setF] = useState<Filters>(DEFAULT_FILTERS);
  const [loaded, setLoaded] = useState(false);
  const [more, setMore] = useState(false);
  const [metric, setMetric] = useState<Metric>("revenue");
  const [shown, setShown] = useState(20);

  // Filters are remembered on this phone (per viewer; nothing is stored on the server).
  useEffect(() => {
    setF(loadFilters());
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(f));
    } catch {
      // storage blocked: filters just aren't remembered
    }
  }, [f, loaded]);

  const set = (patch: Partial<Filters>) => {
    setF((prev) => ({ ...prev, ...patch }));
    setShown(20);
  };

  const today = todayBaghdad();
  const all = useMemo(() => orders ?? [], [orders]);
  const ins = useMemo(() => computeInsights(all, f, today), [all, f, today]);

  // Choices for the selects: only values that exist in the orders.
  const choices = useMemo(() => {
    const count = (key: (o: Order) => string) => {
      const m = new Map<string, number>();
      for (const o of all) if (f.showTests || !isTest(o)) m.set(key(o), (m.get(key(o)) ?? 0) + 1);
      return [...m.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1]);
    };
    return { provinces: count((o) => o.province ?? ""), sources: count(sourceLabel) };
  }, [all, f.showTests]);

  if (orders === null) return <p className="panel-loading">جارٍ تحميل البيانات…</p>;

  const k = ins.kpis;
  const p = ins.prev;
  const flavorNames = f.flavors.map((s) => products.find((x) => x.slug === s)?.nameAr ?? s);
  const vsText = ins.prevRange ? `مقارنة بـ ${rangeLabel(ins.prevRange)}` : "";
  const extra = activeFilterCount(f);
  const cancelRate = ins.cancelled.of ? ins.cancelled.count / ins.cancelled.of : 0;
  const prevCancelRate = ins.prevCancelled?.of ? ins.prevCancelled.count / ins.prevCancelled.of : null;
  const cancelledShown = !f.statuses.length || f.statuses.includes("CANCELLED");

  const toggleFlavor = (slug: string) =>
    set({ flavors: f.flavors.includes(slug) ? f.flavors.filter((s) => s !== slug) : [...f.flavors, slug] });
  const toggleStatus = (s: OrderStatus) => {
    const list = f.statuses.length ? f.statuses : ALL_STATUSES;
    const next = list.includes(s) ? list.filter((x) => x !== s) : [...list, s];
    if (!next.length) return; // at least one status stays selected
    set({ statuses: next.length === ALL_STATUSES.length ? [] : next });
  };

  // Removable chips for every filter that isn't the default.
  const chips: { key: string; text: string; clear: () => void }[] = [];
  if (f.flavors.length) chips.push({ key: "fl", text: `النكهة: ${flavorNames.join("، ")}`, clear: () => set({ flavors: [] }) });
  if (f.statuses.slice().sort().join() !== DEFAULT_FILTERS.statuses.slice().sort().join())
    chips.push({
      key: "st",
      text: f.statuses.length ? `الحالة: ${f.statuses.map((s) => STATUS_LABELS[s]).join("، ")}` : "كل الحالات مع الملغاة",
      clear: () => set({ statuses: DEFAULT_FILTERS.statuses }),
    });
  if (f.province) chips.push({ key: "pr", text: `المحافظة: ${f.province}`, clear: () => set({ province: "" }) });
  if (f.channel) chips.push({ key: "ch", text: f.channel === "web" ? "من الموقع" : "أنشأه الفريق", clear: () => set({ channel: "" }) });
  if (f.source) chips.push({ key: "so", text: `المصدر: ${f.source}`, clear: () => set({ source: "" }) });
  if (f.payment)
    chips.push({
      key: "pa",
      text:
        f.payment === "paid"
          ? "العلب مدفوعة مسبقاً"
          : f.payment === "cod"
            ? "العلب تُدفع عند الاستلام"
            : f.payment === "deliveryPaid"
              ? "التوصيل مدفوع مسبقاً"
              : "توصيل مجاني (هدية)",
      clear: () => set({ payment: "" }),
    });
  if (f.method) chips.push({ key: "me", text: `طريقة الدفع: ${PAY_KEY_LABELS[f.method]}`, clear: () => set({ method: "" }) });
  if (f.customer) chips.push({ key: "cu", text: f.customer === "new" ? "عملاء جدد" : "عملاء عائدون", clear: () => set({ customer: "" }) });
  if (f.showTests) chips.push({ key: "te", text: "مع الطلبات التجريبية", clear: () => set({ showTests: false }) });

  const trendCols: Col[] = ins.trend.buckets.map((b) => {
    const v = metric === "revenue" ? b.revenue : metric === "orders" ? b.orders : b.jars;
    return {
      key: b.key,
      label: b.label,
      tick: ins.trend.unit === "week" ? `${Number(b.from.slice(8))}/${Number(b.from.slice(5, 7))}` : String(Number(b.from.slice(8))),
      value: v,
      display: metric === "revenue" ? formatIQD(v) : metric === "orders" ? ordersText(v) : jarsText(v),
    };
  });
  const trendEvery = Math.max(1, Math.ceil(trendCols.length / 10));
  const best = ins.trend.buckets.reduce<(typeof ins.trend.buckets)[number] | null>((b, x) => (!b || x.revenue > b.revenue ? x : b), null);

  const provinceRows = (() => {
    const top = ins.provinces.slice(0, 8);
    const rest = ins.provinces.slice(8);
    const rows: BarRow[] = top.map((r) => ({
      key: r.key,
      label: r.label,
      value: r.orders,
      display: ordersText(r.orders),
      sub: `${formatIQD(r.revenue)} · ${jarsText(r.jars)}`,
      selected: f.province === r.key,
    }));
    if (rest.length) {
      const o = rest.reduce((n, r) => n + r.orders, 0);
      rows.push({ key: "__rest", label: `${rest.length} محافظات أخرى`, value: o, display: ordersText(o), sub: formatIQD(rest.reduce((n, r) => n + r.revenue, 0)) });
    }
    return rows;
  })();

  const rowsOf = (rows: Row[], selectedKey?: string): BarRow[] =>
    rows.map((r) => ({ key: r.key, label: r.label, value: r.orders, display: ordersText(r.orders), sub: formatIQD(r.revenue), selected: selectedKey === r.key }));

  function downloadCsv() {
    const csv = ordersCsv(ins.orders, ins.types);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `elue-orders_${ins.range.from}_${ins.range.to}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return (
    <div className="dash">
      {/* ---- Filters: scope everything below ---- */}
      <div className="dash-filters">
        <div className="admin-filters" role="group" aria-label="الفترة">
          {PERIODS.map((x) => (
            <button key={x.id} type="button" aria-pressed={f.period === x.id} onClick={() => set({ period: x.id })}>
              {x.label}
            </button>
          ))}
        </div>
        {f.period === "custom" && (
          <div className="dash-dates">
            <label>
              من
              <input type="date" value={f.from || ins.range.from} max={today} onChange={(e) => set({ from: e.target.value })} />
            </label>
            <label>
              إلى
              <input type="date" value={f.to || ins.range.to} max={today} onChange={(e) => set({ to: e.target.value })} />
            </label>
          </div>
        )}
        <div className="admin-filters" role="group" aria-label="النكهة">
          <button type="button" aria-pressed={!f.flavors.length} onClick={() => set({ flavors: [] })}>
            كل النكهات
          </button>
          {products.map((x) => (
            <button key={x.slug} type="button" aria-pressed={f.flavors.includes(x.slug)} onClick={() => toggleFlavor(x.slug)}>
              <i className="dash-swatch" style={{ background: x.band }} aria-hidden="true" />
              {x.nameAr}
            </button>
          ))}
        </div>
        <div className="dash-filters__row">
          <button type="button" className="dash-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            فلاتر أخرى{extra - (f.flavors.length ? 1 : 0) > 0 ? ` (${extra - (f.flavors.length ? 1 : 0)})` : ""}
            <span aria-hidden="true">{more ? "▴" : "▾"}</span>
          </button>
          <span className="dash-summary">
            {rangeLabel(ins.range)} · {ordersText(k.orders)}
          </span>
        </div>
        {more && (
          <div className="dash-more__panel">
            <fieldset>
              <legend>الحالة</legend>
              <div className="admin-filters">
                {ALL_STATUSES.map((s) => (
                  <button key={s} type="button" aria-pressed={!f.statuses.length || f.statuses.includes(s)} onClick={() => toggleStatus(s)}>
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </fieldset>
            <label>
              المحافظة
              <select className="admin-sort" value={f.province} onChange={(e) => set({ province: e.target.value })}>
                <option value="">كل المحافظات</option>
                {choices.provinces.map(([name, n]) => (
                  <option key={name} value={name}>
                    {name} ({n})
                  </option>
                ))}
              </select>
            </label>
            <label>
              القناة
              <select className="admin-sort" value={f.channel} onChange={(e) => set({ channel: e.target.value as Filters["channel"] })}>
                <option value="">الموقع والفريق</option>
                <option value="web">طلبات العملاء من الموقع</option>
                <option value="team">طلبات أنشأها الفريق</option>
              </select>
            </label>
            <label>
              المصدر
              <select className="admin-sort" value={f.source} onChange={(e) => set({ source: e.target.value })}>
                <option value="">كل المصادر</option>
                {choices.sources.map(([name, n]) => (
                  <option key={name} value={name}>
                    {name} ({n})
                  </option>
                ))}
              </select>
            </label>
            <label>
              الدفع
              <select className="admin-sort" value={f.payment} onChange={(e) => set({ payment: e.target.value as Filters["payment"] })}>
                <option value="">الكل</option>
                <option value="cod">العلب تُدفع عند الاستلام</option>
                <option value="paid">العلب مدفوعة مسبقاً</option>
                <option value="deliveryPaid">التوصيل مدفوع مسبقاً</option>
                <option value="free">توصيل مجاني (هدية)</option>
              </select>
            </label>
            <label>
              طريقة الدفع
              <select className="admin-sort" value={f.method} onChange={(e) => set({ method: e.target.value as Filters["method"] })}>
                <option value="">الكل</option>
                {(["cod", "QI", "ZAINCASH", "OTHER", "GIFT", "unknown"] as PayKey[]).map((k) => (
                  <option key={k} value={k}>
                    {PAY_KEY_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              العميل
              <select className="admin-sort" value={f.customer} onChange={(e) => set({ customer: e.target.value as Filters["customer"] })}>
                <option value="">جدد وعائدون</option>
                <option value="new">أول طلب للعميل</option>
                <option value="returning">عميل عائد</option>
              </select>
            </label>
            {ins.testCount > 0 && (
              <label className="dash-check">
                <input type="checkbox" checked={f.showTests} onChange={(e) => set({ showTests: e.target.checked })} />
                إظهار الطلبات التجريبية ({ins.testCount})
              </label>
            )}
          </div>
        )}
        {chips.length > 0 && (
          <div className="dash-chips">
            {chips.map((c) => (
              <button key={c.key} type="button" onClick={c.clear} aria-label={`إزالة: ${c.text}`}>
                {c.text} <span aria-hidden="true">×</span>
              </button>
            ))}
            <button type="button" className="link-button" onClick={() => set({ ...DEFAULT_FILTERS, period: f.period, from: f.from, to: f.to })}>
              مسح الفلاتر
            </button>
          </div>
        )}
      </div>

      {/* ---- Headline ---- */}
      <section className="dash-hero">
        <p className="dash-hero__label">{f.flavors.length ? `مبيعات ${flavorNames.join(" + ")}` : "المبيعات"}</p>
        <p className="dash-hero__value">{formatIQD(k.revenue)}</p>
        <p className="dash-hero__sub">
          {(() => {
            const d = deltaOf(k.revenue, p?.revenue);
            return d ? <span className={`dash-delta dash-delta--${d.tone}`}>{d.text}</span> : null;
          })()}
          {p && (
            <span>
              {vsText}: {formatIQD(p.revenue)}
            </span>
          )}
        </p>
        <p className="dash-hero__note">
          قيمة العلب فقط، بدون أجور التوصيل{cancelledShown ? "، وتشمل الطلبات الملغاة" : "، بدون الطلبات الملغاة"}.
        </p>
      </section>

      <dl className="dash-tiles">
        <StatTile label={f.flavors.length ? "طلبات فيها النكهة" : "الطلبات"} value={n0(k.orders)} delta={deltaOf(k.orders, p?.orders)} />
        <StatTile label="العلب" value={n0(k.jars)} delta={deltaOf(k.jars, p?.jars)} sub={k.orders ? `${trim(k.jarsPerOrder)} علبة لكل طلب` : undefined} />
        <StatTile label={f.flavors.length ? "متوسط قيمة النكهة في الطلب" : "متوسط قيمة الطلب"} value={formatIQD(k.aov)} delta={deltaOf(k.aov, p?.aov)} />
        <StatTile
          label="العملاء"
          value={n0(k.customers)}
          delta={deltaOf(k.customers, p?.customers)}
          sub={`${n0(k.newCustomers)} جديد · ${n0(k.returningCustomers)} عائد`}
        />
        <StatTile
          label="تم التوصيل"
          value={n0(k.delivered)}
          sub={k.orders ? `${pct(k.delivered / k.orders)} من الطلبات` : undefined}
          delta={deltaOf(k.delivered, p?.delivered)}
        />
        <StatTile
          label="نسبة الإلغاء"
          value={pct(cancelRate)}
          sub={`${n0(ins.cancelled.count)} من ${n0(ins.cancelled.of)} طلب`}
          delta={prevCancelRate === null ? null : deltaOf(cancelRate, prevCancelRate, false)}
        />
        <StatTile
          label="توصيل مجاني (هدية)"
          value={n0(k.freeDelivery)}
          sub={k.freeDeliveryCost ? `تكلفة علينا ${formatIQD(k.freeDeliveryCost)}` : k.freeDelivery ? "التكلفة تظهر بعد الإرسال إلى مدن" : undefined}
        />
        <StatTile
          label="مدفوع مسبقاً"
          value={n0(k.prepaid)}
          sub={`العلب: ${k.orders ? pct(k.prepaid / k.orders) : "0%"} من الطلبات · التوصيل: ${n0(k.deliveryPrepaid)} طلب`}
        />
      </dl>
      {p && <p className="dash-vs">الأسهم {vsText}.</p>}

      <div className="dash-grid">
        <Card
          wide
          title={ins.trend.unit === "week" ? "حسب الأسبوع" : "حسب اليوم"}
          sub={best && best.revenue > 0 ? `أفضل ${ins.trend.unit === "week" ? "أسبوع" : "يوم"}: ${best.label} (${formatIQD(best.revenue)})` : undefined}
          action={
            <div className="dash-seg" role="group" aria-label="المقياس">
              {(
                [
                  ["revenue", "المبيعات"],
                  ["orders", "الطلبات"],
                  ["jars", "العلب"],
                ] as [Metric, string][]
              ).map(([m, label]) => (
                <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {k.orders ? (
            <>
              <ColumnChart cols={trendCols} name={`${metric === "revenue" ? "المبيعات" : metric === "orders" ? "الطلبات" : "العلب"} ${rangeLabel(ins.range)}`} tickEvery={trendEvery} />
              <details className="dash-table">
                <summary>عرض كجدول</summary>
                <table>
                  <thead>
                    <tr>
                      <th>{ins.trend.unit === "week" ? "الأسبوع" : "اليوم"}</th>
                      <th>الطلبات</th>
                      <th>العلب</th>
                      <th>المبيعات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ins.trend.buckets.map((b) => (
                      <tr key={b.key}>
                        <td>{b.label}</td>
                        <td>{n0(b.orders)}</td>
                        <td>{n0(b.jars)}</td>
                        <td>{formatIQD(b.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <p className="hint">لا توجد طلبات في هذه الفترة.</p>
          )}
        </Card>

        <Card
          title={f.flavors.length ? "النكهات في هذه الطلبات" : "النكهات"}
          sub={
            f.flavors.length
              ? "ما طُلب مع النكهة المختارة. اضغط نكهة لإضافتها أو إزالتها من الفلتر."
              : "بعدد العلب. اضغط نكهة لعرض أرقامها فقط."
          }
        >
          <BarList
            rows={ins.flavors.map((r) => ({
              key: r.key,
              label: r.label,
              value: r.jars,
              display: jarsText(r.jars),
              selected: r.selected,
              sub:
                f.flavors.length && !r.selected
                  ? `في ${pct(k.orders ? r.withOrders / k.orders : 0)} من هذه الطلبات · ${formatIQD(r.revenue)}`
                  : `${pct(r.share)} من العلب · ${formatIQD(r.revenue)} · في ${ordersText(r.withOrders)}`,
            }))}
            onPick={toggleFlavor}
          />
        </Card>

        <Card title="حالة الطلبات" sub="كل طلبات الفترة. اضغط حالة لعرضها وحدها.">
          <BarList
            rows={ins.statuses.map((r) => ({
              key: r.key,
              label: STATUS_LABELS[r.key as OrderStatus],
              value: r.orders,
              display: ordersText(r.orders),
              sub: formatIQD(r.revenue),
              selected: f.statuses.length === 1 && f.statuses[0] === r.key,
            }))}
            onPick={(s) =>
              set({ statuses: f.statuses.length === 1 && f.statuses[0] === s ? DEFAULT_FILTERS.statuses : [s as OrderStatus] })
            }
          />
        </Card>

        <Card title="المحافظات" sub="اضغط محافظة لعرض أرقامها فقط.">
          <BarList rows={provinceRows} onPick={(key) => key !== "__rest" && set({ province: f.province === key ? "" : key })} />
          {ins.areas.length > 0 && (
            <>
              <h3 className="dash-sub">أكثر المناطق طلباً</h3>
              <ol className="dash-areas">
                {ins.areas.slice(0, 8).map((r) => (
                  <li key={r.key}>
                    <span>{r.label}</span>
                    <strong>{ordersText(r.orders)}</strong>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Card>

        <Card title="من أين جاءت الطلبات" sub="القناة، ومصدر الرابط الذي فتحه العميل.">
          <BarList rows={rowsOf(ins.channels, f.channel)} onPick={(key) => set({ channel: f.channel === key ? "" : (key as Filters["channel"]) })} />
          <h3 className="dash-sub">المصدر</h3>
          <BarList rows={rowsOf(ins.sources, f.source)} onPick={(key) => set({ source: f.source === key ? "" : key })} />
        </Card>

        <Card title="طريقة الدفع" sub="كيف دفع العملاء: نقداً للمندوب، أو مسبقاً بـ Qi Card وزين كاش، أو هدية.">
          <BarList rows={rowsOf(ins.payMethods, f.method)} onPick={(key) => set({ method: f.method === key ? "" : (key as Filters["method"]) })} />
        </Card>

        <Card
          title="العملاء"
          sub={
            ins.repeatRate.of
              ? `منذ البداية: ${pct(ins.repeatRate.repeat / ins.repeatRate.of)} من العملاء طلبوا أكثر من مرة (${n0(ins.repeatRate.repeat)} من ${n0(ins.repeatRate.of)}).`
              : undefined
          }
        >
          <BarList
            rows={[
              { key: "new", label: "أول طلب للعميل", value: ins.orders.filter((o) => ins.types.get(o.id) === "new").length },
              { key: "returning", label: "عميل عائد", value: ins.orders.filter((o) => ins.types.get(o.id) === "returning").length },
            ].map((r) => ({ ...r, display: ordersText(r.value), selected: f.customer === r.key }))}
            onPick={(key) => set({ customer: f.customer === key ? "" : (key as Filters["customer"]) })}
          />
          {ins.topCustomers.length > 0 && (
            <>
              <h3 className="dash-sub">الأعلى شراءً في هذه الفترة</h3>
              <ol className="dash-people">
                {ins.topCustomers.map((c) => (
                  <li key={c.phone}>
                    <button type="button" onClick={() => onOpenCustomer(c.phone)}>
                      <span>
                        {c.name}
                        <small dir="ltr">{formatIraqiMobile(c.phone)}</small>
                      </span>
                      <span>
                        <strong>{formatIQD(c.revenue)}</strong>
                        <small>{ordersText(c.orders)}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
        </Card>

        <Card title="حجم الطلب" sub={f.flavors.length ? "بعدد علب النكهة المختارة في الطلب." : "كم علبة في الطلب الواحد."}>
          <BarList
            rows={ins.sizes.map((r) => ({
              key: r.key,
              label: r.label,
              value: r.orders,
              display: ordersText(r.orders),
              sub: `${pct(k.orders ? r.orders / k.orders : 0)} من الطلبات · ${formatIQD(r.revenue)}`,
            }))}
          />
        </Card>

        <Card title="أوقات الطلب" sub="بتوقيت بغداد. يفيد في توقيت النشر والإعلانات.">
          {k.orders ? (
            <>
              <ColumnChart
                name="الطلبات حسب الساعة"
                height={110}
                tickEvery={3}
                cols={ins.hours.map((v, h) => ({ key: String(h), label: `الساعة ${h}:00`, tick: String(h), value: v, display: ordersText(v) }))}
              />
              <h3 className="dash-sub">حسب يوم الأسبوع</h3>
              <BarList
                rows={WEEKDAYS.map((d, i) => ({ key: String(i), label: d, value: ins.weekdays[i], display: ordersText(ins.weekdays[i]) }))}
              />
            </>
          ) : (
            <p className="hint">لا توجد طلبات في هذه الفترة.</p>
          )}
        </Card>

        <Card
          wide
          title={`الطلبات (${n0(ins.orders.length)})`}
          sub="كل الطلبات حسب الفلاتر أعلاه. الملف يفتح في Excel."
          action={
            ins.orders.length > 0 ? (
              <button type="button" className="btn btn--small" onClick={downloadCsv}>
                تنزيل Excel (CSV)
              </button>
            ) : undefined
          }
        >
          {ins.orders.length === 0 ? (
            <p className="hint">لا توجد طلبات بهذه الفلاتر.</p>
          ) : (
            <>
              <ul className="order-rows">
                {ins.orders.slice(0, shown).map((o) => (
                  <li key={o.id}>
                    <OrderRow order={o} today={today} onOpen={onOpenOrder} />
                  </li>
                ))}
              </ul>
              {ins.orders.length > shown && (
                <div className="dash-more-rows">
                  <button type="button" className="btn btn--quiet btn--small" onClick={() => setShown((n) => n + 30)}>
                    عرض 30 أخرى
                  </button>
                  <button type="button" className="link-button" onClick={() => setShown(ins.orders.length)}>
                    عرض الكل ({n0(ins.orders.length)})
                  </button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
