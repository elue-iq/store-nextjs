// Small pieces shared by "طلباتي" and the admin page.

import { formatIQD } from "@/lib/site";
import { getProduct } from "@/lib/products";
import { baghdadTime, STATUS_LABELS, type Order, type OrderStatus } from "@/lib/data";
import { parseTrackEvents } from "@/lib/modon";

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

// «تتبّع التوصيل»: the courier's steps so far (newest first) and the expected
// arrival. Shown only once the order has been handed to the courier.
export function DeliveryTracking({ order: o }: { order: Pick<Order, "trackStatus" | "trackEta" | "trackEvents" | "status"> }) {
  const events = parseTrackEvents(o.trackEvents);
  if (!events.length && !o.trackStatus) return null;
  const when = (iso: string) => baghdadTime(iso);
  const list = [...events].reverse();
  const delivered = o.status === "DELIVERED";
  return (
    <section className="order-detail__block delivery-track">
      <h2>تتبّع التوصيل</h2>
      {o.trackStatus && <p className="delivery-track__now">{o.trackStatus}</p>}
      {o.trackEta && !delivered && o.status !== "CANCELLED" && (
        <p className="delivery-track__eta">
          الوقت المتوقع للوصول <strong dir="ltr">{baghdadTime(o.trackEta)}</strong>
        </p>
      )}
      {list.length > 0 && (
        <ol className="delivery-track__list">
          {list.map((e, i) => (
            <li key={`${e.at}-${i}`} className={i === 0 ? "is-current" : undefined}>
              <span>{e.text}</span>
              <small dir="ltr">{when(e.at)}</small>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
