// The team's order list, kept on this phone between visits so /admin opens at once with the
// last list, then asks the server only for what changed since (see AdminView).
// One entry per signed-in team member; removed on sign-out. Best effort: a full or blocked
// storage just means the list loads from the server as before.

import type { Order } from "./data";

const PREFIX = "elue-admin-orders-v1:";
const MAX_AGE = 7 * 86_400_000; // older than a week: read everything again

export function readOrderCache(user: string): Order[] | null {
  try {
    const raw = localStorage.getItem(PREFIX + user);
    if (!raw) return null;
    const v = JSON.parse(raw) as { at?: number; orders?: Order[] };
    if (!Array.isArray(v.orders) || !v.at || Date.now() - v.at > MAX_AGE) return null;
    return v.orders;
  } catch {
    return null;
  }
}

export function writeOrderCache(user: string, orders: Order[]): void {
  try {
    localStorage.setItem(PREFIX + user, JSON.stringify({ at: Date.now(), orders }));
  } catch {
    clearOrderCache(); // full storage: don't keep a stale copy
  }
}

export function clearOrderCache(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) localStorage.removeItem(k);
  } catch {}
}

// The newest change the list has seen (server time), minus a margin for writes that were in flight.
export function changedSince(orders: Order[]): string | null {
  let max = "";
  for (const o of orders) if (o.updatedAt && o.updatedAt > max) max = o.updatedAt;
  return max ? new Date(Date.parse(max) - 10 * 60_000).toISOString() : null;
}

// Changed orders replace their old copy; new ones are added.
export function mergeOrders(list: Order[], changed: Order[]): Order[] {
  if (!changed.length) return list;
  const byId = new Map(list.map((o) => [o.id, o]));
  for (const o of changed) byId.set(o.id, o);
  return [...byId.values()];
}
