"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { useCart } from "./CartProvider";
import { useToast } from "./Toast";
import { LoginPanel } from "./LoginPanel";
import { OrderItemsList, StatusTrack } from "./OrderBits";
import { baghdadTime, dataClient, newestFirst, type Order } from "@/lib/data";
import { formatIraqiMobile } from "@/lib/phone";
import { formatIQD, site } from "@/lib/site";
import { getProduct } from "@/lib/products";

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
    if (auth.status !== "signedIn") {
      setOrders(null);
      return;
    }
    void load();
    // Statuses change during the day: refresh when the customer comes back to the tab.
    const onFocus = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [auth.status, load]);

  if (auth.status === "loading") return <p className="panel-loading">لحظة…</p>;

  if (auth.status === "signedOut") {
    return (
      <LoginPanel
        title="طلباتي"
        intro="سجّلوا الدخول برقم الواتساب اللي تطلبون بيه، وتشوفون كل طلباتكم وحالة كل طلب. نتأكد من الرقم مرة وحدة بس."
      />
    );
  }

  function reorder(o: Order) {
    let added = 0;
    for (const i of o.items) {
      if (i && getProduct(i.slug)) {
        cart.add(i.slug, i.qty);
        added += i.qty;
      }
    }
    if (!added) return;
    toast({ id: "checkout", message: "ضفنا نفس الطلب للسلة" });
    router.push("/order");
  }

  async function pdf(o: Order) {
    try {
      const { saveOrderPdf } = await import("@/lib/receipt");
      await saveOrderPdf(o);
      toast({ id: "pdf", message: "نزّلنا ملخص الطلب (PDF)" });
    } catch {
      toast({ id: "pdf", tone: "attention", message: "ما گدرنا نجهز الملف هسه. حاولوا مرة ثانية." });
    }
  }

  return (
    <div className="account">
      <div className="panel-head">
        <div>
          <h1>طلباتي</h1>
          <p className="panel-head__sub">
            مسجلين بالرقم <span dir="ltr">{formatIraqiMobile(auth.phone)}</span>
          </p>
        </div>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            void auth.signOut();
            toast({ id: "login", message: "سجّلتوا الخروج" });
          }}
        >
          تسجيل الخروج
        </button>
      </div>

      {failed && (
        <div className="panel-note" role="alert">
          ما گدرنا نجيب طلباتكم هسه.{" "}
          <button type="button" className="link-button" onClick={() => void load()}>
            حاولوا مرة ثانية
          </button>
        </div>
      )}

      {!failed && orders === null && <p className="panel-loading">نجيب طلباتكم…</p>}

      {orders && orders.length === 0 && (
        <div className="order-empty">
          <p>ما عندكم طلبات بعد.</p>
          <Link href="/#flavors" className="btn">
            شوفوا النكهات
          </Link>
        </div>
      )}

      {orders && orders.length > 0 && (
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
              <p className="order-card__address">{o.address}</p>
              <div className="order-card__actions">
                <button type="button" className="btn btn--small" onClick={() => reorder(o)}>
                  اطلبوا نفس الطلب
                </button>
                <button type="button" className="btn btn--quiet btn--small" onClick={() => void pdf(o)}>
                  ملخص الطلب (PDF)
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="hint panel-foot">
        عندكم سؤال عن طلب؟ راسلونا على الواتساب{" "}
        <a href={`https://wa.me/${site.whatsappNumber}`} target="_blank" rel="noopener noreferrer" dir="ltr">
          {site.whatsappDisplay}
        </a>
      </p>
    </div>
  );
}
