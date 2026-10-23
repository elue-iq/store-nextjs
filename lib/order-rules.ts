// Limits on customer orders (checked on the server in placeOrder; the team's
// own orders from /admin are not limited).

// Still being handled: a customer with one of these can't place another order
// until it's delivered or cancelled. To add to it, they message us.
export const OPEN_STATUSES = ["NEW", "CONFIRMED", "OUT_FOR_DELIVERY"] as const;

export const ORDER_RULES = {
  maxOpenOrders: 1,
  maxOrdersPer24h: 3,
  maxJarsPerOrder: 30, // larger orders: on WhatsApp
};
