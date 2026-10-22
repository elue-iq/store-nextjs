"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

type Filter = "ALL" | OrderStatus;

export function AdminView() {
  const auth = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [synced, setSynced] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);

  // Live list: new orders and status changes appear without refreshing.
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

  // New orders while the page is open: a short alert, and a badge on the app icon.
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
    return (orders ?? []).filter((o) => {
      if (filter !== "ALL" && o.status !== filter) return false;
      if (!q) return true;
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        o.name.toLowerCase().includes(q) ||
        fullAddress(o).toLowerCase().includes(q) ||
        (qDigits.length >= 3 && o.phone.includes(qDigits))
      );
    });
  }, [orders, filter, query]);

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

  async function setStatus(o: Order, status: OrderStatus) {
    if (o.status === status) return;
    if (status === "CANCELLED" && confirmCancel !== o.id) {
      setConfirmCancel(o.id);
      return;
    }
    setConfirmCancel(null);
    setSaving(o.id);
    const { errors } = await dataClient.models.Order.update({ id: o.id, status });
    setSaving(null);
    if (errors?.length) {
      console.error("status update failed", errors);
      toast({ id: "admin", tone: "attention", message: `تعذّر حفظ حالة الطلب ${o.orderNumber}. حاولوا مجددًا.` });
    } else {
      toast({ id: "admin", message: `${o.orderNumber}: ${STATUS_LABELS[status]}` });
    }
  }

  return (
    <div className="admin">
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
        <div className="admin-filters" role="group" aria-label="فلترة حسب الحالة">
          {(["ALL", ...STATUS_ORDER] as Filter[]).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "ALL" ? "الكل" : STATUS_LABELS[f]}
              <span>{f === "ALL" ? (orders?.length ?? 0) : stats.counts[f]}</span>
            </button>
          ))}
        </div>
        <input
          className="admin-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحثوا برقم الهاتف أو الاسم أو المنطقة أو رقم الطلب"
          aria-label="بحث"
        />
      </div>

      {failed && (
        <p className="panel-note" role="alert">
          انقطع الاتصال بقائمة الطلبات. حدّثوا الصفحة.
        </p>
      )}

      {orders === null && !failed && <p className="panel-loading">جارٍ تحميل الطلبات…</p>}
      {orders && shown.length === 0 && <p className="hint">لا توجد طلبات هنا.</p>}

      <ul className="order-cards order-cards--admin">
        {shown.map((o) => {
          const local = formatIraqiMobile(o.phone);
          return (
            <li key={o.id} className={`order-card order-card--${o.status.toLowerCase()}`}>
              <div className="order-card__head">
                <strong dir="ltr" className="order-card__number">
                  {o.orderNumber}
                </strong>
                <StatusChip status={o.status} />
                <span className="order-card__time" dir="ltr">
                  {baghdadTime(o.createdAt)}
                </span>
              </div>

              <div className="order-card__who">
                <strong>{o.name}</strong>
                <a href={`https://wa.me/${o.phone}`} target="_blank" rel="noopener noreferrer" dir="ltr">
                  {local}
                </a>
              </div>
              <p className="order-card__address">{fullAddress(o)}</p>
              {o.note && <p className="order-card__note">ملاحظة: {o.note}</p>}

              <OrderItemsList items={o.items} />
              <p className="order-card__total">
                <span>
                  المجموع · {jarsLabel(o.jars)}
                </span>
                <strong>{formatIQD(o.total)}</strong>
              </p>

              {(o.source || o.telegramSent === false) && (
                <p className="order-card__meta">
                  {o.source && <span dir="ltr">{o.source}</span>}
                  {o.telegramSent === false && <span className="order-card__warn">لم يُرسل إلى تيليغرام</span>}
                </p>
              )}

              <div className="status-buttons" role="group" aria-label={`حالة الطلب ${o.orderNumber}`}>
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={o.status === s}
                    disabled={saving === o.id}
                    className={s === "CANCELLED" && confirmCancel === o.id ? "is-confirm" : undefined}
                    onClick={() => void setStatus(o, s)}
                  >
                    {s === "CANCELLED" && confirmCancel === o.id ? "تأكيد الإلغاء؟" : STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
