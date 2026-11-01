"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { LoginPanel } from "./LoginPanel";
import { ReviewForm, ReviewThanks } from "./ReviewForm";
import { dataClient } from "@/lib/data";
import { pendingReview } from "@/lib/reviews";

type Mine = { orderNumber: string; status: string; reviewed?: boolean | null; createdAt: string };

// /review?order=EL-0012 (the link we send after delivery): log in with WhatsApp, then the
// review form for that order. Without ?order, the latest delivered order that waits for one.
export function ReviewView() {
  const auth = useAuth();
  const [wanted, setWanted] = useState<string | null | undefined>(undefined);
  const [orders, setOrders] = useState<Mine[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState<{ delivery: number; taste: number } | null>(null);

  useEffect(() => {
    setWanted(new URLSearchParams(window.location.search).get("order"));
  }, []);

  const owner = auth.status === "signedIn" ? auth.owner : "";
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    (async () => {
      try {
        const all: Mine[] = [];
        let nextToken: string | null | undefined;
        do {
          const res = await dataClient.models.Order.listOrderByOwner(
            { owner },
            { limit: 100, nextToken, selectionSet: ["orderNumber", "status", "reviewed", "createdAt"] },
          );
          if (res.errors?.length) throw new Error(res.errors[0].message);
          all.push(...(res.data as unknown as Mine[]));
          nextToken = res.nextToken;
        } while (nextToken);
        if (alive) setOrders(all);
      } catch (err) {
        console.error("orders failed", err);
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [owner]);

  if (auth.status === "loading" || wanted === undefined) return <p className="panel-loading">لحظة من فضلك…</p>;
  if (auth.status === "signedOut") {
    return <LoginPanel title="قيّم طلبك" intro="سجّل الدخول برقم الواتساب اللي طلبت منه، ويصلك رمز التحقق عبر واتساب." />;
  }
  if (failed) return <p className="panel-note">تعذّر تحميل طلباتك الآن. حدّث الصفحة وحاول مجددًا.</p>;
  if (orders === null) return <p className="panel-loading">جارٍ التحميل…</p>;

  if (done) {
    return (
      <ReviewThanks delivery={done.delivery} taste={done.taste}>
        <div className="review__after">
          <Link href="/#flavors" className="btn btn--full">
            اطلب مرة ثانية
          </Link>
          <Link href="/reviews" className="btn btn--quiet btn--full">
            شوف تقييمات الزبائن
          </Link>
        </div>
      </ReviewThanks>
    );
  }

  const order = wanted ? orders.find((o) => o.orderNumber === wanted) : pendingReview(orders);

  if (!order) {
    return (
      <div className="review review--thanks">
        <h2>{wanted ? "ما لقينا هذا الطلب" : "ما عندك طلب ينتظر التقييم"}</h2>
        <p>{wanted ? "تأكد إنك مسجّل بالرقم اللي طلبت منه." : "لما يوصلك طلبك راح نطلب رأيك هنا."}</p>
        <Link href="/account" className="btn btn--quiet btn--full">
          طلباتي
        </Link>
      </div>
    );
  }
  if (order.reviewed) {
    return (
      <div className="review review--thanks">
        <h2>قيّمت هذا الطلب من قبل 🤎</h2>
        <p>شكراً لك. تقييمك ظاهر بين تقييمات الزبائن كما كتبته.</p>
        <Link href="/reviews" className="btn btn--full">
          شوف تقييمات الزبائن
        </Link>
      </div>
    );
  }
  if (order.status !== "DELIVERED") {
    return (
      <div className="review review--thanks">
        <h2>طلبك لسا بالطريق</h2>
        <p>نفتح لك التقييم بعد ما يوصلك الطلب.</p>
        <Link href="/account" className="btn btn--quiet btn--full">
          تابع طلبك
        </Link>
      </div>
    );
  }
  return <ReviewForm orderNumber={order.orderNumber} onDone={setDone} />;
}
