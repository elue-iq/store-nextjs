"use client";

import { useState } from "react";
import { useToast } from "./Toast";
import { dataClient, type Order } from "@/lib/data";

const LABEL: Record<string, string> = {
  SENT: "وصل إلى Eatix",
  SIMULATED: "تجريبي (لم يُرسل فعلياً)",
  FAILED: "فشل الإرسال",
  OFF: "الربط غير مفعّل بعد",
  CANCELLED: "أُلغي في Eatix",
};

// The «Eatix (جهاز الكاشير)» block on an order screen in /admin: whether the copy
// of the order reached the cashier system, and a button to send it again.
export function AdminEatix({ order: o }: { order: Order }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const status = o.eatixStatus ?? "";

  async function run(action: "send" | "cancel") {
    setBusy(true);
    try {
      const { errors } = await dataClient.mutations.eatix({ action, orderId: o.id });
      if (errors?.length) {
        const m = errors[0]?.message ?? "";
        const detail = m.includes(":") ? m.slice(m.indexOf(":") + 1).trim() : "";
        toast({ id: "eatix", tone: "attention", message: detail ? `Eatix: ${detail}` : "تعذّر الاتصال بـ Eatix الآن." });
      } else {
        toast({ id: "eatix", message: action === "send" ? "أُرسل الطلب إلى Eatix." : "أُلغي الطلب في Eatix." });
      }
    } catch (err) {
      console.error("eatix call failed", err);
      toast({ id: "eatix", tone: "attention", message: "تعذّر الاتصال بـ Eatix الآن." });
    }
    setBusy(false);
  }

  return (
    <section className="order-detail__block modon">
      <h2>Eatix (جهاز الكاشير)</h2>
      <p>
        {LABEL[status] ?? "لم يُرسل بعد"}
        {o.eatixId && <small dir="ltr"> · {o.eatixId}</small>}
      </p>
      {o.eatixError && status === "FAILED" && <p className="order-card__warn" dir="ltr">{o.eatixError}</p>}
      <div className="modon__actions">
        {status !== "SENT" && o.status !== "CANCELLED" && (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => run("send")}>
            {status === "FAILED" ? "إعادة الإرسال إلى Eatix" : "إرسال إلى Eatix"}
          </button>
        )}
        {Boolean(o.eatixId) && o.status === "CANCELLED" && (status as string) !== "CANCELLED" && (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => run("cancel")}>
            إلغاء في Eatix
          </button>
        )}
      </div>
    </section>
  );
}
