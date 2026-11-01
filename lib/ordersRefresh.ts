// Server functions (assign a courier, send to Modon, Eatix…) change an order straight in the
// database, so the live subscription does not announce it. They call this afterwards and the
// admin screen re-reads the orders.
export const ORDERS_REFRESH_EVENT = "elue:orders-refresh";

export function requestOrdersRefresh(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ORDERS_REFRESH_EVENT));
}
