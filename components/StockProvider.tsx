"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { dataClient } from "@/lib/data";

// Which flavors the team has marked «نفدت الكمية» on /admin.
// Read with the public API key, so it works before login. If it can't be
// read, everything shows as available (the server still checks every order).

type Stock = {
  unavailable: Set<string>;
  isAvailable: (slug: string) => boolean;
  refresh: () => Promise<void>;
};

const StockContext = createContext<Stock | null>(null);

export function StockProvider({ children }: { children: React.ReactNode }) {
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const { data, errors } = await dataClient.models.ProductSetting.list({ authMode: "apiKey", limit: 100 });
      if (errors?.length) throw new Error(errors[0].message);
      setUnavailable(new Set((data ?? []).filter((s) => !s.available).map((s) => s.slug)));
    } catch (err) {
      console.warn("Stock could not be loaded", err);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const isAvailable = useCallback((slug: string) => !unavailable.has(slug), [unavailable]);

  return <StockContext.Provider value={{ unavailable, isAvailable, refresh }}>{children}</StockContext.Provider>;
}

export function useStock(): Stock {
  const ctx = useContext(StockContext);
  if (!ctx) throw new Error("useStock must be used inside StockProvider");
  return ctx;
}
