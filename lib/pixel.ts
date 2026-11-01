// Meta Pixel (browser side). Sends shopping events to Meta so ads can find buyers.
//
// Off until site.metaPixelId is filled in. Only the live site sends events; the
// test copy sends them only after opening any page with ?pixeltest=1 (so test
// orders never pollute the real numbers). Never loaded on /admin.
//
// Meta does not accept Iraqi dinar for the pixel's value, so values are sent in
// US dollars at a fixed rate (site.pixelIqdPerUsd); the dinar amount goes along
// as a custom field (value_iqd).

import { getProduct } from "./products";
import { site } from "./site";

type Fbq = {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};
declare global {
  interface Window {
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export const toUsd = (iqd: number) => Math.round((iqd / site.pixelIqdPerUsd) * 100) / 100;

const TEST_KEY = "elue-pixeltest";

export function pixelEnabled(): boolean {
  if (typeof window === "undefined" || !site.metaPixelId) return false;
  if (window.location.pathname.startsWith("/admin")) return false;
  if (process.env.NEXT_PUBLIC_STAGE === "amplify") return true;
  try {
    return sessionStorage.getItem(TEST_KEY) === "1";
  } catch {
    return false;
  }
}

// ?pixeltest=1 turns the pixel on in this tab (for testing on the dev copy).
export function rememberPixelTest() {
  try {
    if (new URLSearchParams(window.location.search).get("pixeltest") === "1") sessionStorage.setItem(TEST_KEY, "1");
  } catch {}
}

// The standard Meta stub: calls made before fbevents.js loads are queued.
function ensureFbq(): Fbq {
  if (window.fbq) return window.fbq;
  const f: Fbq = function (...args: unknown[]) {
    if (f.callMethod) f.callMethod(...args);
    else (f.queue as unknown[][]).push(args);
  };
  f.push = f;
  f.loaded = true;
  f.version = "2.0";
  f.queue = [];
  window.fbq = f;
  if (!window._fbq) window._fbq = f;
  return f;
}

let started = false;

// Loads the pixel once. Returns false when it must stay off.
export function startPixel(): boolean {
  if (!pixelEnabled()) return false;
  if (started) return true;
  started = true;
  const fbq = ensureFbq();
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  fbq("init", site.metaPixelId);
  return true;
}

export function trackPixel(event: string, params?: Record<string, unknown>, eventId?: string) {
  if (!startPixel()) return;
  const fbq = ensureFbq();
  if (eventId) fbq("track", event, params ?? {}, { eventID: eventId });
  else fbq("track", event, params ?? {});
}

type Item = { slug: string; qty: number };

function contentsOf(items: Item[]) {
  return items.map((i) => ({ id: i.slug, quantity: i.qty, item_price: toUsd(getProduct(i.slug)?.price ?? 0) }));
}

function baseOf(items: Item[], totalIqd: number) {
  return {
    content_ids: items.map((i) => i.slug),
    content_type: "product",
    contents: contentsOf(items),
    num_items: items.reduce((n, i) => n + i.qty, 0),
    value: toUsd(totalIqd),
    currency: "USD",
    value_iqd: totalIqd,
  };
}

export function pixelViewContent(slug: string) {
  const p = getProduct(slug);
  if (!p) return;
  trackPixel("ViewContent", {
    content_ids: [slug],
    content_type: "product",
    content_name: p.nameEn,
    value: toUsd(p.price),
    currency: "USD",
    value_iqd: p.price,
  });
}

export function pixelAddToCart(slug: string, qty: number) {
  const p = getProduct(slug);
  if (!p) return;
  trackPixel("AddToCart", baseOf([{ slug, qty }], p.price * qty));
}

export function pixelInitiateCheckout(items: Item[], totalIqd: number) {
  trackPixel("InitiateCheckout", baseOf(items, totalIqd));
}

// eventId = the order number: the same id will be used by the server-side copy later, so Meta counts it once.
export function pixelPurchase(items: Item[], totalIqd: number, orderNumber: string) {
  trackPixel("Purchase", baseOf(items, totalIqd), orderNumber);
}
