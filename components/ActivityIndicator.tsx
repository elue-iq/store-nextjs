"use client";

// Feedback while the app waits for the server, on every screen, without each button doing it:
// - a thin bar at the top of the page while a request the person started is running
//   (a tap or a key, or the page's first load; background refreshes stay quiet);
// - the tapped button shows a spinner and can't be tapped again until its requests finish.
// It watches requests to our API (AppSync /graphql and Lambda function URLs) only.

import { useEffect, useRef, useState } from "react";

const SHOW_AFTER = 250; // ms: quick answers never flash the bar
const TAP_WINDOW = 1500; // a request starting this soon after a tap or key shows the top bar
const BUTTON_WINDOW = 600; // only a request the tap itself starts puts a spinner on the button
//   (a background refresh, or the reload after a save, never lands on whatever was tapped last)
const LOAD_WINDOW = 8000; // and on the page's first load
const MAX_PENDING = 30_000; // never leave a button stuck

type Listener = (userRequests: number) => void;
const listeners = new Set<Listener>();
let installed = false;
let userInflight = 0;
let lastTapAt = -Infinity;
let lastTapEl: HTMLElement | null = null;
let startedAt = 0;
const pendingCount = new Map<HTMLElement, number>();

function isApi(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return /\/graphql(\?|$)|\.lambda-url\./.test(url);
}

function notify() {
  for (const l of listeners) l(userInflight);
}

function markPending(el: HTMLElement, delta: number) {
  const n = (pendingCount.get(el) ?? 0) + delta;
  if (n > 0) {
    pendingCount.set(el, n);
    el.setAttribute("data-pending", "");
  } else {
    pendingCount.delete(el);
    el.removeAttribute("data-pending");
  }
}

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  startedAt = performance.now();
  const onTap = (e: Event) => {
    lastTapAt = performance.now();
    const el = (e.target as Element | null)?.closest?.("button, [role='button'], a.btn");
    lastTapEl = el instanceof HTMLElement ? el : null;
  };
  // Capture phase: runs before the app's own click handler starts its request.
  document.addEventListener("click", onTap, true);
  document.addEventListener("keydown", () => (lastTapAt = performance.now()), true);

  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isApi(input)) return original(input, init);
    const now = performance.now();
    const byUser = now - lastTapAt < TAP_WINDOW || now - startedAt < LOAD_WINDOW || userInflight > 0;
    const button = now - lastTapAt < BUTTON_WINDOW && lastTapEl?.isConnected ? lastTapEl : null;
    if (byUser) {
      userInflight += 1;
      notify();
    }
    if (button) markPending(button, 1);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (byUser) {
        userInflight = Math.max(0, userInflight - 1);
        notify();
      }
      if (button) markPending(button, -1);
    };
    const guard = window.setTimeout(finish, MAX_PENDING);
    return original(input, init).finally(() => {
      window.clearTimeout(guard);
      finish();
    });
  };
}

export function ActivityIndicator() {
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    install();
    const onChange = (n: number) => {
      if (n > 0) {
        if (timer.current === undefined) timer.current = window.setTimeout(() => setShow(true), SHOW_AFTER);
      } else {
        window.clearTimeout(timer.current);
        timer.current = undefined;
        setShow(false);
      }
    };
    listeners.add(onChange);
    onChange(userInflight);
    return () => {
      listeners.delete(onChange);
      window.clearTimeout(timer.current);
    };
  }, []);

  return <div className={`activity-bar${show ? " is-on" : ""}`} role="progressbar" aria-label="جارٍ التحميل" aria-hidden={!show} />;
}
