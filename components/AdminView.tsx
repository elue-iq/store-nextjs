"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useToast } from "./Toast";
import { LoginPanel } from "./LoginPanel";
import { AdminStock } from "./AdminStock";
import { AdminDrawer, type AdminView as View } from "./AdminDrawer";
import { usePullToRefresh } from "./usePullToRefresh";
import { ORDERS_REFRESH_EVENT } from "@/lib/ordersRefresh";
import { changedSince, mergeOrders, readOrderCache, writeOrderCache } from "@/lib/orderCache";
import { AdminOrderForm } from "./AdminOrderForm";
import { AdminEatix } from "./AdminEatix";
import { ReviewPanel, ReviewPrompt, SendOrderToCustomer } from "./SendOrderToCustomer";
import { collectAmount } from "@/lib/dispatch";
import { AdminDelivery, callDispatch } from "./AdminDelivery";
import { AdminCouriers } from "./AdminCouriers";
import { AdminSettle } from "./AdminSettle";
import { AdminBoxyFeed } from "./AdminBoxy";
import { AdminPrep } from "./AdminPrep";
import { AdminReviews } from "./AdminReviews";
import { AdminCoupons } from "./AdminCoupons";
import { AdminRewards } from "./AdminRewards";
import { AdminAffiliates } from "./AdminAffiliates";
import { AdminGifts } from "./AdminGifts";
import { callGiftAdmin } from "@/lib/gift-admin";
import { MANUAL_GIFT } from "@/lib/gifts";
import { AdminDashboard } from "./AdminDashboard";
import { AdminOrderFilters } from "./AdminOrderFilters";
import { activeFacets, clearFacet, EMPTY_FILTERS, facetChoices, loadFilters, passes, saveFilters, type OrderFilters, type Sort } from "./orderFilters";
import { orderTime } from "@/lib/order-time";
import { isWholesale } from "@/lib/wholesale";
import { OrderRow, REVIEW_STATE_LABELS, baghdadDay, reviewState, shortTime, type ReviewState } from "./AdminOrderRow";
import { buildCustomers, CustomerDetail, CustomerList, CustomersSummary } from "./AdminCustomers";
import { jarsLabel } from "./AddToCart";
import { DeliveryTracking, OrderItemsList, StatusTrack } from "./OrderBits";
import { formatPoints, pointsFor } from "@/lib/loyalty";
import { attributionOf } from "@/lib/insights";
import { heardLabel } from "@/lib/attribution";
import { dataClient, newestFirst, STATUS_LABELS, STATUS_ORDER, type Order, type OrderStatus } from "@/lib/data";
import { formatIraqiMobile, toLatinDigits } from "@/lib/phone";
import { slotText } from "@/lib/delivery-slot";
import { deliveryPayOf, formatIQD, minusIQD, payKeyOf, PAY_KEY_LABELS, payMethodText, site, type PayKey } from "@/lib/site";
import { fullAddress } from "@/lib/iraq";
import { products } from "@/lib/products";
import { OPEN_ORDER_EVENT, OPEN_VIEW_EVENT, publishOrders } from "@/lib/adminFeed";
import { AdminSettings } from "./AdminSettings";


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

// Which section the list screen shows (?view=dashboard etc.), so a refresh stays there.
function viewFromUrl(): View {
  const v = new URLSearchParams(window.location.search).get("view");
  return v === "dashboard" || v === "customers" || v === "products" || v === "delivery" || v === "reviews" || v === "prep" || v === "coupons" || v === "rewards" || v === "affiliates" || v === "gifts" || v === "settings"
    ? v
    : "orders";
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
    // 100 per page: each order runs one resolver per team-only field (61 today), and AppSync stops a
    // request at 10,000 resolvers («Resolver invocation limit reached»). 200 per page broke at ~164 orders.
    const res = await dataClient.models.Order.list({ limit: 100, nextToken });
    if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join(" | "));
    all.push(...res.data);
    nextToken = res.nextToken;
  } while (nextToken);
  return all.sort(newestFirst);
}

// Only the orders changed since `since` (ISO, server time). The server still looks through every
// order, but returns, and runs the team-only fields for, the changed ones only: one light request
// instead of several heavy ones. Too many changes (the resolver cap) -> the caller reads everything.
async function loadChangedSince(since: string): Promise<Order[]> {
  const all: Order[] = [];
  let nextToken: string | null | undefined;
  do {
    const res = await dataClient.models.Order.list({ filter: { updatedAt: { gt: since } }, limit: 1000, nextToken });
    if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join(" | "));
    all.push(...res.data);
    nextToken = res.nextToken;
  } while (nextToken);
  return all;
}

export function AdminView() {
  const auth = useAuth();
  const toast = useToast();
  const [allOrders, setOrders] = useState<Order[] | null>(null);
  // The bell in the top bar lists the newest orders from here (lib/adminFeed).
  useEffect(() => publishOrders(allOrders), [allOrders]);
  // Orders waiting for a Qi payment aren't real orders yet: the team sees them once paid.
  const orders = useMemo(() => allOrders?.filter((o) => !(o.qiStatus === "CREATED" && !o.paid)) ?? null, [allOrders]);
  const [synced, setSynced] = useState(false);
  const [failed, setFailed] = useState(false);
  // Shown on screen so a loading problem can be reported with a screenshot.
  const [loadError, setLoadError] = useState("");
  const [{ f, sort }, setFS] = useState<{ f: OrderFilters; sort: Sort }>({ f: EMPTY_FILTERS, sort: "newest" });
  const setF = useCallback((next: OrderFilters | ((cur: OrderFilters) => OrderFilters)) => setFS((cur) => ({ ...cur, f: typeof next === "function" ? next(cur.f) : next })), []);
  const setSort = useCallback((sort: Sort) => setFS((cur) => ({ ...cur, sort })), []);
  const [query, setQuery] = useState("");
  // The filters survive going into an order and back, and a reload (this tab only).
  useEffect(() => setFS(loadFilters()), []);
  useEffect(() => saveFilters(f, sort), [f, sort]);
  const searchRef = useRef<HTMLInputElement>(null);
  const reviewDue = useMemo(() => (allOrders ?? []).filter((o) => reviewState(o) === "notAsked").length, [allOrders]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("orders");
  const [menuOpen, setMenuOpen] = useState(false);
  const listScroll = useRef(0);

  // ---- Navigation (list <-> order screen) --------------------------------

  useEffect(() => {
    setSelected(orderFromUrl());
    setView(viewFromUrl());
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

  // The bell in the top bar (AdminInbox) opens an order or a section here.
  useEffect(() => {
    const onOpen = (e: Event) => openOrder(String((e as CustomEvent).detail));
    const onView = (e: Event) => {
      const v = String((e as CustomEvent).detail) as View;
      setSelected(null);
      setView(v);
      window.history.pushState(null, "", v === "orders" ? "/admin" : `/admin?view=${v}`);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener(OPEN_ORDER_EVENT, onOpen);
    window.addEventListener(OPEN_VIEW_EVENT, onView);
    return () => {
      window.removeEventListener(OPEN_ORDER_EVENT, onOpen);
      window.removeEventListener(OPEN_VIEW_EVENT, onView);
    };
  }, [openOrder]);

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
  // Opening: the list saved on this phone shows at once; then only what changed since is asked for
  // (everything, the first time or after a week). New and changed orders then arrive live.
  // Coming back to the app (or a server function changing orders) asks again for the changes only.

  const ordersRef = useRef<Order[] | null>(null);
  ordersRef.current = allOrders;
  const user = auth.status === "signedIn" && auth.isAdmin ? auth.phone : "";

  const refreshOrders = useCallback(async (): Promise<void> => {
    const since = ordersRef.current ? changedSince(ordersRef.current) : null;
    if (since) {
      try {
        const changed = await loadChangedSince(since);
        setOrders((cur) => mergeOrders(cur ?? [], changed).sort(newestFirst));
        return;
      } catch (err) {
        console.warn("changed-orders read failed, reading everything", err);
      }
    }
    setOrders(await loadAllOrders());
  }, []);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const started = Date.now();
    const cached = readOrderCache(user);
    if (cached) setOrders((prev) => prev ?? [...cached].sort(newestFirst));
    ordersRef.current = ordersRef.current ?? cached;
    refreshOrders()
      .then(() => {
        if (!alive) return;
        setSynced(true);
        setLoadError("");
      })
      .catch((err) => {
        console.error("admin orders list failed", err);
        if (alive) setLoadError(`list: ${err instanceof Error ? err.message : String(err)}`);
      });
    const slow = setTimeout(() => {
      if (alive && !ordersRef.current) setLoadError((e) => e || `لم يصل رد من الخادم خلال ${Math.round((Date.now() - started) / 1000)} ثانية.`);
    }, 15_000);
    const upsert = (o: Order) => alive && setOrders((cur) => (cur ? mergeOrders(cur, [o]).sort(newestFirst) : cur));
    const onError = (err: unknown) => {
      console.error("admin orders live failed", err);
      if (!alive) return;
      setFailed(true);
      setLoadError((e) => e || `live: ${JSON.stringify(err).slice(0, 300)}`);
    };
    const subs = [
      dataClient.models.Order.onCreate().subscribe({ next: upsert, error: onError }),
      dataClient.models.Order.onUpdate().subscribe({ next: upsert, error: onError }),
      dataClient.models.Order.onDelete().subscribe({
        next: (o) => alive && setOrders((cur) => cur?.filter((x) => x.id !== o.id) ?? cur),
        error: onError,
      }),
    ];
    return () => {
      alive = false;
      clearTimeout(slow);
      for (const s of subs) s.unsubscribe();
    };
  }, [user, refreshOrders]);

  // Keep the list on this phone for the next visit (a moment after it settles).
  useEffect(() => {
    if (!user || !allOrders || !synced) return;
    const t = setTimeout(() => writeOrderCache(user, allOrders), 800);
    return () => clearTimeout(t);
  }, [user, allOrders, synced]);

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

  // Re-read the changed orders now. Server functions (assign a courier, Modon, Eatix) and the
  // courier app change orders without the live subscription noticing.
  const reloadOrders = useCallback(async () => {
    try {
      await refreshOrders();
    } catch (err) {
      console.error("orders refresh failed", err);
    }
  }, [refreshOrders]);

  useEffect(() => {
    if (!user) return;
    let last = Date.now(); // the first read is already running
    const run = () => {
      if (Date.now() - last < 1500) return;
      last = Date.now();
      void reloadOrders();
    };
    const onVisible = () => document.visibilityState === "visible" && run();
    window.addEventListener(ORDERS_REFRESH_EVENT, run);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", run);
    return () => {
      window.removeEventListener(ORDERS_REFRESH_EVENT, run);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", run);
    };
  }, [user, reloadOrders]);

  // The team always uses WhatsApp Business. On Android a wa.me link asks "WhatsApp or WhatsApp Business?",
  // so inside /admin those links open WhatsApp Business directly (falling back to the normal link if it is missing).
  useEffect(() => {
    if (auth.status !== "signedIn" || !auth.isAdmin || !/Android/i.test(navigator.userAgent)) return;
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="https://wa.me/"]') as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href);
      const phone = url.pathname.replace(/\D/g, "");
      const text = url.searchParams.get("text") ?? "";
      e.preventDefault();
      window.location.href =
        `intent://send?phone=${phone}&text=${encodeURIComponent(text)}` +
        `#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url=${encodeURIComponent(a.href)};end`;
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [auth.status, auth.isAdmin]);

  // Pull-to-refresh: lists reload the app; order and customer screens refresh their data in place;
  // the new-order form is left alone so a half-filled order is never lost.
  const isForm = selected === "new" || Boolean(selected?.startsWith("new:"));
  const ptr = usePullToRefresh(auth.status === "signedIn" && auth.isAdmin && !isForm, selected ? reloadOrders : undefined);

  const pullEl =
    ptr.pull > 0 || ptr.refreshing ? (
      <div className="ptr" style={{ transform: `translateY(${ptr.pull}px)` }} aria-hidden="true">
        <span className={ptr.refreshing ? "ptr__spin is-spinning" : "ptr__spin"} style={{ rotate: `${ptr.pull * 4}deg` }} />
      </div>
    ) : null;

  const today = baghdadDay(new Date().toISOString());

  const stats = useMemo(() => {
    const list = orders ?? [];
    const todays = list.filter((o) => baghdadDay(orderTime(o)) === today && o.status !== "CANCELLED");
    const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<OrderStatus, number>;
    for (const o of list) counts[o.status] += 1;
    return {
      todayOrders: todays.length,
      todayJars: todays.reduce((n, o) => n + o.jars, 0),
      // Gifts are not sales.
      todayTotal: todays.reduce((n, o) => n + (payKeyOf(o) === "GIFT" ? 0 : o.total), 0),
      counts,
    };
  }, [orders, today]);

  const customers = useMemo(() => buildCustomers(orders ?? []), [orders]);

  const provinces = useMemo(
    () => [...new Set((orders ?? []).map((o) => o.province).filter((p): p is string => Boolean(p)))].sort((a, b) => a.localeCompare(b, "ar")),
    [orders],
  );
  // Local couriers that have orders, for the delivery filter.
  const courierOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of orders ?? []) if (o.courierKind === "LOCAL" && o.courierId) seen.set(o.courierId, o.courierName ?? "—");
    return [...seen.entries()];
  }, [orders]);

  // The search box: order number, cashier / Modon / Boxy numbers, payment number, courier, name, address, phone.
  const searched = useMemo(() => {
    const q = toLatinDigits(query).trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "").replace(/^0+/, "");
    if (!q) return orders ?? [];
    return (orders ?? []).filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        (o.cashierOrderId ?? "").toLowerCase().includes(q) ||
        (o.modonQr ?? "").toLowerCase().includes(q) ||
        (o.modonId ?? "").toLowerCase().includes(q) ||
        (o.boxyCode ?? "").toLowerCase().includes(q) ||
        (o.payRef ?? "").toLowerCase().includes(q) ||
        (o.courierName ?? "").toLowerCase().includes(q) ||
        o.name.toLowerCase().includes(q) ||
        fullAddress(o).toLowerCase().includes(q) ||
        (qDigits.length >= 3 && o.phone.includes(qDigits)),
    );
  }, [orders, query]);

  const { shown, jarsOfPicked } = useMemo(() => {
    const list = searched.filter((o) => passes(o, f, today));
    const jars =
      f.flavors.length && !f.not.flavors
        ? list.reduce((n, o) => n + o.items.reduce((m, i) => m + (i && f.flavors.includes(i.slug) ? i.qty : 0), 0), 0)
        : list.reduce((n, o) => n + o.jars, 0);
    return { shown: sort === "newest" ? list : [...list].reverse(), jarsOfPicked: jars };
  }, [searched, f, sort, today]);
  const choices = useMemo(() => facetChoices(searched, f, today, { provinces, couriers: courierOptions }), [searched, f, today, provinces, courierOptions]);

  const extraFilters = activeFacets(f).length + (query.trim() ? 1 : 0);
  const clearFilters = () => {
    setF(EMPTY_FILTERS);
    setQuery("");
  };

  // Orders for the label PDF: the local-courier orders shown, minus cancelled ones.
  const labelOrders = useMemo(
    () => shown.filter((o) => o.courierKind === "LOCAL" && o.courierId && o.status !== "CANCELLED"),
    [shown],
  );
  const [labelBusy, setLabelBusy] = useState(false);
  async function downloadLabels() {
    setLabelBusy(true);
    try {
      const { buildLabelsPdf, labelsFilename } = await import("@/lib/label");
      const { downloadBlob } = await import("@/lib/receipt");
      // Oldest first, so the sheet follows the order they came in.
      const list = [...labelOrders].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      downloadBlob(await buildLabelsPdf(list), labelsFilename(list));
    } catch (err) {
      console.error("labels failed", err);
      toast({ id: "admin", tone: "attention", message: "تعذّر تجهيز الملصقات. حاول مرة ثانية." });
    } finally {
      setLabelBusy(false);
    }
  }


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
        {pullEl}
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
        {pullEl}
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
        {pullEl}
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
          <OrderDetail
            key={order.id}
            order={order}
            today={today}
            me={auth.phone}
            onOpenCustomer={() => openOrder(`c:${order.phone}`)}
            onOpenCouriers={() => {
              window.history.pushState(null, "", "/admin?view=delivery");
              setView("delivery");
              setSelected(null);
              window.scrollTo({ top: 0 });
            }}
          />
        ) : orders === null ? (
          <p className="panel-loading">جارٍ تحميل الطلب…</p>
        ) : (
          <p className="hint">لم نجد هذا الطلب.</p>
        )}
      </div>
    );
  }

  // ---- List ---------------------------------------------------------------

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
      counts={{ orders: orders?.length ?? 0, customers: customers.length, attention: newCount, prep: orders?.filter((o) => o.status === "CONFIRMED").length ?? 0 }}
      phone={formatIraqiMobile(auth.phone)}
      onClose={() => setMenuOpen(false)}
      onView={(v) => {
        setView(v);
        window.history.replaceState(null, "", v === "orders" ? "/admin" : `/admin?view=${v}`);
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
        {listHead("المنتجات", "سعر الجملة وحالة التوفر لكل نكهة")}
        <AdminStock />
        {drawer}
      </div>
    );
  }

  if (view === "delivery") {
    return (
      <div className="admin-screen">
        {pullEl}
        {listHead("شركات التوصيل", "الشركات المحلية وقناة تيليغرام لكل واحدة")}
        <AdminSettle orders={orders} onOpenOrder={(n) => openOrder(n)} />
        <AdminCouriers orders={orders} onOpenOrder={(n) => openOrder(n)} />
        <AdminBoxyFeed onOpenOrder={(n) => openOrder(n)} />
        {drawer}
      </div>
    );
  }

  if (view === "prep") {
    return (
      <div className="admin-screen">
        {pullEl}
        {listHead("التجهيز", "كم علبة من كل نكهة تحتاج تجهز")}
        <AdminPrep orders={orders} onOpenOrder={openOrder} />
        {drawer}
      </div>
    );
  }

  if (view === "coupons") {
    return (
      <div className="admin-screen">
        {pullEl}
        {listHead("الكوبونات", "أكواد الخصم وأداء كل كود")}
        <AdminCoupons orders={orders} onOpenOrder={openOrder} />
        {drawer}
      </div>
    );
  }

  if (view === "rewards") {
    return (
      <div className="admin-screen">
        {pullEl}
        {listHead("المكافآت والنقاط", "شنو يگدر يشتري العميل بنقاطه، ونقاط يدوية")}
        <AdminRewards orders={orders} onOpenOrder={openOrder} />
        {drawer}
      </div>
    );
  }

  if (view === "gifts") {
    return (
      <div className="admin-screen">
        {pullEl}
        {listHead("حملات الهدايا", "علب هدية تنضاف للطلب كمنتج حقيقي")}
        <AdminGifts orders={orders} onOpenOrder={openOrder} />
        {drawer}
      </div>
    );
  }

  if (view === "affiliates") {
    return (
      <div className="admin-screen">
        {pullEl}
        {listHead("الشركاء والعمولات", "روابط الحملات، الطلبات، والعمولة لكل علبة")}
        <AdminAffiliates orders={orders} onOpenOrder={openOrder} />
        {drawer}
      </div>
    );
  }

  if (view === "settings") {
    return (
      <div className="admin-screen">
        {listHead("الإعدادات", "إعدادات هذا الجهاز")}
        <AdminSettings />
        {drawer}
      </div>
    );
  }

  if (view === "reviews") {
    return (
      <div className="admin-screen">
        {pullEl}
        {listHead("التقييمات", "تقييم الطعم والتوصيل من الزبائن")}
        <AdminReviews onOpenOrder={openOrder} orders={orders} me={auth.phone} />
        {drawer}
      </div>
    );
  }

  if (view === "dashboard") {
    return (
      <div className="admin-screen">
        {pullEl}
        {listHead("لوحة المعلومات", synced ? "كل الأرقام حسب الفترة والفلاتر" : "جارٍ تحميل الطلبات…")}
        <AdminDashboard orders={orders} onOpenOrder={openOrder} onOpenCustomer={(phone) => openOrder(`c:${phone}`)} />
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
      {listHead("لوحة الطلبات", synced ? "مباشر: تظهر الطلبات الجديدة تلقائيًا" : orders ? "جارٍ التحديث…" : "جارٍ تحميل الطلبات…")}

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
      <button
        type="button"
        className="link-button admin-to-dash"
        onClick={() => {
          setView("dashboard");
          window.history.replaceState(null, "", "/admin?view=dashboard");
          window.scrollTo({ top: 0 });
        }}
      >
        كل الأرقام والفلاتر في لوحة المعلومات ←
      </button>

      <div className="admin-tools">
        <button type="button" className="btn btn--full admin-new" onClick={() => openOrder("new")}>
          + طلب جديد لعميل
        </button>
        <form
          className="admin-searchbox"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            searchRef.current?.blur(); // closes the phone keyboard
          }}
        >
          <input
            ref={searchRef}
            className="admin-search"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث برقم الطلب أو الاسم أو الهاتف"
            aria-label="بحث برقم الطلب أو الاسم أو الهاتف أو رقم الكاشير أو مدن أو بوكسي أو رقم العملية"
          />
          <span className="admin-searchbox__btns">
            {query && (
              <button type="button" aria-label="مسح البحث" onClick={() => setQuery("")}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
            <button type="submit" aria-label="بحث">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M16 16l4.5 4.5" />
              </svg>
            </button>
          </span>
        </form>
        <AdminOrderFilters f={f} onChange={setF} sort={sort} onSort={setSort} choices={choices} total={searched.length} shown={shown.length} />
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
      {orders && (
        <p className="admin-summary" aria-live="polite">
          <strong>{shown.length}</strong> طلب · <strong>{jarsOfPicked}</strong> علبة
          {f.flavors.length > 0 &&
            (f.not.flavors ? " · بدون " : " من ") + f.flavors.map((s) => products.find((p) => p.slug === s)?.nameAr ?? s).join(f.not.flavors ? " و" : " + ")}
          {extraFilters > 0 && (
            <button type="button" className="link-button" onClick={clearFilters}>
              مسح الفلاتر ({extraFilters})
            </button>
          )}
          {labelOrders.length > 0 && (
            <button type="button" className="link-button admin-labels" disabled={labelBusy} onClick={() => void downloadLabels()}>
              {labelBusy ? "جارٍ تجهيز الملصقات…" : `ملصقات التوصيل المحلي (${labelOrders.length}) PDF`}
            </button>
          )}
        </p>
      )}

      {orders && !(f.review.length === 1 && f.review[0] === "notAsked" && !f.not.review) && reviewDue > 0 && (
        <button type="button" className="review-due" onClick={() => setF((cur) => ({ ...clearFacet(cur, "status"), review: ["notAsked"], not: { ...cur.not, status: false, review: false } }))}>
          <span>{reviewDue === 1 ? "طلب مُسلّم ما انطلب تقييمه" : `${reviewDue} طلبات مُسلّمة ما انطلب تقييمها`}</span>
          <strong>عرض ←</strong>
        </button>
      )}

      {orders && shown.length === 0 && <p className="hint">لا توجد طلبات هنا.</p>}

      <ul className="order-rows">
        {shown.map((o) => (
          <li key={o.id}>
            <OrderRow order={o} today={today} onOpen={openOrder} flavors={f.not.flavors ? [] : f.flavors} />
          </li>
        ))}
      </ul>
      {drawer}
    </div>
  );
}

// The next step for an order, as one button at the top of its screen.
const NEXT_STEP: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  NEW: { to: "CONFIRMED", label: "تأكيد الطلب" },
  CONFIRMED: { to: "OUT_FOR_DELIVERY", label: "خرج للتوصيل" },
  OUT_FOR_DELIVERY: { to: "DELIVERED", label: "تم التسليم" },
};

// ⋯ menu: actions used now and then, out of the way.
function MoreMenu({ children, label = "المزيد" }: { children: React.ReactNode; label?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  return (
    <details className="more-menu" ref={ref}>
      <summary aria-label={label}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </summary>
      <div className="more-menu__list" role="menu" onClick={() => ref.current && (ref.current.open = false)}>
        {children}
      </div>
    </details>
  );
}

function OrderDetail({
  order: o,
  today,
  me,
  onOpenCustomer,
  onOpenCouriers,
}: {
  order: Order;
  today: string;
  me: string;
  onOpenCustomer: () => void;
  onOpenCouriers: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  // Opened from «وصل التحويل»: the edit form starts as paid by Qi Card.
  const [markTransfer, setMarkTransfer] = useState(false);
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
  // Just marked delivered here: ask for the review right away (even if dismissed before).
  const [justDelivered, setJustDelivered] = useState(false);
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
      if (status === "DELIVERED") setJustDelivered(true);
      // A campaign's gift: cancelling gives its jars back, reopening takes them again.
      if (o.giftUnits && o.giftCampaignId && o.giftCampaignId !== MANUAL_GIFT && (status === "CANCELLED" || o.status === "CANCELLED")) {
        const { data, error } = await callGiftAdmin({ action: "sync", orderId: o.id });
        if (error) toast({ id: "gift", tone: "attention", message: "لم تُحدَّث كمية هدايا الحملة. افتح «حملات الهدايا» للتحديث." });
        else if (data?.converted) toast({ id: "gift", tone: "attention", message: "رجع الطلب، لكن كمية هدايا الحملة خلصت: صارت هديته يدوية." });
        else if (status === "CANCELLED") toast({ id: "gift", message: "رجعت هدية هذا الطلب إلى كمية الحملة." });
      }
      // A cancelled order that was already sent to a local courier: tell them not to deliver it.
      if (status === "CANCELLED" && o.courierKind === "LOCAL" && o.courierStatus === "SENT") {
        const { error } = await callDispatch({ action: "cancel_notice", orderId: o.id });
        toast({
          id: "dispatch",
          tone: error ? "attention" : undefined,
          message: error ? "لم نستطع إبلاغ شركة التوصيل بالإلغاء: أبلغهم يدوياً." : `أُبلغت ${o.courierName} بإلغاء الطلب.`,
        });
      }
    }
  }

  async function saveSummary() {
    try {
      const { saveOrderImage } = await import("@/lib/receipt");
      await saveOrderImage(o);
    } catch {
      toast({ id: "pdf", tone: "attention", message: "تعذّر تجهيز الصورة الآن. حاول مجددًا." });
    }
  }

  async function saveInvoice() {
    try {
      const { buildInvoicePdf, invoiceFilename } = await import("@/lib/invoice");
      const { downloadBlob } = await import("@/lib/receipt");
      downloadBlob(await buildInvoicePdf(o), invoiceFilename(o.orderNumber));
    } catch (err) {
      console.error("invoice failed", err);
      toast({ id: "pdf", tone: "attention", message: "تعذّر تجهيز الفاتورة الآن. حاول مجددًا." });
    }
  }

  if (editing) {
    return (
      <AdminOrderForm
        order={o}
        markTransferPaid={markTransfer}
        onCancel={() => {
          setEditing(false);
          setMarkTransfer(false);
        }}
        onDone={() => {
          setEditing(false);
          setMarkTransfer(false);
          window.scrollTo({ top: 0 });
        }}
      />
    );
  }

  const next = NEXT_STEP[o.status];
  const collect = collectAmount(o);
  const delivered = o.status === "DELIVERED";

  return (
    <article className={`order-detail order-detail--${o.status.toLowerCase()}`}>
      {/* Status and the next step, first thing on the screen. */}
      <section className="order-hero">
        <div className="order-hero__top">
          <label className={`status-select status-select--${o.status.toLowerCase()}`}>
            <span className="visually-hidden">حالة الطلب</span>
            <select
              value={confirmCancel ? "CANCELLED" : o.status}
              disabled={saving}
              onChange={(e) => void setStatus(e.target.value as OrderStatus)}
              aria-label={`حالة الطلب ${o.orderNumber}`}
            >
              {STATUS_ORDER.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <span className="order-hero__time" dir="ltr">
            {shortTime(orderTime(o), today)}
          </span>
          <MoreMenu>
            <button type="button" role="menuitem" onClick={() => setEditing(true)}>
              تعديل الطلب
            </button>
            <a role="menuitem" href={`tel:+${o.phone}`}>
              اتصال بالعميل
            </a>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void navigator.clipboard?.writeText(o.orderNumber);
                toast({ id: "admin", message: `نُسخ ${o.orderNumber}.` });
              }}
            >
              نسخ رقم الطلب
            </button>
            {o.status !== "CANCELLED" && (
              <button type="button" role="menuitem" className="is-danger" onClick={() => setConfirmCancel(true)}>
                إلغاء الطلب
              </button>
            )}
          </MoreMenu>
        </div>
        <StatusTrack status={o.status} />
        <p className="order-hero__money">
          <span>{collect > 0 ? "يستلم المندوب" : "المبلغ"}</span>
          <strong>{collect > 0 ? formatIQD(collect) : o.paid ? "مدفوع" : formatIQD(o.total)}</strong>
          <small>
            {jarsLabel(o.jars)}
            {o.giftUnits ? ` + ${o.giftUnits} هدية` : ""}
          </small>
        </p>
        {confirmCancel ? (
          <div className="order-hero__confirm" role="alert">
            <p>إلغاء الطلب {o.orderNumber}؟</p>
            {o.modonQr && <p className="panel-note">الطلب مُرسل إلى مدن: احذفه من مدن أيضًا أو اتصل بهم إذا استلمه المندوب.</p>}
            {o.boxyUid && <p className="panel-note">الطلب مُرسل إلى بوكسي: ألغِه من بوكسي أيضًا.</p>}
            <div className="order-hero__actions">
              <button type="button" className="btn btn--danger" disabled={saving} onClick={() => void setStatus("CANCELLED")}>
                نعم، إلغاء الطلب
              </button>
              <button type="button" className="btn btn--quiet" onClick={() => setConfirmCancel(false)}>
                تراجع
              </button>
            </div>
          </div>
        ) : next ? (
          <div className="order-hero__actions">
            <button type="button" className="btn btn--full" disabled={saving} onClick={() => void setStatus(next.to)}>
              {saving ? "جارٍ الحفظ…" : next.label}
            </button>
          </div>
        ) : null}
      </section>

      <section className="order-detail__block order-customer">
        <button type="button" className="customer-link" onClick={onOpenCustomer}>
          <span>
            <span className="order-detail__name">
              {isWholesale(o) && <span className="sale-badge">جملة</span>}
              {isWholesale(o) && o.businessName ? `${o.businessName} · ${o.name}` : o.name}
            </span>
            <span className="order-detail__phone" dir="ltr">
              {local}
              {o.phone2 ? ` · ${formatIraqiMobile(o.phone2)}` : ""}
            </span>
          </span>
          <small>كل تفاصيله وطلباته</small>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        <div className="quick-actions">
          <a className="btn btn--quiet btn--small" href={`https://wa.me/${o.phone}`} target="_blank" rel="noopener noreferrer">
            واتساب
          </a>
          <a className="btn btn--quiet btn--small" href={`tel:+${o.phone}`}>
            اتصال
          </a>
          <SendOrderToCustomer order={o} compact />
          <button type="button" className="btn btn--quiet btn--small" onClick={() => void saveSummary()}>
            حفظ الصورة
          </button>
          <button type="button" className="btn btn--quiet btn--small" onClick={() => void saveInvoice()}>
            فاتورة PDF
          </button>
        </div>
      </section>

      <ReviewPanel order={o} me={me} />
      <ReviewPrompt order={o} me={me} force={justDelivered} />

      <section className="order-detail__block">
        <h2>التوصيل</h2>
        <p>{fullAddress(o)}</p>
        {slotText(o) && (
          <p className="order-detail__paid">
            موعد التوصيل: <strong>{slotText(o)}</strong>
          </p>
        )}
        {o.note && <p className="order-card__note">ملاحظة: {o.note}</p>}
      </section>

      <section className="order-detail__block">
        <h2>الطلب</h2>
        <OrderItemsList items={o.items} />
        {(o.discount || o.creditUsed) ? (
          <dl className="price-lines">
            <div>
              <dt>قبل الخصم</dt>
              <dd>{formatIQD(o.subtotal ?? o.total + (o.discount ?? 0) + (o.creditUsed ?? 0))}</dd>
            </div>
            {o.discount ? (
              <div className="is-off">
                <dt>
                  {o.rewardTitle ? (
                    <>مكافأة النقاط: {o.rewardTitle} · {o.pointsSpent ?? 0} نقطة</>
                  ) : (
                    <>
                      {o.couponLabel ?? "خصم"} · <span dir="ltr">{o.couponCode}</span>
                    </>
                  )}
                </dt>
                <dd>{minusIQD(o.discount)}</dd>
              </div>
            ) : null}
            {o.creditUsed ? (
              <div className="is-off">
                <dt>من رصيد العميل</dt>
                <dd>{minusIQD(o.creditUsed)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        <p className="order-card__total">
          <span>
            المجموع · {jarsLabel(o.jars)}
            {o.giftUnits ? ` + ${o.giftUnits} هدية` : ""}
          </span>
          <strong>{formatIQD(o.total)}</strong>
        </p>
        {o.giftUnits ? (
          <p className="order-detail__paid">
            {o.giftCampaignId === MANUAL_GIFT ? "هدية يدوية من الفريق" : "هدية حملة"}: {o.giftUnits} {o.giftUnits === 1 ? "علبة" : "علب"} بسعر 0. تُجهَّز وتُسلَّم مع الطلب (المجموع {o.jars + o.giftUnits} علب).
          </p>
        ) : null}
        {o.marketingConsent != null && (
          <p className="order-card__meta">عروض واتساب: {o.marketingConsent ? "موافق" : "غير موافق"}</p>
        )}
        {o.couponCode && !o.discount && (
          <p className="order-detail__paid">
            الكود <strong dir="ltr">{o.couponCode}</strong>: {o.couponLabel}
          </p>
        )}
        {o.cashback ? (
          <p className="order-detail__paid">
            كاش باك {formatIQD(o.cashback)} {delivered ? "أُضيف لرصيد العميل." : "يُضاف لرصيد العميل بعد التسليم."}
          </p>
        ) : null}
        {o.campaignSlug && (
          <p className="order-detail__paid">
            جاء من حملة <strong dir="ltr">{o.campaignSlug}</strong>
            {o.commission ? ` · عمولة ${formatIQD(o.commission)}${o.commissionPaidAt ? " (مدفوعة)" : delivered ? " (مستحقة)" : " (بعد التسليم)"}` : ""}
          </p>
        )}
        <div className="order-detail__pay">
          {o.payTransfer && !o.paid && o.status !== "CANCELLED" && (
            <div className="panel-note order-detail__transfer">
              <p>
                <strong>اختار العميل التحويل على حساب كي: {formatIQD(o.total + (deliveryPayOf(o) === "driver" ? site.deliveryFee : 0))}</strong>
                <br />
                بانتظار صورة التحويل على واتساب. إذا ما وصل التحويل، المندوب يستلم نقداً كالعادة.
              </p>
              <button
                type="button"
                className="btn btn--small"
                onClick={() => {
                  setMarkTransfer(true);
                  setEditing(true);
                  window.scrollTo({ top: 0 });
                }}
              >
                وصل التحويل: سجّله مدفوع
              </button>
            </div>
          )}
          <p className="order-detail__paid">
            {payKeyOf(o) === "GIFT" ? "هدية من ÉLUE: العلب مجاناً" : o.paid ? "ثمن العلب مدفوع مسبقاً" : "ثمن العلب نقداً عند الاستلام"}
          </p>
          {o.deliveryPaid ? (
            <p className="order-detail__paid">أجور التوصيل مدفوعة مسبقاً من العميل</p>
          ) : (
            o.freeDelivery && <p className="order-detail__paid">توصيل مجاني هدية (نتحمّل أجور التوصيل)</p>
          )}
          {(o.paid || o.deliveryPaid) && payKeyOf(o) !== "GIFT" && payKeyOf(o) !== "unknown" && (
            <p>
              طريقة الدفع: <strong>{payMethodText(o)}</strong>
              {o.payRef && (
                <>
                  {" · رقم العملية: "}
                  <strong dir="ltr">{o.payRef}</strong>
                </>
              )}
            </p>
          )}
          {payKeyOf(o) === "unknown" && (
            <p className="panel-note">لم تُسجَّل طريقة الدفع ولا رقم العملية. افتح «تعديل الطلب» من ⋯ واملأها.</p>
          )}
        </div>
        {o.status !== "CANCELLED" && (
          <p className="order-detail__points">
            {delivered
              ? `أُضيفت ${formatPoints(pointsFor(o.total))} نقطة إلى رصيد العميل.`
              : `تُضاف ${formatPoints(pointsFor(o.total))} نقطة للعميل بعد التوصيل.`}
          </p>
        )}
        <OrderSource order={o} />
        {(o.source || (site.telegramAlerts && o.telegramSent === false)) && (
          <p className="order-card__meta">
            {o.source && <span dir="ltr">{o.source}</span>}
            {site.telegramAlerts && o.telegramSent === false && <span className="order-card__warn">لم يُرسل إلى تيليغرام</span>}
          </p>
        )}
      </section>

      <AdminDelivery order={o} onOpenCouriers={onOpenCouriers} />

      <DeliveryTracking order={o} />

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

      <AdminEatix order={o} />

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
    </article>
  );
}


// Where the order came from: the campaign details saved from the customer's browser, and what
// they answered to «how did you hear about us?» (website orders).
function OrderSource({ order: o }: { order: Order }) {
  const a = attributionOf(o);
  const rows: [string, string][] = [
    ["utm_source", a.utm_source ?? ""],
    ["utm_medium", a.utm_medium ?? ""],
    ["utm_campaign", a.utm_campaign ?? ""],
    ["utm_content", a.utm_content ?? ""],
    ["fbclid", a.fbclid ? `${a.fbclid.slice(0, 14)}…` : ""],
    ["الموقع المحيل", a.referrer ?? ""],
    ["صفحة الدخول", a.landing ?? ""],
  ].filter((r): r is [string, string] => Boolean(r[1]));
  const heard = heardLabel(o.heardFrom);
  if (!rows.length && !heard) return null;
  return (
    <div className="order-source">
      {heard && (
        <p>
          كيف سمع عنا: <strong>{heard}</strong>
          {o.heardNote ? ` (${o.heardNote})` : ""}
        </p>
      )}
      {rows.length > 0 && (
        <dl>
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd dir="ltr">{v}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
