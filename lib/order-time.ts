// The time an order counts under. Normally when it was placed (createdAt). The team can record
// an order under another day (orderedAt: same clock time, chosen day), and then every day
// view, report and the POS date follow that. Plain TypeScript with no imports.
export const orderTime = (o: { createdAt: string; orderedAt?: string | null }): string => o.orderedAt || o.createdAt;
