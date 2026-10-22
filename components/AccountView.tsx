"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useCart } from "./CartProvider";
import { useStock } from "./StockProvider";
import { useToast } from "./Toast";
import { LoginPanel } from "./LoginPanel";
import { OrderItemsList, StatusChip, StatusTrack } from "./OrderBits";
import { DeliveryFields } from "./DeliveryFields";
import { baghdadTime, dataClient, newestFirst, type Order } from "@/lib/data";
import { formatIraqiMobile } from "@/lib/phone";
import { formatIQD, site } from "@/lib/site";
import { getProduct } from "@/lib/products";
import { fullAddress } from "@/lib/iraq";
import { formatPoints, pointsFor, pointsSummary } from "@/lib/loyalty";
import { checkDelivery, type DeliveryInfo, type FieldErrors } from "@/lib/validate";
import { EMPTY_DELIVERY, loadProfile, saveProfile, type Profile } from "@/lib/profile";

type Tab = "orders" | "details";

const CUSTOMER_FIELDS = [
  "id",
  "orderNumber",
  "phone",
  "name",
  "province",
  "area",
  "address",
  "note",
  "source",
  "items.*",
  "jars",
  "total",
  "status",
  "telegramSent",
  "owner",
  "createdAt",
  "updatedAt",
] as const;

async function loadMyOrders(owner: string): Promise<Order[]> {
  const all: Order[] = [];
  let nextToken: string | null | undefined;
  do {
    // Only the fields a customer may read (the team-only ones would come back as errors).
    const res = await dataClient.models.Order.listOrderByOwner(
      { owner },
      { limit: 100, nextToken, selectionSet: CUSTOMER_FIELDS },
    );
    if (res.errors?.length) throw new Error(res.errors[0].message);
    all.push(...(res.data as unknown as Order[]));
    nextToken = res.nextToken;
  } while (nextToken);
  return all.sort(newestFirst);
}

// Customer's own orders, loaded once for the points card and the list.
function useMyOrders(owner: string) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    if (!owner) return;
    try {
      setOrders(await loadMyOrders(owner));
      setFailed(false);
    } catch (err) {
      console.error("orders failed", err);
      setFailed(true);
    }
  }, [owner]);
  useEffect(() => {
    void load();
    // Statuses change during the day: refresh when the customer comes back to the tab.
    const onFocus = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load]);
  return { orders, failed, reload: load };
}

function orderFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("order");
}

export function AccountView() {
  const auth = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("orders");
  const [selected, setSelected] = useState<string | null>(null);
  const listScroll = useRef(0);
  const { orders, failed, reload } = useMyOrders(auth.status === "signedIn" ? auth.owner : "");

  // Open "معلوماتي" with /account#details; an order screen with /account?order=<id>.
  useEffect(() => {
    if (window.location.hash === "#details") setTab("details");
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
    window.history.pushState({ order: id }, "", `/account?order=${encodeURIComponent(id)}`);
    setSelected(id);
    window.scrollTo({ top: 0 });
  }, []);

  const backToList = useCallback(() => {
    if (window.history.state?.order) {
      window.history.back();
    } else {
      window.history.replaceState(null, "", "/account");
      setSelected(null);
      window.scrollTo({ top: 0 });
    }
  }, []);

  // A team member opening a customer's order link goes to the same order in the admin app.
  const redirectToAdmin = auth.status === "signedIn" && auth.isAdmin && Boolean(selected);
  useEffect(() => {
    if (redirectToAdmin && selected) window.location.replace(`/admin?order=${encodeURIComponent(selected)}`);
  }, [redirectToAdmin, selected]);

  if (auth.status === "loading" || redirectToAdmin) return <p className="panel-loading">لحظة من فضلك…</p>;

  if (auth.status === "signedOut") {
    return (
      <LoginPanel
        title="تسجيل الدخول"
        intro={
          selected
            ? "سجّل الدخول برقم الواتساب لعرض هذا الطلب. يصلك رمز التحقق عبر واتساب."
            : "سجّل الدخول برقم الواتساب لمتابعة طلباتك وحفظ معلومات التوصيل. يصلك رمز التحقق عبر واتساب."
        }
      />
    );
  }

  if (selected) {
    const order = orders?.find((o) => o.orderNumber === selected || o.id === selected);
    return (
      <div className="account admin-screen--detail">
        <div className="admin-nav admin-nav--shop">
          <button type="button" className="admin-nav__back" onClick={backToList}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
            طلباتي
          </button>
          {order && (
            <strong className="admin-nav__title" dir="ltr">
              {order.orderNumber}
            </strong>
          )}
        </div>
        {order ? (
          <MyOrderDetail order={order} />
        ) : orders === null ? (
          <p className="panel-loading">جارٍ تحميل الطلب…</p>
        ) : (
          <p className="hint">لم نجد هذا الطلب.</p>
        )}
      </div>
    );
  }

  const points = pointsSummary(orders ?? []);

  return (
    <div className="account">
      <div className="panel-head">
        <div>
          <h1>حسابي</h1>
          <p className="panel-head__sub">
            رقم الواتساب <span dir="ltr">{formatIraqiMobile(auth.phone)}</span>
          </p>
        </div>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            void auth.signOut();
            toast({ id: "login", message: "تم تسجيل الخروج." });
          }}
        >
          تسجيل الخروج
        </button>
      </div>

      <section className="points-card" aria-label="نقاطي">
        <div>
          <span className="points-card__label">نقاطي</span>
          <strong className="points-card__value">
            {orders === null ? "…" : formatPoints(points.earned)} <small>نقطة</small>
          </strong>
        </div>
        <p className="points-card__note">
          {points.pending > 0 && <>{formatPoints(points.pending)} نقطة تُضاف بعد توصيل طلباتك الحالية. </>}
          تحصل على 10 نقاط عن كل 1,000 د.ع، وتُضاف بعد توصيل الطلب.
        </p>
      </section>

      <div className="tabs" role="tablist" aria-label="أقسام الحساب">
        <button type="button" role="tab" aria-selected={tab === "orders"} onClick={() => setTab("orders")}>
          طلباتي
        </button>
        <button type="button" role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")}>
          معلوماتي
        </button>
      </div>

      <div role="tabpanel">
        {tab === "orders" ? (
          <MyOrders orders={orders} failed={failed} reload={reload} onOpen={openOrder} />
        ) : (
          <MyDetails />
        )}
      </div>

      <p className="hint panel-foot">
        لديك سؤال عن طلب؟ راسلنا عبر واتساب{" "}
        <a href={`https://wa.me/${site.whatsappNumber}`} target="_blank" rel="noopener noreferrer" dir="ltr">
          {site.whatsappDisplay}
        </a>
      </p>
    </div>
  );
}

function MyOrders({
  orders,
  failed,
  reload,
  onOpen,
}: {
  orders: Order[] | null;
  failed: boolean;
  reload: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  if (failed) {
    return (
      <div className="panel-note" role="alert">
        تعذّر تحميل طلباتك الآن.{" "}
        <button type="button" className="link-button" onClick={() => void reload()}>
          حاول مجددًا
        </button>
      </div>
    );
  }

  if (orders === null) return <p className="panel-loading">جارٍ تحميل طلباتك…</p>;

  if (orders.length === 0) {
    return (
      <div className="order-empty">
        <p>لا توجد طلبات بعد.</p>
        <Link href="/#flavors" className="btn">
          تصفّح النكهات
        </Link>
      </div>
    );
  }

  return (
    <ul className="order-rows">
      {orders.map((o) => (
        <li key={o.id}>
          <button type="button" className={`order-row order-row--${o.status.toLowerCase()}`} onClick={() => onOpen(o.orderNumber)}>
            <span className="order-row__main">
              <span className="order-row__top">
                <strong dir="ltr">{o.orderNumber}</strong>
                <StatusChip status={o.status} />
              </span>
              <span className="order-row__sub">
                {o.items
                  .filter((i): i is NonNullable<typeof i> => Boolean(i))
                  .map((i) => `${getProduct(i.slug)?.nameAr ?? i.nameAr} × ${i.qty}`)
                  .join("، ")}
              </span>
            </span>
            <span className="order-row__side">
              <strong>{formatIQD(o.total)}</strong>
              <span dir="ltr">{baghdadTime(o.createdAt).slice(0, 10)}</span>
            </span>
            <svg className="order-row__chevron" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MyOrderDetail({ order: o }: { order: Order }) {
  const cart = useCart();
  const toast = useToast();
  const router = useRouter();
  const stock = useStock();
  const points = pointsFor(o.total);

  function reorder() {
    let added = 0;
    const skipped: string[] = [];
    for (const i of o.items) {
      const product = i && getProduct(i.slug);
      if (!i || !product) continue;
      if (!stock.isAvailable(i.slug)) {
        skipped.push(product.nameAr);
        continue;
      }
      cart.add(i.slug, i.qty);
      added += i.qty;
    }
    if (!added) {
      toast({ id: "checkout", tone: "attention", message: "نفدت كمية نكهات هذا الطلب حاليًا." });
      return;
    }
    toast({
      id: "checkout",
      message: skipped.length
        ? `أضفنا الطلب إلى السلة، عدا ${skipped.join(" و")} لنفاد الكمية.`
        : "أضفنا الطلب نفسه إلى السلة.",
    });
    router.push("/order");
  }

  async function pdf() {
    try {
      const { saveOrderPdf } = await import("@/lib/receipt");
      await saveOrderPdf(o);
      toast({ id: "pdf", message: "نزّلنا ملخص الطلب (PDF)." });
    } catch {
      toast({ id: "pdf", tone: "attention", message: "تعذّر تجهيز الملف الآن. حاول مجددًا." });
    }
  }

  return (
    <article className="order-detail">
      <section className="order-detail__block">
        <StatusTrack status={o.status} />
        <span className="order-detail__muted" dir="ltr">
          {baghdadTime(o.createdAt)}
        </span>
      </section>

      <section className="order-detail__block">
        <h2>الطلب</h2>
        <OrderItemsList items={o.items} />
        <p className="order-card__total">
          <span>المجموع</span>
          <strong>{formatIQD(o.total)}</strong>
        </p>
        {o.status !== "CANCELLED" && (
          <p className="order-detail__points">
            {o.status === "DELIVERED"
              ? `أضفنا ${formatPoints(points)} نقطة إلى رصيدك.`
              : `تحصل على ${formatPoints(points)} نقطة بعد توصيل هذا الطلب.`}
          </p>
        )}
      </section>

      <section className="order-detail__block">
        <h2>التوصيل</h2>
        <p>{fullAddress(o)}</p>
        {o.note && <p className="order-card__note">ملاحظة: {o.note}</p>}
      </section>

      <div className="order-detail__actions">
        <button type="button" className="btn btn--full" onClick={reorder}>
          اطلب الطلب نفسه
        </button>
        <p className="hint order-detail__hint">لتعديل الطلب أو إلغائه، راسلنا عبر واتساب.</p>
        <a
          className="btn btn--quiet btn--full"
          href={`https://wa.me/${site.whatsappNumber}?text=${encodeURIComponent(
            `مرحبًا ÉLUE، عندي سؤال عن طلبي ${o.orderNumber}:\n${window.location.origin}/account?order=${encodeURIComponent(o.orderNumber)}`,
          )}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          اسألنا عن هذا الطلب عبر واتساب
        </a>
        <button type="button" className="link-button order-detail__pdf" onClick={() => void pdf()}>
          تنزيل ملخص الطلب (PDF)
        </button>
      </div>
    </article>
  );
}

function MyDetails() {
  const toast = useToast();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [values, setValues] = useState<DeliveryInfo>(EMPTY_DELIVERY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProfile()
      .then((p) => {
        setProfile(p);
        if (p) setValues({ name: p.name, province: p.province, area: p.area, address: p.address });
        setState("ready");
      })
      .catch((err) => {
        console.error("profile failed", err);
        setState("failed");
      });
  }, []);

  async function save() {
    const found = checkDelivery(values);
    setErrors(found);
    if (Object.keys(found).length) {
      toast({ id: "profile", tone: "attention", message: "يُرجى مراجعة الحقول المشار إليها." });
      return;
    }
    setSaving(true);
    try {
      const saved = await saveProfile(values, profile?.id);
      setProfile(saved);
      setValues({ name: saved.name, province: saved.province, area: saved.area, address: saved.address });
      toast({ id: "profile", message: "حُفظت معلوماتك، وستُستخدم في طلباتك القادمة." });
    } catch (err) {
      console.error("profile save failed", err);
      toast({ id: "profile", tone: "attention", message: "تعذّر حفظ المعلومات الآن. حاول مجددًا." });
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <p className="panel-loading">جارٍ تحميل معلوماتك…</p>;
  if (state === "failed") {
    return (
      <p className="panel-note" role="alert">
        تعذّر تحميل معلوماتك الآن. حدّث الصفحة وحاول مجددًا.
      </p>
    );
  }

  return (
    <form
      className="panel-form panel-form--wide"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2>معلومات التوصيل</h2>
      <p className="hint">تُملأ هذه المعلومات تلقائيًا عند كل طلب، ويمكنك تعديلها في أي وقت.</p>
      <DeliveryFields idPrefix="profile" values={values} errors={errors} onChange={setValues} onErrors={setErrors} />
      <button type="submit" className="btn btn--full" disabled={saving}>
        {saving ? "جارٍ الحفظ…" : "حفظ المعلومات"}
      </button>
    </form>
  );
}
