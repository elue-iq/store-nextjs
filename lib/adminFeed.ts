"use client";

import { useSyncExternalStore } from "react";
import type { Order } from "./data";

// The admin's live orders, shared from the orders screen (AdminView) with the bell in the top
// bar (AdminInbox): the bell's list is built from orders already on the phone, so it costs no
// extra data. The bell asks the orders screen to open an order or a section with events.

let current: Order[] = [];
const listeners = new Set<() => void>();

export function publishOrders(orders: Order[] | null) {
  current = orders ?? [];
  listeners.forEach((l) => l());
}

export function useAdminOrders(): Order[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

export const OPEN_ORDER_EVENT = "elue-admin:open-order";
export const OPEN_VIEW_EVENT = "elue-admin:open-view";
export const openAdminOrder = (id: string) => window.dispatchEvent(new CustomEvent(OPEN_ORDER_EVENT, { detail: id }));
export const openAdminView = (view: string) => window.dispatchEvent(new CustomEvent(OPEN_VIEW_EVENT, { detail: view }));
