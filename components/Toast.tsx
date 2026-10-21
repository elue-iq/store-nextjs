"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// Short messages at the top of the screen, in ÉLUE colours:
//   "done"      cocoa  — something worked (added to cart, code sent, order placed)
//   "attention" terracotta — something needs the customer (wrong code, missing field)
// A toast with the same `id` replaces the previous one instead of stacking.

type Tone = "done" | "attention";

type ToastInput = {
  message: string;
  tone?: Tone;
  id?: string;
  action?: { label: string; href: string };
};

type ToastItem = Required<Pick<ToastInput, "message" | "tone" | "id">> & Pick<ToastInput, "action"> & { key: number };

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

const SHOW_MS = { done: 3200, attention: 5200 };
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((key: number) => {
    setItems((list) => list.filter((t) => t.key !== key));
    const timer = timers.current.get(key);
    if (timer) clearTimeout(timer);
    timers.current.delete(key);
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const key = ++counter.current;
      const tone = input.tone ?? "done";
      const item: ToastItem = { key, tone, message: input.message, id: input.id ?? `t${key}`, action: input.action };
      setItems((list) => [...list.filter((t) => t.id !== item.id), item].slice(-MAX_VISIBLE));
      timers.current.set(key, setTimeout(() => dismiss(key), SHOW_MS[tone]));
    },
    [dismiss],
  );

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {items.map((t) => (
          <div key={t.key} className={`toast toast--${t.tone}`} role={t.tone === "attention" ? "alert" : "status"}>
            <span className="toast__icon" aria-hidden="true">
              {t.tone === "done" ? (
                <svg viewBox="0 0 16 16" width="14" height="14">
                  <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                "!"
              )}
            </span>
            <p className="toast__message">{t.message}</p>
            {t.action && (
              <Link className="toast__action" href={t.action.href} onClick={() => dismiss(t.key)}>
                {t.action.label}
              </Link>
            )}
            <button type="button" className="toast__close" aria-label="إغلاق" onClick={() => dismiss(t.key)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
