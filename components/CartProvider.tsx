"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { MAX_QTY_PER_LINE, type CartItem } from "@/lib/order-text";
import { dataClient } from "@/lib/data";

// The cart lives in the customer's browser (localStorage). It survives page
// reloads and failed orders, and is cleared only after an order goes through.

const CART_KEY = "elue-cart-v1";
const SOURCE_KEY = "elue-source-v1";
const SOURCE_PARAMS = ["ref", "utm_source", "utm_medium", "utm_campaign"];
// Affiliate link (?ref=slug): remembered for 30 days, the latest link wins. The campaign's
// coupon (if any) is offered at checkout.
const REF_KEY = "elue-ref-v1";
const COUPON_KEY = "elue-coupon-v1";
const REF_DAYS = 30;
type RefState = { ref: string; at: number; coupon?: { code: string; label: string } | null };

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
  // Affiliate campaign (link) and the coupon code the customer typed.
  ref: string;
  refCoupon: { code: string; label: string } | null;
  couponCode: string;
  setCouponCode: (code: string) => void;
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
  const [refState, setRefState] = useState<RefState | null>(null);
  const [couponCode, setCoupon] = useState("");

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

    setCoupon(read<string>(COUPON_KEY, ""));
    const saved = read<RefState | null>(REF_KEY, null);
    const fresh = saved && Date.now() - saved.at < REF_DAYS * 86_400_000 ? saved : null;
    const linkRef = (params.get("ref") ?? "").trim().toLowerCase().slice(0, 40);
    if (linkRef) {
      const next: RefState = { ref: linkRef, at: Date.now(), coupon: fresh?.ref === linkRef ? fresh.coupon : null };
      write(REF_KEY, next);
      setRefState(next);
      // Count the visit and learn the campaign's coupon (once per visit to the link).
      void dataClient.mutations
        .campaignVisit({ ref: linkRef }, { authMode: "apiKey" })
        .then(({ data }) => {
          const r = typeof data === "string" ? (JSON.parse(data) as { ok?: boolean; coupon?: RefState["coupon"] }) : null;
          if (!r?.ok) {
            write(REF_KEY, null);
            setRefState(null);
            return;
          }
          const withCoupon = { ...next, coupon: r.coupon ?? null };
          write(REF_KEY, withCoupon);
          setRefState(withCoupon);
        })
        .catch((err) => console.error("campaign visit failed", err));
    } else {
      setRefState(fresh);
    }
    setReady(true);
  }, []);

  const setCouponCode = useCallback((code: string) => {
    write(COUPON_KEY, code);
    setCoupon(code);
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
      ref: refState?.ref ?? "",
      refCoupon: refState?.coupon ?? null,
      couponCode,
      setCouponCode,
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
  }, [cart, ready, source, update, refState, couponCode, setCouponCode]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
