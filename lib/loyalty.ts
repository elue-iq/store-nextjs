// Loyalty points: 10 points for every full 1,000 IQD of an order.
// Points count once the order is delivered (cancelled orders earn nothing).
// Wholesale (B2B) orders earn none. Points spent on a reward (Order.pointsSpent) leave the
// balance while the order is live; a cancelled order gives them back. The team can also give
// (or take back) points by hand (PointsGrant). Rewards: lib/rewards.ts.

export const POINTS_PER_1000_IQD = 10;

export function pointsFor(total: number): number {
  return Math.floor(total / 1000) * POINTS_PER_1000_IQD;
}

type PointsOrder = { total: number; status: string; pointsSpent?: number | null; saleType?: string | null };
const earns = (o: PointsOrder) => o.saleType !== "WHOLESALE";
export const orderPoints = (o: PointsOrder) => (earns(o) ? pointsFor(o.total) : 0);

export function pointsSummary(orders: PointsOrder[], grants: { points: number }[] = []) {
  let earned = 0;
  let pending = 0;
  let spent = 0;
  for (const o of orders) {
    if (o.status === "DELIVERED") earned += orderPoints(o);
    else if (o.status !== "CANCELLED") pending += orderPoints(o);
    if (o.status !== "CANCELLED") spent += Math.max(0, Number(o.pointsSpent ?? 0));
  }
  const granted = grants.reduce((n, g) => n + (Number(g.points) || 0), 0);
  return { earned, pending, spent, granted, balance: Math.max(0, earned + granted - spent) };
}
export type PointsSummary = ReturnType<typeof pointsSummary>;

export function formatPoints(n: number): string {
  return (Number(n) || 0).toLocaleString("en-US");
}
