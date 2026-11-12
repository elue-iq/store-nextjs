"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "./AuthProvider";
import { LoginPanel } from "./LoginPanel";
import { useCart } from "./CartProvider";
import { dataClient } from "@/lib/data";
import { reportPendingPurchase } from "@/lib/pixel";
import { GIFT_DROP_TEXT, type GiftDrop } from "@/lib/gifts";

type State = "checking" | "paid" | "failed" | "waiting";

// Where Qi sends the customer back: /order/paid?o=EL-0012. We ask the server for the payment's
// real status (never trusting the address), then show the result.
export function PaidView() {
  const auth = useAuth();
  const cart = useCart();
  const [orderNumber, setOrderNumber] = useState<string | null | undefined>(undefined);
  const [state, setState] = useState<State>("checking");
  // The order went through without the gift the customer chose (saved before leaving for Qi).
  const [giftNote, setGiftNote] = useState<GiftDrop | null>(null);

  useEffect(() => {
    const o = new URLSearchParams(window.location.search).get("o");
    setOrderNumber(o);
    try {
      const saved = JSON.parse(sessionStorage.getItem("elue-gift-note") ?? "null") as { orderNumber: string; note: GiftDrop } | null;
      if (saved && saved.orderNumber === o) setGiftNote(saved.note);
    } catch {}
  }, []);

  useEffect(() => {
    if (auth.status !== "signedIn" || !orderNumber) return;
    let alive = true;
    (async () => {
      for (let i = 0; i < 6 && alive; i++) {
        try {
          const { data } = await dataClient.mutations.qiConfirm({ orderNumber });
          if (!alive) return;
          if (data?.paid) {
            setState("paid");
            reportPendingPurchase(orderNumber); // only now, with the payment confirmed
            cart.clear();
            return;
          }
          if (data?.status === "FAILED") {
            setState("failed");
            return;
          }
        } catch (err) {
          console.error("qiConfirm failed", err);
        }
        await new Promise((r) => setTimeout(r, 2500));
      }
      if (alive) setState("waiting");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orderNumber]);

  if (orderNumber === undefined || auth.status === "loading") return <p className="panel-loading">لحظة من فضلك…</p>;
  if (!orderNumber) return <p className="panel-loading">لا يوجد طلب لعرضه.</p>;
  if (auth.status === "signedOut") return <LoginPanel compact title="سجّل الدخول لمتابعة طلبك" intro="سجّل الدخول بنفس الرقم الذي أرسلت منه الطلب." />;

  return (
    <div className="order-failed" role="status">
      {state === "checking" && <h2>نتحقق من الدفع…</h2>}
      {state === "paid" && (
        <>
          <h2>تم الدفع واستلمنا طلبك</h2>
          <p>
            رقم الطلب <strong dir="ltr">{orderNumber}</strong>. لا يُطلب منك أي مبلغ عند الاستلام.
          </p>
          {giftNote && <p role="alert">{GIFT_DROP_TEXT[giftNote] ?? GIFT_DROP_TEXT.changed}</p>}
          <Link className="btn btn--full" href={`/account?order=${encodeURIComponent(orderNumber)}`}>
            عرض الطلب
          </Link>
        </>
      )}
      {state === "failed" && (
        <>
          <h2>لم تكتمل عملية الدفع</h2>
          <p>لم يُسحب أي مبلغ ولم نستلم الطلب. سلتك ما زالت محفوظة، يمكنك المحاولة من جديد.</p>
          <Link className="btn btn--full" href="/order">
            العودة إلى السلة
          </Link>
        </>
      )}
      {state === "waiting" && (
        <>
          <h2>ننتظر تأكيد الدفع</h2>
          <p>
            إذا خُصم المبلغ فسيصلك تأكيد طلبك <strong dir="ltr">{orderNumber}</strong> خلال دقائق. وإن تأخر، راسلنا عبر واتساب.
          </p>
          <Link className="btn btn--quiet btn--full" href={`/account?order=${encodeURIComponent(orderNumber)}`}>
            طلباتي
          </Link>
        </>
      )}
    </div>
  );
}
