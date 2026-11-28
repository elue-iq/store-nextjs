"use client";

import { useState } from "react";
import { useToast } from "./Toast";
import { useAuth } from "./AuthProvider";
import { dataClient, type Courier, type Order } from "@/lib/data";
import { collectAmount } from "@/lib/dispatch";
import { carrierOf, courierFee, feesOf } from "@/lib/delivery-money";
import { formatIQD } from "@/lib/site";
import { toLatinDigits } from "@/lib/phone";
import { requestOrdersRefresh } from "@/lib/ordersRefresh";

// The delivery company's fee for this order (internal: the customer still sees 5,000), and
// what the company hands over for it. A far area costs more: change it here for this order.
const QUICK = [3000, 4000, 5000, 6000, 7000];

export function AdminDeliveryFee({ order: o, couriers }: { order: Order; couriers: Courier[] | null }) {
  const toast = useToast();
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);

  const carrier = carrierOf(o);
  if (!carrier && o.status !== "DELIVERED") return null;
  const { fee, from } = courierFee(o, feesOf(couriers));
  const collected = collectAmount(o);
  const net = fee === null ? null : collected - fee;
  const company = carrier === "BOXY" ? "بوكسي" : carrier === "MODON" ? "مدن" : o.courierName ?? "تسليم مباشر";
  const fromText =
    from === "order" ? "خاصة بهذا الطلب" : from === "company" ? `حسب ${company}` : from === "default" ? `الافتراضية لـ ${company}` : null;

  async function save(value: number | null) {
    setBusy(true);
    const { errors } = await dataClient.models.Order.update({ id: o.id, deliveryCost: value, editedBy: auth.phone, editedAt: new Date().toISOString() });
    setBusy(false);
    if (errors?.length) return toast({ id: "fee", tone: "attention", message: "ما انحفظت الأجرة. جرّبوا مرة ثانية." });
    setEditing(false);
    setCustom("");
    requestOrdersRefresh();
    toast({ id: "fee", message: value === null ? "رجعت للأجرة الافتراضية." : `أجرة هذا الطلب ${formatIQD(value)}.` });
  }

  return (
    <section className="order-detail__block delivery-fee" aria-labelledby="fee-title">
      <h2 id="fee-title">حساب شركة التوصيل</h2>
      <dl className="delivery-fee__rows">
        <div>
          <dt>أجرة {company}</dt>
          <dd>
            {fee === null ? <span className="order-card__warn">غير محددة</span> : formatIQD(fee)}
            {fromText && <small>{fromText}</small>}
          </dd>
        </div>
        <div>
          <dt>يجمع من الزبون</dt>
          <dd>{formatIQD(collected)}</dd>
        </div>
        <div className="delivery-fee__net">
          <dt>{net !== null && net < 0 ? "ندفع للشركة" : "نستلم من الشركة"}</dt>
          <dd>{net === null ? "—" : formatIQD(Math.abs(net))}</dd>
        </div>
      </dl>
      {o.courierSettledAt && (
        <p className="hint">
          استلمنا {typeof o.courierSettledAmount === "number" ? formatIQD(o.courierSettledAmount) : "المبلغ"} بتاريخ {o.courierSettledAt.slice(0, 10)}.
        </p>
      )}
      {!editing ? (
        <button type="button" className="btn btn--quiet btn--small" onClick={() => setEditing(true)}>
          {fee === null ? "حددوا الأجرة" : "تغيير الأجرة (منطقة بعيدة)"}
        </button>
      ) : (
        <div className="delivery-fee__edit">
          <div className="delivery-fee__chips">
            {QUICK.map((v) => (
              <button key={v} type="button" className={`chip${fee === v ? " is-on" : ""}`} disabled={busy} onClick={() => void save(v)}>
                {formatIQD(v)}
              </button>
            ))}
          </div>
          <form
            className="delivery-fee__custom"
            onSubmit={(e) => {
              e.preventDefault();
              const v = Number(toLatinDigits(custom).replace(/[^\d]/g, ""));
              if (custom.trim() && v >= 0 && v <= 100000) void save(v);
            }}
          >
            <input value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="numeric" dir="ltr" placeholder="مبلغ آخر" aria-label="أجرة أخرى بالدينار" />
            <button type="submit" className="btn btn--small" disabled={busy || !custom.trim()}>
              حفظ
            </button>
          </form>
          {from === "order" && (
            <button type="button" className="link-button" disabled={busy} onClick={() => void save(null)}>
              رجوع للأجرة الافتراضية
            </button>
          )}
          <button type="button" className="link-button" onClick={() => setEditing(false)}>
            إلغاء
          </button>
        </div>
      )}
    </section>
  );
}
