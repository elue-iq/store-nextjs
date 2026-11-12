"use client";

import { StatusChip } from "./OrderBits";
import { boxyNeedsAttention } from "@/lib/boxy";
import { slotText } from "@/lib/delivery-slot";
import { baghdadTime, type Order } from "@/lib/data";
import { fullAddress } from "@/lib/iraq";
import { formatIQD, PAY_KEY_LABELS, payKeyOf } from "@/lib/site";
import { formatIraqiMobile } from "@/lib/phone";
import { useToast } from "./Toast";

export const baghdadDay = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );

// "14:05" for today, "10-21 14:05" for earlier days.
export function shortTime(iso: string, today: string): string {
  const full = baghdadTime(iso); // YYYY-MM-DD HH:mm
  return baghdadDay(iso) === today ? full.slice(11) : full.slice(5);
}

// Where an order is with delivery: one short tag. Problems at Boxy show in red.
function deliveryTag(o: Order): { text: string; warn?: boolean } | null {
  if (o.modonQr || o.courierKind === "MODON") return { text: "مدن" };
  if (o.boxyUid || o.courierKind === "BOXY") {
    const live = o.status !== "DELIVERED" && o.status !== "CANCELLED";
    if (o.boxyCooled === false && live) return { text: "بوكسي · بدون تبريد", warn: true };
    if (live && o.boxyStatusTitle && boxyNeedsAttention(o.boxyStatus)) return { text: `بوكسي · ${o.boxyStatusTitle}`, warn: true };
    return { text: "بوكسي" };
  }
  if (o.courierKind === "LOCAL" && o.courierName) return { text: o.courierName };
  if (o.status === "CONFIRMED") return { text: "بلا شركة توصيل", warn: true };
  return null;
}

// Paid, gift, free delivery: one short word (the details are on the order screen).
function payNote(o: Order): { text: string; warn?: boolean } | null {
  const pay = payKeyOf(o);
  if (pay === "GIFT") return { text: "هدية" };
  if (pay === "unknown") return { text: "بلا طريقة دفع", warn: true };
  if (o.paid) return { text: `مدفوع · ${PAY_KEY_LABELS[pay]}` };
  if (o.deliveryPaid) return { text: "التوصيل مدفوع" };
  if (o.freeDelivery) return { text: "توصيل مجاني" };
  return null;
}

// Review state of a delivered order. «لم يُطلب» is the one to act on.
export type ReviewState = "notAsked" | "waiting" | "reviewed";
export function reviewState(o: Pick<Order, "status" | "reviewed" | "reviewRequestedAt">): ReviewState | null {
  if (o.status !== "DELIVERED") return null;
  return o.reviewed ? "reviewed" : o.reviewRequestedAt ? "waiting" : "notAsked";
}
export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  notAsked: "لم يُطلب التقييم",
  waiting: "بانتظار التقييم",
  reviewed: "مُقيَّم",
};

// A value with a small copy button (order number, name, phone).
function Copyable({ text, value, label, ltr = false, className }: { text: string; value?: string; label: string; ltr?: boolean; className?: string }) {
  const toast = useToast();
  return (
    <span className={`copyable ${className ?? ""}`}>
      <span dir={ltr ? "ltr" : undefined}>{text}</span>
      <button
        type="button"
        className="copyable__btn"
        aria-label={`نسخ ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard
            ?.writeText(value ?? text)
            .then(() => toast({ id: "copy", message: `نُسخ ${label}: ${value ?? text}` }))
            .catch(() => toast({ id: "copy", tone: "attention", message: "تعذّر النسخ." }));
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="8" y="8" width="12" height="12" rx="2.5" />
          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
        </svg>
      </button>
    </span>
  );
}

// One order in a list (the orders screen and the dashboard). Tapping the card opens it;
// the order number, name and phone each have a copy button.
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
  const delivery = deliveryTag(o);
  const money = payNote(o);
  const review = reviewState(o);
  const slot = o.status !== "DELIVERED" && o.status !== "CANCELLED" ? slotText(o) : null;
  const place = [o.province, o.area].filter(Boolean).join("، ") || fullAddress(o);
  const meta: { text: string; warn?: boolean; key: string }[] = [
    ...(slot ? [{ key: "slot", text: slot }] : []),
    ...(money ? [{ key: "pay", ...money }] : []),
    ...(o.couponCode ? [{ key: "coupon", text: o.couponCode }] : []),
    ...(o.giftUnits ? [{ key: "gift", text: `هدية × ${o.giftUnits}` }] : []),
  ];
  return (
    <article className={`ocard ocard--${o.status.toLowerCase()}`}>
      <button type="button" className="ocard__open" onClick={() => onOpen(o.orderNumber)} aria-label={`فتح الطلب ${o.orderNumber}`} />
      <div className="ocard__line">
        <Copyable className="ocard__num" text={o.orderNumber} label="رقم الطلب" ltr />
        <StatusChip status={o.status} />
        <strong className="ocard__amount">{formatIQD(o.total)}</strong>
      </div>
      <div className="ocard__line">
        <Copyable className="ocard__name" text={o.name} label="الاسم" />
        <span className="ocard__time" dir="ltr">
          {shortTime(o.createdAt, today)}
        </span>
      </div>
      <div className="ocard__line">
        <Copyable className="ocard__phone" text={formatIraqiMobile(o.phone)} value={`0${o.phone.slice(3)}`} label="الرقم" ltr />
        <span className="ocard__place">{place}</span>
      </div>
      {(delivery || review || meta.length > 0) && (
        <div className="ocard__tags">
          {delivery && <span className={delivery.warn ? "ocard__tag is-warn" : "ocard__tag"}>{delivery.text}</span>}
          {review && (
            <span className={`ocard__tag ocard__review is-${review}`}>
              {review === "reviewed" ? "★ " : ""}
              {REVIEW_STATE_LABELS[review]}
            </span>
          )}
          {meta.map((m) => (
            <span key={m.key} className={m.warn ? "ocard__meta is-warn" : "ocard__meta"} dir={m.key === "coupon" ? "ltr" : undefined}>
              {m.text}
            </span>
          ))}
        </div>
      )}
      {picked.length > 0 && (
        <p className="ocard__flavors">{picked.map((i) => `${i.nameAr}${i.gift ? " (هدية)" : ""} × ${i.qty}`).join(" · ")}</p>
      )}
    </article>
  );
}
