"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useToast } from "./Toast";
import { LoginPanel } from "./LoginPanel";
import { AdminStock } from "./AdminStock";
import { jarsLabel } from "./AddToCart";
import { OrderItemsList, StatusChip } from "./OrderBits";
import { baghdadTime, dataClient, newestFirst, STATUS_LABELS, STATUS_ORDER, type Order, type OrderStatus } from "@/lib/data";
import { formatIraqiMobile, toLatinDigits } from "@/lib/phone";
import { formatIQD } from "@/lib/site";
import { fullAddress } from "@/lib/iraq";

const baghdadDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );

// "14:05" for today, "10-21 14:05" for earlier days.
function shortTime(iso: string, today: string): string {
  const full = baghdadTime(iso); // YYYY-MM-DD HH:mm
  return baghdadDay(iso) === today ? full.slice(11) : full.slice(5);
}

type Filter = "ALL" | OrderStatus;
type Sort = "newest" | "oldest";

// The admin works like a phone app: a compact list of orders, and tapping one
// pushes its own screen (?order=<id>). Back works with the «رجوع» button,
// the iPhone swipe-back gesture and the Android back button.
function orderFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("order");
}

export function AdminView() {
  const auth = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [synced, setSynced] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [sort, setSort] = useState<Sort>("newest");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const listScroll = useRef(0);

  // ---- Navigation (list <-> order screen) --------------------------------

  useEffect(() => {
    setSelected(orderFromUrl());
    const onPop = () => {
      const id = orderFromUrl();
      setSelected(id);
      if (!id) requestAnimationFrame(() => window.scrollTo({ top: listScroll.current }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openOrder = useCallback((id: string) => {
    listScroll.current = window.scrollY;
    window.history.pushState({ order: id }, "", `/admin?order=${encodeURIComponent(id)}`);
    setSelected(id);
    window.scrollTo({ top: 0 });
  }, []);

  const backToList = useCallback(() => {
    if (window.history.state?.order) {
      window.history.back(); // the popstate handler shows the list again
    } else {
      // Opened directly on an order (e.g. a shared link): go to the list.
      window.history.replaceState(null, "", "/admin");
      setSelected(null);
      window.scrollTo({ top: 0 });
    }
  }, []);

  // ---- Live orders --------------------------------------------------------

  useEffect(() => {
    if (auth.status !== "signedIn" || !auth.isAdmin) return;
    const sub = dataClient.models.Order.observeQuery().subscribe({
      next: ({ items, isSynced }) => {
        setOrders([...items].sort(newestFirst));
        setSynced(isSynced);
        setFailed(false);
      },
      error: (err) => {
        console.error("admin orders failed", err);
        setFailed(true);
      },
    });
    return () => sub.unsubscribe();
  }, [auth.status, auth.isAdmin]);

  // New orders while the app is open: a short alert, and a badge on the app icon.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!orders || !synced) return;
    const ids = new Set(orders.map((o) => o.id));
    if (seen.current) {
      const fresh = orders.filter((o) => !seen.current!.has(o.id) && o.status === "NEW");
      if (fresh.length) {
        toast({ id: "admin-new", message: `طلب جديد ${fresh[0].orderNumber} من ${fresh[0].name}` });
        navigator.vibrate?.([120, 80, 120]);
      }
    }
    seen.current = ids;
  }, [orders, synced, toast]);

  const newCount = orders?.filter((o) => o.status === "NEW").length ?? 0;
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (newCount > 0) nav.setAppBadge?.(newCount).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [newCount]);

  const today = baghdadDay(new Date().toISOString());

  const stats = useMemo(() => {
    const list = orders ?? [];
    const todays = list.filter((o) => baghdadDay(o.createdAt) === today && o.status !== "CANCELLED");
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const o of list) counts[o.status] += 1;
    return {
      todayOrders: todays.length,
      todayJars: todays.reduce((n, o) => n + o.jars, 0),
      todayTotal: todays.reduce((n, o) => n + o.total, 0),
      counts,
    };
  }, [orders, today]);

  const shown = useMemo(() => {
    const q = toLatinDigits(query).trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "").replace(/^0+/, "");
    const list = (orders ?? []).filter((o) => {
      if (filter !== "ALL" && o.status !== filter) return false;
      if (!q) return true;
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        o.name.toLowerCase().includes(q) ||
        fullAddress(o).toLowerCase().includes(q) ||
        (qDigits.length >= 3 && o.phone.includes(qDigits))
      );
    });
    return sort === "newest" ? list : [...list].reverse();
  }, [orders, filter, query, sort]);

  // ---- Access -------------------------------------------------------------

  if (auth.status === "loading") return <p className="panel-loading">لحظة من فضلكم…</p>;

  if (auth.status === "signedOut") {
    return <LoginPanel title="لوحة الطلبات" intro="هذه الصفحة مخصصة لفريق ÉLUE. سجّلوا الدخول برقم الواتساب المضاف إلى الفريق." />;
  }

  if (!auth.isAdmin) {
    return (
      <div className="login-panel">
        <h1>لوحة الطلبات</h1>
        <p className="login-panel__intro">
          لا يملك الرقم <span dir="ltr">{formatIraqiMobile(auth.phone)}</span> صلاحية الدخول إلى لوحة الطلبات.
        </p>
        <button type="button" className="btn btn--quiet" onClick={() => void auth.signOut()}>
          الدخول برقم آخر
        </button>
      </div>
    );
  }

  // ---- Order screen -------------------------------------------------------

  if (selected) {
    const order = orders?.find((o) => o.id === selected);
    return (
      <div className="admin-screen admin-screen--detail">
        <div className="admin-nav">
          <button type="button" className="admin-nav__back" onClick={backToList}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
            الطلبات
          </button>
          {order && (
            <strong className="admin-nav__title" dir="ltr">
              {order.orderNumber}
            </strong>
          )}
        </div>
        {order ? (
          <OrderDetail key={order.id} order={order} today={today} />
        ) : orders === null ? (
          <p className="panel-loading">جارٍ تحميل الطلب…</p>
        ) : (
          <p className="hint">لم نجد هذا الطلب.</p>
        )}
      </div>
    );
  }

  // ---- List ---------------------------------------------------------------

  return (
    <div className="admin-screen">
      <div className="panel-head">
        <div>
          <h1>لوحة الطلبات</h1>
          <p className="panel-head__sub">
            {synced ? "مباشر: تظهر الطلبات الجديدة تلقائيًا" : "جارٍ تحميل الطلبات…"}
          </p>
        </div>
        <button type="button" className="link-button" onClick={() => void auth.signOut()}>
          تسجيل الخروج
        </button>
      </div>

      <dl className="admin-stats">
        <div>
          <dt>طلبات اليوم</dt>
          <dd>{stats.todayOrders}</dd>
        </div>
        <div>
          <dt>عدد العلب اليوم</dt>
          <dd>{stats.todayJars}</dd>
        </div>
        <div>
          <dt>مبيعات اليوم</dt>
          <dd>{formatIQD(stats.todayTotal)}</dd>
        </div>
        <div className={stats.counts.NEW ? "is-attention" : undefined}>
          <dt>بانتظار التأكيد</dt>
          <dd>{stats.counts.NEW}</dd>
        </div>
      </dl>

      <AdminStock />

      <div className="admin-tools">
        <input
          className="admin-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحثوا بالرقم أو الاسم أو الهاتف"
          aria-label="بحث"
        />
        <div className="admin-tools__row">
          <div className="admin-filters" role="group" aria-label="فلترة حسب الحالة">
            {(["ALL", ...STATUS_ORDER] as Filter[]).map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === "ALL" ? "الكل" : STATUS_LABELS[f]}
                <span>{f === "ALL" ? (orders?.length ?? 0) : stats.counts[f]}</span>
              </button>
            ))}
          </div>
          <select className="admin-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="الترتيب">
            <option value="newest">الأحدث أولًا</option>
            <option value="oldest">الأقدم أولًا</option>
          </select>
        </div>
      </div>

      {failed && (
        <p className="panel-note" role="alert">
          انقطع الاتصال بقائمة الطلبات. حدّثوا الصفحة.
        </p>
      )}

      {orders === null && !failed && <p className="panel-loading">جارٍ تحميل الطلبات…</p>}
      {orders && shown.length === 0 && <p className="hint">لا توجد طلبات هنا.</p>}

      <ul className="order-rows">
        {shown.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              className={`order-row order-row--${o.status.toLowerCase()}`}
              onClick={() => openOrder(o.id)}
            >
              <span className="order-row__main">
                <span className="order-row__top">
                  <strong dir="ltr">{o.orderNumber}</strong>
                  <StatusChip status={o.status} />
                </span>
                <span className="order-row__name">{o.name}</span>
                <span className="order-row__sub">
                  {[o.province, o.area].filter(Boolean).join("، ") || fullAddress(o)}
                </span>
              </span>
              <span className="order-row__side">
                <strong>{formatIQD(o.total)}</strong>
                <span dir="ltr">{shortTime(o.createdAt, today)}</span>
              </span>
              <svg className="order-row__chevron" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrderDetail({ order: o, today }: { order: Order; today: string }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const local = formatIraqiMobile(o.phone);

  async function setStatus(status: OrderStatus) {
    if (o.status === status) return;
    if (status === "CANCELLED" && !confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    setConfirmCancel(false);
    setSaving(true);
    const { errors } = await dataClient.models.Order.update({ id: o.id, status });
    setSaving(false);
    if (errors?.length) {
      console.error("status update failed", errors);
      toast({ id: "admin", tone: "attention", message: `تعذّر حفظ حالة الطلب ${o.orderNumber}. حاولوا مجددًا.` });
    } else {
      toast({ id: "admin", message: `${o.orderNumber}: ${STATUS_LABELS[status]}` });
    }
  }

  async function pdf() {
    try {
      const { saveOrderPdf } = await import("@/lib/receipt");
      await saveOrderPdf(o);
    } catch {
      toast({ id: "pdf", tone: "attention", message: "تعذّر تجهيز الملف الآن. حاولوا مجددًا." });
    }
  }

  return (
    <article className={`order-detail order-detail--${o.status.toLowerCase()}`}>
      <section className="order-detail__block order-detail__status">
        <StatusChip status={o.status} />
        <span dir="ltr">{shortTime(o.createdAt, today)}</span>
      </section>

      <section className="order-detail__block">
        <h2>العميل</h2>
        <p className="order-detail__name">{o.name}</p>
        <p className="order-detail__phone" dir="ltr">
          {local}
        </p>
        <div className="order-detail__contact">
          <a className="btn btn--small" href={`https://wa.me/${o.phone}`} target="_blank" rel="noopener noreferrer">
            واتساب
          </a>
          <a className="btn btn--quiet btn--small" href={`tel:+${o.phone}`}>
            اتصال
          </a>
        </div>
      </section>

      <section className="order-detail__block">
        <h2>التوصيل</h2>
        <p>{fullAddress(o)}</p>
        {o.note && <p className="order-card__note">ملاحظة: {o.note}</p>}
      </section>

      <section className="order-detail__block">
        <h2>الطلب</h2>
        <OrderItemsList items={o.items} />
        <p className="order-card__total">
          <span>المجموع · {jarsLabel(o.jars)}</span>
          <strong>{formatIQD(o.total)}</strong>
        </p>
        {(o.source || o.telegramSent === false) && (
          <p className="order-card__meta">
            {o.source && <span dir="ltr">{o.source}</span>}
            {o.telegramSent === false && <span className="order-card__warn">لم يُرسل إلى تيليغرام</span>}
          </p>
        )}
      </section>

      <section className="order-detail__block">
        <h2>تغيير الحالة</h2>
        <div className="status-grid" role="group" aria-label={`حالة الطلب ${o.orderNumber}`}>
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={o.status === s}
              disabled={saving}
              className={s === "CANCELLED" && confirmCancel ? "is-confirm" : undefined}
              onClick={() => void setStatus(s)}
            >
              {s === "CANCELLED" && confirmCancel ? "تأكيد الإلغاء؟" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </section>

      <button type="button" className="link-button order-detail__pdf" onClick={() => void pdf()}>
        تنزيل ملخص الطلب (PDF)
      </button>
    </article>
  );
}
