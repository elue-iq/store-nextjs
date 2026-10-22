// Loyalty points: 10 points for every full 1,000 IQD of an order.
// Points count once the order is delivered (cancelled orders earn nothing).

export const POINTS_PER_1000_IQD = 10;

export function pointsFor(total: number): number {
  return Math.floor(total / 1000) * POINTS_PER_1000_IQD;
}

export function pointsSummary(orders: { total: number; status: string }[]) {
  let earned = 0;
  let pending = 0;
  for (const o of orders) {
    if (o.status === "DELIVERED") earned += pointsFor(o.total);
    else if (o.status !== "CANCELLED") pending += pointsFor(o.total);
  }
  return { earned, pending };
}

export function formatPoints(n: number): string {
  return n.toLocaleString("en-US");
}
