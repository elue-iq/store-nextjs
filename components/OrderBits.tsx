// Small pieces shared by "طلباتي" and the admin page.

import { formatIQD } from "@/lib/site";
import { getProduct } from "@/lib/products";
import { STATUS_LABELS, type Order, type OrderStatus } from "@/lib/data";

export function StatusChip({ status }: { status: OrderStatus }) {
  return <span className={`status-chip status-chip--${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>;
}

const TRACK: OrderStatus[] = ["NEW", "CONFIRMED", "OUT_FOR_DELIVERY", "DELIVERED"];
const TRACK_LABELS: Record<string, string> = {
  NEW: "تم الاستلام",
  CONFIRMED: "مؤكَّد",
  OUT_FOR_DELIVERY: "قيد التوصيل",
  DELIVERED: "تم التوصيل",
};

// Four-step progress for the customer. Cancelled orders show the chip only.
export function StatusTrack({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED") return <StatusChip status={status} />;
  const at = TRACK.indexOf(status);
  return (
    <ol className="status-track" aria-label={`حالة الطلب: ${STATUS_LABELS[status]}`}>
      {TRACK.map((s, i) => (
        <li key={s} className={i <= at ? "is-done" : undefined} aria-current={i === at ? "step" : undefined}>
          <span className="status-track__dot" aria-hidden="true" />
          {TRACK_LABELS[s]}
        </li>
      ))}
    </ol>
  );
}

export function OrderItemsList({ items }: { items: Order["items"] }) {
  return (
    <ul className="order-items">
      {items
        .filter((i): i is NonNullable<typeof i> => Boolean(i))
        .map((i) => (
          <li key={i.slug}>
            <span>
              {getProduct(i.slug)?.nameAr ?? i.nameAr} <small dir="ltr">{i.nameEn}</small>
            </span>
            <span className="order-items__qty">× {i.qty}</span>
            <span className="order-items__price">{formatIQD(i.qty * i.price)}</span>
          </li>
        ))}
    </ul>
  );
}
