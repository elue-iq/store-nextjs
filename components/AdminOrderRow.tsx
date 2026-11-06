"use client";

import { StatusChip } from "./OrderBits";
import { boxyNeedsAttention } from "@/lib/boxy";
import { baghdadTime, type Order } from "@/lib/data";
import { fullAddress } from "@/lib/iraq";
import { formatIQD, PAY_KEY_LABELS, payKeyOf } from "@/lib/site";

export const baghdadDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );

// "14:05" for today, "10-21 14:05" for earlier days.
export function shortTime(iso: string, today: string): string {
  const full = baghdadTime(iso); // YYYY-MM-DD HH:mm
  return baghdadDay(iso) === today ? full.slice(11) : full.slice(5);
}

// One order in a list (the orders screen and the dashboard). Tapping opens it.
export function OrderRow({
  order: o,
  today,
  onOpen,
  flavors = [],
}: {
  order: Order;
  today: string;
  onOpen: (orderNumber: string) => void;
  flavors?: string[]; // flavors being filtered: their lines are shown on the row
}) {
  const picked = flavors.length ? o.items.filter((i): i is NonNullable<typeof i> => Boolean(i) && flavors.includes(i!.slug)) : [];
  const pay = payKeyOf(o);
  return (
    <button type="button" className={`order-row order-row--${o.status.toLowerCase()}`} onClick={() => onOpen(o.orderNumber)}>
      <span className="order-row__main">
        <span className="order-row__top">
          <strong dir="ltr">{o.orderNumber}</strong>
          <StatusChip status={o.status} />
          {pay === "GIFT" ? (
            <span className="order-row__paid order-row__free">هدية</span>
          ) : (
            o.paid && <span className="order-row__paid">مدفوع{pay !== "unknown" ? ` · ${PAY_KEY_LABELS[pay]}` : ""}</span>
          )}
          {o.deliveryPaid ? (
            <span className="order-row__paid">التوصيل مدفوع{!o.paid && pay !== "unknown" ? ` · ${PAY_KEY_LABELS[pay]}` : ""}</span>
          ) : (
            o.freeDelivery && <span className="order-row__paid order-row__free">توصيل مجاني</span>
          )}
          {pay === "unknown" && <span className="order-row__paid order-row__warn">بلا طريقة دفع</span>}
          {o.status === "DELIVERED" && (
            <span className={o.reviewed ? "order-row__paid order-row__free" : "order-row__paid"}>
              {o.reviewed ? "★ مُقيَّم" : "بانتظار التقييم"}
            </span>
          )}
          {o.courierKind === "LOCAL" && o.courierName && (
            <span className="order-row__paid order-row__free">{o.courierName}</span>
          )}
        </span>
        <span className="order-row__name">{o.name}</span>
        {picked.length > 0 && (
          <span className="order-row__flavors">
            {picked.map((i) => (
              <span key={i.slug} className="order-row__paid">
                {i.nameAr} × {i.qty}
              </span>
            ))}
          </span>
        )}
        <span className={o.cashierOrderId ? "order-row__cashier" : "order-row__cashier is-missing"}>
          {o.cashierOrderId ? (
            <>
              كاشير: <span dir="ltr">{o.cashierOrderId}</span>
            </>
          ) : (
            "بلا رقم كاشير"
          )}
          {o.createdBy && " · أنشأه الفريق"}
          {o.modonQr && (
            <>
              {" · "}مدن: <span dir="ltr">{o.modonQr}</span>
            </>
          )}
          {o.boxyCode && (
            <>
              {" · "}بوكسي: <span dir="ltr">{o.boxyCode}</span>
            </>
          )}
        </span>
        {o.boxyUid && o.boxyStatusTitle && o.status !== "DELIVERED" && o.status !== "CANCELLED" && (
          <span className={boxyNeedsAttention(o.boxyStatus) ? "order-row__courier is-problem" : "order-row__courier"}>
            لدى بوكسي: {o.boxyStatusTitle}
          </span>
        )}
        <span className="order-row__sub">{[o.province, o.area].filter(Boolean).join("، ") || fullAddress(o)}</span>
      </span>
      <span className="order-row__side">
        <strong>{formatIQD(o.total)}</strong>
        <span dir="ltr">{shortTime(o.createdAt, today)}</span>
      </span>
      <svg className="order-row__chevron" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
    </button>
  );
}
