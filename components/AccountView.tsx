"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useCart } from "./CartProvider";
import { useToast } from "./Toast";
import { LoginPanel } from "./LoginPanel";
import { OrderItemsList, StatusTrack } from "./OrderBits";
import { DeliveryFields } from "./DeliveryFields";
import { baghdadTime, dataClient, newestFirst, type Order } from "@/lib/data";
import { formatIraqiMobile } from "@/lib/phone";
import { formatIQD, site } from "@/lib/site";
import { getProduct } from "@/lib/products";
import { fullAddress } from "@/lib/iraq";
import { checkDelivery, type DeliveryInfo, type FieldErrors } from "@/lib/validate";
import { EMPTY_DELIVERY, loadProfile, saveProfile, type Profile } from "@/lib/profile";

type Tab = "orders" | "details";

async function loadMyOrders(owner: string): Promise<Order[]> {
  const all: Order[] = [];
  let nextToken: string | null | undefined;
  do {
    const res = await dataClient.models.Order.listOrderByOwner({ owner }, { limit: 100, nextToken });
    if (res.errors?.length) throw new Error(res.errors[0].message);
    all.push(...res.data);
    nextToken = res.nextToken;
  } while (nextToken);
  return all.sort(newestFirst);
}

export function AccountView() {
  const auth = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("orders");

  // Open "معلوماتي" directly with /account#details.
  useEffect(() => {
    if (window.location.hash === "#details") setTab("details");
  }, []);

  if (auth.status === "loading") return <p className="panel-loading">لحظة من فضلكم…</p>;

  if (auth.status === "signedOut") {
    return (
      <LoginPanel
        title="تسجيل الدخول"
        intro="سجّلوا الدخول برقم الواتساب لمتابعة طلباتكم وحفظ معلومات التوصيل. يصلكم رمز التحقق عبر واتساب."
      />
    );
  }

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

      <div className="tabs" role="tablist" aria-label="أقسام الحساب">
        <button type="button" role="tab" aria-selected={tab === "orders"} onClick={() => setTab("orders")}>
          طلباتي
        </button>
        <button type="button" role="tab" aria-selected={tab === "details"} onClick={() => setTab("details")}>
          معلوماتي
        </button>
      </div>

      <div role="tabpanel">{tab === "orders" ? <MyOrders /> : <MyDetails />}</div>

      <p className="hint panel-foot">
        لديكم سؤال عن طلب؟ راسلونا عبر واتساب{" "}
        <a href={`https://wa.me/${site.whatsappNumber}`} target="_blank" rel="noopener noreferrer" dir="ltr">
          {site.whatsappDisplay}
        </a>
      </p>
    </div>
  );
}

function MyOrders() {
  const auth = useAuth();
  const cart = useCart();
  const toast = useToast();
  const router = useRouter();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!auth.owner) return;
    try {
      setOrders(await loadMyOrders(auth.owner));
      setFailed(false);
    } catch (err) {
      console.error("orders failed", err);
      setFailed(true);
    }
  }, [auth.owner]);

  useEffect(() => {
    void load();
    // Statuses change during the day: refresh when the customer comes back to the tab.
    const onFocus = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load]);

  function reorder(o: Order) {
    let added = 0;
    for (const i of o.items) {
      if (i && getProduct(i.slug)) {
        cart.add(i.slug, i.qty);
        added += i.qty;
      }
    }
    if (!added) return;
    toast({ id: "checkout", message: "أضفنا الطلب نفسه إلى السلة." });
    router.push("/order");
  }

  async function pdf(o: Order) {
    try {
      const { saveOrderPdf } = await import("@/lib/receipt");
      await saveOrderPdf(o);
      toast({ id: "pdf", message: "نزّلنا ملخص الطلب (PDF)." });
    } catch {
      toast({ id: "pdf", tone: "attention", message: "تعذّر تجهيز الملف الآن. حاولوا مجددًا." });
    }
  }

  if (failed) {
    return (
      <div className="panel-note" role="alert">
        تعذّر تحميل طلباتكم الآن.{" "}
        <button type="button" className="link-button" onClick={() => void load()}>
          حاولوا مجددًا
        </button>
      </div>
    );
  }

  if (orders === null) return <p className="panel-loading">جارٍ تحميل طلباتكم…</p>;

  if (orders.length === 0) {
    return (
      <div className="order-empty">
        <p>لا توجد طلبات بعد.</p>
        <Link href="/#flavors" className="btn">
          تصفّحوا النكهات
        </Link>
      </div>
    );
  }

  return (
    <ul className="order-cards">
      {orders.map((o) => (
        <li key={o.id} className="order-card">
          <div className="order-card__head">
            <strong dir="ltr" className="order-card__number">
              {o.orderNumber}
            </strong>
            <span className="order-card__time" dir="ltr">
              {baghdadTime(o.createdAt)}
            </span>
          </div>
          <StatusTrack status={o.status} />
          <OrderItemsList items={o.items} />
          <p className="order-card__total">
            <span>المجموع</span>
            <strong>{formatIQD(o.total)}</strong>
          </p>
          <p className="order-card__address">{fullAddress(o)}</p>
          <div className="order-card__actions">
            <button type="button" className="btn btn--small" onClick={() => reorder(o)}>
              اطلبوا الطلب نفسه
            </button>
            <button type="button" className="btn btn--quiet btn--small" onClick={() => void pdf(o)}>
              ملخص الطلب (PDF)
            </button>
          </div>
        </li>
      ))}
    </ul>
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
      toast({ id: "profile", message: "حُفظت معلوماتكم، وستُستخدم في طلباتكم القادمة." });
    } catch (err) {
      console.error("profile save failed", err);
      toast({ id: "profile", tone: "attention", message: "تعذّر حفظ المعلومات الآن. حاولوا مجددًا." });
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <p className="panel-loading">جارٍ تحميل معلوماتكم…</p>;
  if (state === "failed") {
    return (
      <p className="panel-note" role="alert">
        تعذّر تحميل معلوماتكم الآن. حدّثوا الصفحة وحاولوا مجددًا.
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
      <p className="hint">تُملأ هذه المعلومات تلقائيًا عند كل طلب، ويمكنكم تعديلها في أي وقت.</p>
      <DeliveryFields idPrefix="profile" values={values} errors={errors} onChange={setValues} onErrors={setErrors} />
      <button type="submit" className="btn btn--full" disabled={saving}>
        {saving ? "جارٍ الحفظ…" : "حفظ المعلومات"}
      </button>
    </form>
  );
}
