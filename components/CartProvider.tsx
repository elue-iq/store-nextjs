"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { MAX_QTY_PER_LINE, type CartItem } from "@/lib/order-text";

// The cart lives in the customer's browser (localStorage). It survives page
// reloads and failed orders, and is cleared only after an order goes through.

const CART_KEY = "elue-cart-v1";
const SOURCE_KEY = "elue-source-v1";
const SOURCE_PARAMS = ["ref", "utm_source", "utm_medium", "utm_campaign"];

type CartState = Record<string, number>;

type CartContextValue = {
  items: CartItem[];
  count: number;
  ready: boolean;
  add: (slug: string, qty?: number) => void;
  setQty: (slug: string, qty: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
  source: string;
};

const CartContext = createContext<CartContextValue | null>(null);

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: the cart still works for this visit.
  }
}

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<CartState>({});
  const [source, setSource] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setCart(read<CartState>(CART_KEY, {}));

    // Remember where the visitor came from (ad, creator link...) so it shows on the order.
    const params = new URLSearchParams(window.location.search);
    const found = SOURCE_PARAMS.filter((k) => params.get(k)).map((k) => `${k}=${params.get(k)}`);
    if (found.length) {
      const value = found.join(" ").slice(0, 200);
      write(SOURCE_KEY, value);
      setSource(value);
    } else {
      setSource(read<string>(SOURCE_KEY, ""));
    }
    setReady(true);
  }, []);

  const update = useCallback((fn: (prev: CartState) => CartState) => {
    setCart((prev) => {
      const next = fn(prev);
      write(CART_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<CartContextValue>(() => {
    const items = Object.entries(cart).map(([slug, qty]) => ({ slug, qty }));
    return {
      items,
      count: items.reduce((n, i) => n + i.qty, 0),
      ready,
      source,
      add: (slug, qty = 1) =>
        update((prev) => ({ ...prev, [slug]: Math.min(MAX_QTY_PER_LINE, (prev[slug] ?? 0) + qty) })),
      setQty: (slug, qty) =>
        update((prev) => {
          const next = { ...prev };
          if (qty < 1) delete next[slug];
          else next[slug] = Math.min(MAX_QTY_PER_LINE, qty);
          return next;
        }),
      remove: (slug) =>
        update((prev) => {
          const next = { ...prev };
          delete next[slug];
          return next;
        }),
      clear: () => update(() => ({})),
    };
  }, [cart, ready, source, update]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
