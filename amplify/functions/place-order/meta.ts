// Meta Conversions API (server side): reports a website purchase to the ÉLUE dataset.
// The same purchase is also reported by the browser pixel; both carry event_id = the order
// number, so Meta counts them once (deduplication).
//
// The access token is a secret: it is read at runtime from Amplify's secret store
// (/amplify/shared/<app id>/META_CAPI_TOKEN), never from code. Without it, nothing is sent.
// Nothing here may break an order: every failure is logged (never the token) and ignored.

import { createHash } from "node:crypto";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { site } from "../../../lib/site";

const GRAPH = "https://graph.facebook.com/v26.0";
const TIMEOUT_MS = 4000;

export type Tracking = {
  fbp?: string;
  fbc?: string;
  ip?: string;
  ua?: string;
  url?: string;
  testCode?: string; // Events Manager > Test events code, honored on the test copy only
};

export type CapiOrder = {
  orderNumber: string;
  phone: string; // 9647XXXXXXXXX
  name: string;
  province?: string | null;
  items: ({ slug: string; qty: number; price: number; gift?: boolean | null } | null)[]; // gift jars: price 0
  jars: number; // paid jars
  total: number; // paid jars after any discount (gift jars add nothing)
  freeDelivery?: boolean | null;
};

const sha = (v: string) => createHash("sha256").update(v).digest("hex");

// Meta wants lowercase, trimmed values before hashing; phone as digits with the country code.
export const hashPhone = (phone: string) => sha(phone.replace(/\D/g, ""));
export const hashName = (name: string) => sha((name.trim().split(/\s+/)[0] ?? "").toLowerCase());
export const hashCity = (city: string) => sha(city.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));

const usd = (iqd: number) => Math.round((iqd / site.pixelIqdPerUsd) * 100) / 100;

// What the customer is charged: jars (after any discount) + the delivery fee unless it is free.
export const chargedIqd = (o: Pick<CapiOrder, "total" | "freeDelivery">) => o.total + (o.freeDelivery ? 0 : site.deliveryFee);

export function purchaseEvent(o: CapiOrder, t: Tracking, atMs: number) {
  const items = o.items.filter((i): i is NonNullable<typeof i> => Boolean(i));
  const user: Record<string, unknown> = {
    ph: [hashPhone(o.phone)],
    external_id: [hashPhone(o.phone)],
    country: [sha("iq")],
  };
  if (o.name.trim()) user.fn = [hashName(o.name)];
  if (o.province?.trim()) user.ct = [hashCity(o.province)];
  if (t.ip) user.client_ip_address = t.ip;
  if (t.ua) user.client_user_agent = t.ua;
  if (t.fbp) user.fbp = t.fbp;
  if (t.fbc) user.fbc = t.fbc;
  const charged = chargedIqd(o);
  return {
    event_name: "Purchase",
    event_time: Math.floor(atMs / 1000),
    event_id: o.orderNumber,
    event_source_url: t.url || site.address,
    action_source: "website",
    user_data: user,
    custom_data: {
      value: usd(charged),
      currency: "USD", // Meta takes no Iraqi dinar here: dollars at a fixed rate, dinars alongside
      value_iqd: charged,
      order_id: o.orderNumber,
      content_type: "product",
      content_ids: items.map((i) => i.slug),
      contents: items.map((i) => ({ id: i.slug, quantity: i.qty, item_price: i.gift ? 0 : usd(i.price) })),
      num_items: items.reduce((n, i) => n + i.qty, 0),
    },
  };
}

// The first address of x-forwarded-for is the visitor's.
export function clientIp(headers: Record<string, string | undefined> | undefined): string | undefined {
  const raw = headers?.["x-forwarded-for"] ?? headers?.["X-Forwarded-For"] ?? "";
  const first = raw.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : undefined;
}

// The browser's tracking details, cleaned (they come from the customer's device: never trusted).
export function cleanTracking(raw: unknown, headers: Record<string, string | undefined> | undefined, production: boolean): Tracking {
  let t: Record<string, unknown> = {};
  try {
    t = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {}
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  const out: Tracking = {
    fbp: str(t.fbp, 120),
    fbc: str(t.fbc, 400),
    ua: str(t.ua, 300) ?? str(headers?.["user-agent"], 300),
    url: str(t.url, 300),
    ip: clientIp(headers),
  };
  const code = str(t.testCode, 20);
  if (!production && code && /^TEST\d{3,10}$/.test(code)) out.testCode = code;
  return out;
}

let tokenCache: { value: string | null; at: number } | null = null;

async function accessToken(): Promise<string | null> {
  if (tokenCache && Date.now() - tokenCache.at < 5 * 60_000) return tokenCache.value;
  // The secret's name: Amplify already hands this function the shared secret path
  // (/amplify/shared/<app id>/...) in AMPLIFY_SSM_ENV_CONFIG. A dedicated env var would push the
  // function past Lambda's 4 KB limit on the live branch.
  const prefix = (process.env.AMPLIFY_SSM_ENV_CONFIG ?? "").match(/\/amplify\/shared\/[A-Za-z0-9]+\//)?.[0];
  const name = prefix ? `${prefix}META_CAPI_TOKEN` : undefined;
  let value: string | null = null;
  if (name) {
    try {
      const r = await new SSMClient({}).send(new GetParameterCommand({ Name: name, WithDecryption: true }));
      value = r.Parameter?.Value?.trim() || null;
    } catch (err) {
      // ParameterNotFound = the founder has not set the token yet: not an error.
      if ((err as { name?: string }).name !== "ParameterNotFound") console.error("meta capi: token read failed", (err as Error).message);
    }
  }
  tokenCache = { value, at: Date.now() };
  return value;
}

// Sends the purchase. Never throws, never waits more than a few seconds.
// production: the live site. The test copy sends only when a Test events code came along.
export async function sendPurchase(o: CapiOrder, t: Tracking, opts: { production: boolean; atMs?: number }): Promise<void> {
  try {
    if (!site.metaPixelId) return;
    if (!opts.production && !t.testCode) return;
    const token = await accessToken();
    if (!token) {
      console.log("meta capi: no access token set, purchase not sent", o.orderNumber);
      return;
    }
    const event = purchaseEvent(o, t, opts.atMs ?? Date.now());
    const body: Record<string, unknown> = { data: [event], access_token: token };
    if (t.testCode) {
      body.test_event_code = t.testCode;
      // Test events only: the exact payload (hashes included, never the token) for the marketer to check.
      console.log("meta capi: payload", o.orderNumber, JSON.stringify({ data: [event], test_event_code: t.testCode }));
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${GRAPH}/${site.metaPixelId}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      const text = await res.text();
      if (!res.ok) console.error("meta capi: rejected", res.status, text.slice(0, 400).replace(token, "***"));
      else console.log("meta capi: purchase sent", o.orderNumber, text.slice(0, 120));
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error("meta capi: send failed", o.orderNumber, (err as Error).message);
  }
}
