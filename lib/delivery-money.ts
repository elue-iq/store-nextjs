// Money between ÉLUE and the delivery companies, per order. Internal: the customer always
// sees site.deliveryFee (5,000); the company takes its own fee, and the difference is ours.
//
//   collected = what the driver takes from the customer (jars unless prepaid, plus the 5,000
//               unless delivery is free or prepaid)                     → collectAmount()
//   fee       = what the company keeps for this delivery:
//               the order's own fee (set by the team for a far area), else what Boxy/Modon
//               charged (from their system), else the company's default (Courier.fee)
//   net       = collected − fee: what the company hands over (negative: we owe it)
//
// Delivery profit = what customers paid for delivery − fee. A free delivery is a cost.
// Plain TypeScript, no React: shared by the settlement screen, the order screen and the
// dashboard, and tested on its own.

import { collectAmount } from "./dispatch";
import { site } from "./site";

export type MoneyOrder = {
  status: string;
  total: number;
  paid?: boolean | null;
  freeDelivery?: boolean | null;
  deliveryPaid?: boolean | null;
  payMethod?: string | null;
  paidNote?: string | null;
  courierKind?: string | null;
  courierId?: string | null;
  courierName?: string | null;
  courierSettledAt?: string | null;
  courierSettledAmount?: number | null;
  deliveryCost?: number | null;
  boxyUid?: string | null;
  boxyFee?: number | null;
  boxyStatus?: string | null;
  modonQr?: string | null;
  modonFee?: number | null;
};

// Default fee per local courier id (Courier.fee).
export type CourierFees = Map<string, number>;

export type Carrier = "BOXY" | "MODON" | "LOCAL" | null;

export function carrierOf(o: MoneyOrder): Carrier {
  if (o.courierKind === "BOXY" || o.boxyUid) return "BOXY";
  if (o.courierKind === "MODON" || o.modonQr) return "MODON";
  if (o.courierKind === "LOCAL" && o.courierId) return "LOCAL";
  return null;
}

export type FeeSource = "order" | "company" | "default" | null;

// The delivery company's fee for this order, and where it comes from. null = not known yet.
export function courierFee(o: MoneyOrder, fees: CourierFees): { fee: number | null; from: FeeSource } {
  if (typeof o.deliveryCost === "number") return { fee: o.deliveryCost, from: "order" };
  const c = carrierOf(o);
  if (c === "BOXY" && typeof o.boxyFee === "number") return { fee: o.boxyFee, from: "company" };
  if (c === "MODON" && typeof o.modonFee === "number") return { fee: o.modonFee, from: "company" };
  if (c === "LOCAL" && o.courierId && fees.has(o.courierId)) return { fee: fees.get(o.courierId)!, from: "default" };
  return { fee: null, from: null };
}

// What the customer paid for delivery (to the driver or in advance). Free delivery: 0.
export function deliveryCharged(o: MoneyOrder): number {
  return o.freeDelivery && !o.deliveryPaid ? 0 : site.deliveryFee;
}

// A parcel the company brought back (Boxy return to sender): nothing was sold or collected.
export function isReturned(o: MoneyOrder): boolean {
  return /^rto/.test(String(o.boxyStatus ?? "").toLowerCase().replace(/_/g, "-"));
}

export function isGiftOrder(o: MoneyOrder): boolean {
  return o.payMethod === "GIFT" || o.paidNote === "هدية";
}

// What the company should hand over for this delivered order (collected − fee).
export function netFromCourier(o: MoneyOrder, fees: CourierFees): number | null {
  const { fee } = courierFee(o, fees);
  if (fee === null) return null;
  return collectAmount(o) - fee;
}

// The amount recorded when the team received it, else what it should be.
export function receivedOf(o: MoneyOrder, fees: CourierFees): number | null {
  if (o.courierSettledAt && typeof o.courierSettledAmount === "number") return o.courierSettledAmount;
  return netFromCourier(o, fees);
}

export type Accounts = {
  orders: number; // counted orders (not cancelled, not returned)
  sales: number; // jars sold (gifts are not sales)
  deliveryCharged: number; // what customers paid for delivery
  courierFees: number; // what the companies took (where known)
  feeUnknown: number; // orders whose fee is not known (no default set, or delivered by hand)
  deliveryProfit: number; // deliveryCharged − courierFees, over the orders whose fee is known
  income: number; // sales + delivery profit (before the cost of making the jars)
  received: number; // handed over by the companies and recorded (settled)
  owed: number; // delivered, not settled yet: what the companies still owe us
  owedOrders: number;
  onTheWay: number; // with a company now (not delivered yet): what they will collect, minus fees
  returned: number; // parcels brought back (not counted anywhere above)
};

// The accounts of a list of orders. Cancelled and returned orders are left out.
export function accountsOf(list: MoneyOrder[], fees: CourierFees): Accounts {
  const a: Accounts = { orders: 0, sales: 0, deliveryCharged: 0, courierFees: 0, feeUnknown: 0, deliveryProfit: 0, income: 0, received: 0, owed: 0, owedOrders: 0, onTheWay: 0, returned: 0 };
  for (const o of list) {
    if (o.status === "CANCELLED") continue;
    if (isReturned(o)) {
      a.returned += 1;
      continue;
    }
    a.orders += 1;
    if (!isGiftOrder(o)) a.sales += o.total;
    const charged = deliveryCharged(o);
    const { fee } = courierFee(o, fees);
    // A fee counts once the order is with a company (or delivered).
    const sent = o.status === "OUT_FOR_DELIVERY" || o.status === "DELIVERED";
    if (sent) {
      a.deliveryCharged += charged;
      if (fee === null) a.feeUnknown += 1;
      else {
        a.courierFees += fee;
        a.deliveryProfit += charged - fee;
      }
    }
    if (o.status === "DELIVERED") {
      const net = receivedOf(o, fees);
      if (o.courierSettledAt) a.received += net ?? collectAmount(o);
      else if (carrierOf(o)) {
        a.owed += net ?? collectAmount(o);
        a.owedOrders += 1;
      } else a.received += collectAmount(o); // delivered by hand: the cash is already with us
    } else if (o.status === "OUT_FOR_DELIVERY") {
      a.onTheWay += netFromCourier(o, fees) ?? collectAmount(o);
    }
  }
  a.income = a.sales + a.deliveryProfit;
  return a;
}

// The default fees from the couriers list (Courier.fee); couriers without one are left out.
export function feesOf(couriers: { id: string; fee?: number | null }[] | null | undefined): CourierFees {
  return new Map((couriers ?? []).filter((c) => typeof c.fee === "number").map((c) => [c.id, c.fee as number]));
}
