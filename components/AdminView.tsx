"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useToast } from "./Toast";
import { LoginPanel } from "./LoginPanel";
import { AdminStock } from "./AdminStock";
import { AdminDrawer, type AdminView as View } from "./AdminDrawer";
import { usePullToRefresh } from "./usePullToRefresh";
import { AdminOrderForm } from "./AdminOrderForm";
import { AdminModon } from "./AdminModon";
import { buildCustomers, CustomerDetail, CustomerList, CustomersSummary } from "./AdminCustomers";
import { jarsLabel } from "./AddToCart";
import { OrderItemsList, StatusChip, StatusTrack } from "./OrderBits";
import { formatPoints, pointsFor } from "@/lib/loyalty";
import { baghdadTime, dataClient, newestFirst, STATUS_LABELS, STATUS_ORDER, type Order, type OrderStatus } from "@/lib/data";
import { formatIraqiMobile, toLatinDigits } from "@/lib/phone";
import { formatIQD } from "@/lib/site";
import { shareOrderUrl } from "@/lib/share";
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
// "new" = the screen for placing an order for a customer (?new=1).
function orderFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  if (params.has("new")) return params.has("for") ? `new:${params.get("for")}` : "new";
  const customer = params.get("customer");
  return customer ? `c:${customer}` : params.get("order");
}

function screenUrl(id: string): string {
  if (id === "new") return "/admin?new=1";
  if (id.startsWith("new:")) return `/admin?new=1&for=${encodeURIComponent(id.slice(4))}`;
  if (id.startsWith("c:")) return `/admin?customer=${encodeURIComponent(id.slice(2))}`;
  return `/admin?order=${encodeURIComponent(id)}`;
}

// First load of every order (pages of 200). Live changes then come from observeQuery.
async function loadAllOrders(): Promise<Order[]> {
  const all: Order[] = [];
  let nextToken: string | null | undefined;
  do {
    const res = await dataClient.models.Order.list({ limit: 200, nextToken });
    if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join(" | "));
    all.push(...res.data);
    nextToken = res.nextToken;
  } while (nextToken);
  return all.sort(newestFirst);
}

export function AdminView() {
  const auth = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [synced, setSynced] = useState(false);
  const [failed, setFailed] = useState(false);
  // Shown on screen so a loading problem can be reported with a screenshot.
  const [loadError, setLoadError] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [sort, setSort] = useState<Sort>("newest");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("orders");
  const [menuOpen, setMenuOpen] = useState(false);
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
    window.history.pushState({ order: id }, "", screenUrl(id));
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
    let alive = true;
    const started = Date.now();
    loadAllOrders()
      .then((list) => alive && setOrders((prev) => prev ?? list))
      .catch((err) => {
        console.error("admin orders list failed", err);
        if (alive) setLoadError(`list: ${err instanceof Error ? err.message : String(err)}`);
      });
    const slow = setTimeout(() => {
      if (alive) setLoadError((e) => e || `لم يصل رد من الخادم خلال ${Math.round((Date.now() - started) / 1000)} ثانية.`);
    }, 15_000);
    const sub = dataClient.models.Order.observeQuery().subscribe({
      next: ({ items, isSynced }) => {
        // observeQuery's first, unsynced batch can be empty: keep the full list until it syncs.
        if (isSynced || items.length) setOrders([...items].sort(newestFirst));
        setSynced(isSynced);
        setFailed(false);
        setLoadError("");
      },
      error: (err) => {
        console.error("admin orders failed", err);
        setFailed(true);
        setLoadError((e) => e || `live: ${JSON.stringify(err).slice(0, 300)}`);
      },
    });
    return () => {
      alive = false;
      clearTimeout(slow);
      sub.unsubscribe();
    };
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

  // Pull-to-refresh on the list screens only (detail screens and forms are push screens).
  const ptr = usePullToRefresh(auth.status === "signedIn" && auth.isAdmin && !selected);

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

  const customers = useMemo(() => buildCustomers(orders ?? []), [orders]);

  const shown = useMemo(() => {
    const q = toLatinDigits(query).trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "").replace(/^0+/, "");
    const list = (orders ?? []).filter((o) => {
      if (filter !== "ALL" && o.status !== filter) return false;
      if (!q) return true;
      return (
        o.orderNumber.toLowerCase().includes(q) ||
        (o.cashierOrderId ?? "").toLowerCase().includes(q) ||
        o.name.toLowerCase().includes(q) ||
        fullAddress(o).toLowerCase().includes(q) ||
        (qDigits.length >= 3 && o.phone.includes(qDigits))
      );
    });
    return sort === "newest" ? list : [...list].reverse();
  }, [orders, filter, query, sort]);

  // ---- Access -------------------------------------------------------------

  if (auth.status === "loading") return <p className="panel-loading">لحظة من فضلك…</p>;

  if (auth.status === "signedOut") {
    return <LoginPanel title="لوحة الطلبات" intro="هذه الصفحة مخصصة لفريق ÉLUE. سجّل الدخول برقم الواتساب المضاف إلى الفريق." />;
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

  if (selected === "new" || selected?.startsWith("new:")) {
    const forPhone = selected.startsWith("new:") ? selected.slice(4) : "";
    const known = forPhone ? customers.find((c) => c.phone === forPhone) : undefined;
    return (
      <div className="admin-screen admin-screen--detail">
        <div className="admin-nav">
          <button type="button" className="admin-nav__back" onClick={backToList}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
            الطلبات
          </button>
          <strong className="admin-nav__title">{known ? `طلب جديد: ${known.name}` : "طلب جديد لعميل"}</strong>
        </div>
        <AdminOrderForm
          key={forPhone || "blank"}
          prefill={known?.orders[0]}
          onCancel={backToList}
          onDone={(number) => {
            // Don't wait for the live update: fetch the list so the new order is there.
            void loadAllOrders()
              .then(setOrders)
              .catch(() => {});
            window.history.replaceState({ order: number }, "", screenUrl(number));
            setSelected(number);
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
    );
  }

  if (selected?.startsWith("c:")) {
    const customer = customers.find((c) => c.phone === selected.slice(2));
    return (
      <div className="admin-screen admin-screen--detail">
        <div className="admin-nav">
          <button type="button" className="admin-nav__back" onClick={backToList}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
            العملاء
          </button>
          {customer && <strong className="admin-nav__title">{customer.name}</strong>}
        </div>
        {customer ? (
          <CustomerDetail
            customer={customer}
            onOpenOrder={openOrder}
            onNewOrder={() => openOrder(`new:${customer.phone}`)}
          />
        ) : orders === null ? (
          <p className="panel-loading">جارٍ تحميل العميل…</p>
        ) : (
          <p className="hint">لم نجد هذا العميل.</p>
        )}
      </div>
    );
  }

  if (selected) {
    const order = orders?.find((o) => o.orderNumber === selected || o.id === selected);
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
          <OrderDetail key={order.id} order={order} today={today} me={auth.phone} onOpenCustomer={() => openOrder(`c:${order.phone}`)} />
        ) : orders === null ? (
          <p className="panel-loading">جارٍ تحميل الطلب…</p>
        ) : (
          <p className="hint">لم نجد هذا الطلب.</p>
        )}
      </div>
    );
  }

  // ---- List ---------------------------------------------------------------

  const pullEl =
    ptr.pull > 0 || ptr.refreshing ? (
      <div className="ptr" style={{ transform: `translateY(${ptr.pull}px)` }} aria-hidden="true">
        <span className={ptr.refreshing ? "ptr__spin is-spinning" : "ptr__spin"} style={{ rotate: `${ptr.pull * 4}deg` }} />
      </div>
    ) : null;

  const listHead = (title: string, sub: string) => (
    <div className="panel-head">
      <button type="button" className="admin-menu-btn" aria-label="القائمة" aria-haspopup="dialog" onClick={() => setMenuOpen(true)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
        {newCount > 0 && <span className="admin-menu-btn__dot" aria-hidden="true" />}
      </button>
      <div>
        <h1>{title}</h1>
        <p className="panel-head__sub">{sub}</p>
      </div>
    </div>
  );

  const drawer = (
    <AdminDrawer
      open={menuOpen}
      view={view}
      counts={{ orders: orders?.length ?? 0, customers: customers.length, attention: newCount }}
      phone={formatIraqiMobile(auth.phone)}
      onClose={() => setMenuOpen(false)}
      onView={(v) => {
        setView(v);
        setMenuOpen(false);
        window.scrollTo({ top: 0 });
      }}
      onNewOrder={() => {
        setMenuOpen(false);
        openOrder("new");
      }}
      onSignOut={() => void auth.signOut()}
    />
  );

  if (view === "products") {
    return (
      <div className="admin-screen">
        {pullEl}
        {listHead("المنتجات", "حالة التوفر لكل نكهة")}
        <AdminStock />
        {drawer}
      </div>
    );
  }

  if (view === "customers") {
  return (
    <div className="admin-screen">
      {pullEl}
      {listHead("العملاء", `${customers.length} عميل`)}

      <CustomersSummary customers={customers} />
      {orders === null && !failed && <p className="panel-loading">جارٍ تحميل العملاء…</p>}
      <CustomerList customers={customers} onOpen={(phone) => openOrder(`c:${phone}`)} />
      {drawer}
    </div>
  );
  }

  return (
    <div className="admin-screen">
      {pullEl}
      {listHead("لوحة الطلبات", synced ? "مباشر: تظهر الطلبات الجديدة تلقائيًا" : "جارٍ تحميل الطلبات…")}

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

      <div className="admin-tools">
        <button type="button" className="btn btn--full admin-new" onClick={() => openOrder("new")}>
          + طلب جديد لعميل
        </button>
        <input
          className="admin-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث بالرقم أو الاسم أو الهاتف أو رقم الكاشير"
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

      {(failed || (loadError && orders === null)) && (
        <p className="panel-note" role="alert">
          {orders === null ? "تعذّر تحميل الطلبات." : "انقطع الاتصال بقائمة الطلبات. حدّث الصفحة."}
          {loadError && (
            <span className="panel-note__detail" dir="ltr">
              {loadError}
            </span>
          )}
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
              onClick={() => openOrder(o.orderNumber)}
            >
              <span className="order-row__main">
                <span className="order-row__top">
                  <strong dir="ltr">{o.orderNumber}</strong>
                  <StatusChip status={o.status} />
                  {o.paid && <span className="order-row__paid">مدفوع</span>}
                  {o.freeDelivery && <span className="order-row__paid order-row__free">توصيل مجاني</span>}
                </span>
                <span className="order-row__name">{o.name}</span>
                <span className={o.cashierOrderId ? "order-row__cashier" : "order-row__cashier is-missing"}>
                  {o.cashierOrderId ? <>كاشير: <span dir="ltr">{o.cashierOrderId}</span></> : "بلا رقم كاشير"}
                  {o.createdBy && " · أنشأه الفريق"}
                  {o.modonQr && (
                    <>
                      {" · "}مدن: <span dir="ltr">{o.modonQr}</span>
                    </>
                  )}
                </span>
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
      {drawer}
    </div>
  );
}

function OrderDetail({ order: o, today, me, onOpenCustomer }: { order: Order; today: string; me: string; onOpenCustomer: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cashier, setCashier] = useState(o.cashierOrderId ?? "");
  const cashierChanged = cashier.trim() !== (o.cashierOrderId ?? "");

  async function saveCashier() {
    setSaving(true);
    const { errors } = await dataClient.models.Order.update({
      id: o.id,
      cashierOrderId: cashier.trim() || null,
      editedBy: me,
      editedAt: new Date().toISOString(),
    });
    setSaving(false);
    if (errors?.length) {
      console.error("cashier id failed", errors);
      toast({ id: "admin", tone: "attention", message: "تعذّر حفظ رقم الكاشير. حاول مجددًا." });
    } else {
      toast({ id: "admin", message: `${o.orderNumber}: حُفظ رقم الكاشير.` });
    }
  }
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
    const { errors } = await dataClient.models.Order.update({
      id: o.id,
      status,
      editedBy: me,
      editedAt: new Date().toISOString(),
    });
    setSaving(false);
    if (errors?.length) {
      console.error("status update failed", errors);
      toast({ id: "admin", tone: "attention", message: `تعذّر حفظ حالة الطلب ${o.orderNumber}. حاول مجددًا.` });
    } else {
      toast({ id: "admin", message: `${o.orderNumber}: ${STATUS_LABELS[status]}` });
    }
  }

  async function pdf() {
    try {
      const { saveOrderPdf } = await import("@/lib/receipt");
      await saveOrderPdf(o);
    } catch {
      toast({ id: "pdf", tone: "attention", message: "تعذّر تجهيز الملف الآن. حاول مجددًا." });
    }
  }

  if (editing) {
    return (
      <AdminOrderForm
        order={o}
        onCancel={() => setEditing(false)}
        onDone={() => {
          setEditing(false);
          window.scrollTo({ top: 0 });
        }}
      />
    );
  }

  return (
    <article className={`order-detail order-detail--${o.status.toLowerCase()}`}>
      <section className="order-detail__block">
        <StatusTrack status={o.status} />
        <span className="order-detail__muted" dir="ltr">
          {shortTime(o.createdAt, today)}
        </span>
      </section>

      <section className="order-detail__block">
        <h2>رقم طلب الكاشير</h2>
        <form
          className="cashier-field"
          onSubmit={(e) => {
            e.preventDefault();
            if (cashierChanged) void saveCashier();
          }}
        >
          <input
            value={cashier}
            onChange={(e) => setCashier(e.target.value)}
            dir="ltr"
            maxLength={60}
            placeholder="أدخل رقم الطلب في نظام الكاشير"
            aria-label={`رقم طلب الكاشير للطلب ${o.orderNumber}`}
          />
          <button type="submit" className="btn btn--small" disabled={saving || !cashierChanged}>
            حفظ
          </button>
        </form>
      </section>

      <section className="order-detail__block">
        <h2>العميل</h2>
        <button type="button" className="customer-link" onClick={onOpenCustomer}>
          <span>
            <span className="order-detail__name">{o.name}</span>
            <span className="order-detail__phone" dir="ltr">
              {local}
            </span>
          </span>
          <small>كل تفاصيله وطلباته</small>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="order-detail__contact">
          <a className="btn btn--small" href={`https://wa.me/${o.phone}`} target="_blank" rel="noopener noreferrer">
            واتساب
          </a>
          <a className="btn btn--quiet btn--small" href={`tel:+${o.phone}`}>
            اتصال
          </a>
          <a className="btn btn--quiet btn--small" href={shareOrderUrl(o)} target="_blank" rel="noopener noreferrer">
            أرسل له رابط الطلب
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
        {o.paid && (
          <p className="order-detail__paid">مدفوع مسبقاً{o.paidNote ? ` · ${o.paidNote}` : ""}</p>
        )}
        {o.freeDelivery && <p className="order-detail__paid">توصيل مجاني (نتحمّل أجور التوصيل)</p>}
        {o.status !== "CANCELLED" && (
          <p className="order-detail__points">
            {o.status === "DELIVERED"
              ? `أُضيفت ${formatPoints(pointsFor(o.total))} نقطة إلى رصيد العميل.`
              : `تُضاف ${formatPoints(pointsFor(o.total))} نقطة للعميل بعد التوصيل.`}
          </p>
        )}
        {(o.source || o.telegramSent === false) && (
          <p className="order-card__meta">
            {o.source && <span dir="ltr">{o.source}</span>}
            {o.telegramSent === false && <span className="order-card__warn">لم يُرسل إلى تيليغرام</span>}
          </p>
        )}
      </section>

      <AdminModon order={o} />

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
        {confirmCancel && o.modonQr && (
          <p className="panel-note">الطلب مُرسل إلى مدن: احذفه من مدن أيضًا (أعلاه) أو اتصل بهم إذا استلمه المندوب.</p>
        )}
      </section>

      <div className="order-detail__actions">
        <button type="button" className="btn btn--quiet btn--full" onClick={() => setEditing(true)}>
          تعديل الطلب
        </button>
      </div>

      <p className="order-detail__audit">
        {o.createdBy ? (
          <>
            أنشأه الفريق: <span dir="ltr">{formatIraqiMobile(o.createdBy)}</span>
          </>
        ) : (
          "طلبه العميل من الموقع"
        )}
        {o.editedBy && o.editedAt && (
          <>
            <br />
            آخر تعديل: <span dir="ltr">{formatIraqiMobile(o.editedBy)}</span> ·{" "}
            <span dir="ltr">{shortTime(o.editedAt, today)}</span>
          </>
        )}
      </p>

      <button type="button" className="link-button order-detail__pdf" onClick={() => void pdf()}>
        تنزيل ملخص الطلب (PDF)
      </button>
    </article>
  );
}
