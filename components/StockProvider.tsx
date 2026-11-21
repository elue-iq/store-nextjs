"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { dataClient } from "@/lib/data";
import { getProduct, type Product } from "@/lib/products";
import { catalogFrom, type ProductSettingRow } from "@/lib/product-settings";

// What the team set per flavor on /admin «المنتجات»: sold out, hidden from the shop, and
// a discount in dinars (lib/product-settings.ts). Read with the public API key, so it works
// before login. If it can't be read, everything shows as available at the site price
// (the server still checks and prices every order).

type Stock = {
  ready: boolean;
  unavailable: Set<string>;
  isAvailable: (slug: string) => boolean; // can be ordered (not sold out, not hidden)
  isListed: (slug: string) => boolean; // shown in the shop (not hidden)
  isHidden: (slug: string) => boolean;
  discountOf: (slug: string) => number; // dinars off one jar
  priceOf: (p: Product) => number; // the jar price customers pay
  refresh: () => Promise<void>;
};

const StockContext = createContext<Stock | null>(null);

export function StockProvider({ children }: { children: React.ReactNode }) {
  const [rows, setRows] = useState<ProductSettingRow[]>([]);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data, errors } = await dataClient.models.ProductSetting.list({ authMode: "apiKey", limit: 100 });
      if (errors?.length) throw new Error(errors[0].message);
      setRows(data ?? []);
    } catch (err) {
      console.warn("Stock could not be loaded", err);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const value = useMemo<Stock>(() => {
    const c = catalogFrom(rows);
    return {
      ready,
      unavailable: new Set(rows.filter((r) => !c.available(r.slug)).map((r) => r.slug)),
      isAvailable: c.available,
      isListed: c.listed,
      isHidden: c.hidden,
      discountOf: (slug) => {
        const p = getProduct(slug);
        return p ? c.discount(p) : 0;
      },
      priceOf: c.price,
      refresh,
    };
  }, [rows, ready, refresh]);

  return <StockContext.Provider value={value}>{children}</StockContext.Provider>;
}

export function useStock(): Stock {
  const ctx = useContext(StockContext);
  if (!ctx) throw new Error("useStock must be used inside StockProvider");
  return ctx;
}
