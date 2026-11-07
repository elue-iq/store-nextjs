import { setDefaultResultOrder } from "node:dns";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/boxy";
import type { Schema } from "../../data/resource";
import { BOXY_PROVINCE, boxyCollect, boxyProducts, boxyTrack, statusFromBoxy, type BoxyRegion } from "../../../lib/boxy";
import { parseTrackEvents, type TrackEvent } from "../../../lib/modon";
import { site } from "../../../lib/site";
import { timingSafeEqual } from "node:crypto";

// Boxy integration (mirrors the Modon one).
//
// From the admin (AppSync mutation `boxy`, ADMINS only):
//   regions – Boxy's areas for a province (for the area picker)
//   send    – create the order at Boxy. Real: a driver comes to pick it up.
//   update  – send the order's current details to Boxy (only before pickup)
//   cancel  – cancel it at Boxy (only before pickup)
//   refresh – read the latest Boxy status (one order, or every open one)
//   label   – the pick-up label (PDF)
// Every 10 minutes the open orders are refreshed. If an order was cancelled / deleted at
// Boxy's side, the Boxy fields on our order are cleared so it shows as «not sent» again.
// Only production (the "amplify" branch) creates, edits or cancels real Boxy orders;
// the dev copy reads areas and statuses but only pretends to send.

setDefaultResultOrder("ipv4first");

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

const PRODUCTION = process.env.STAGE === "amplify";
const SIZE = "S"; // «صغير» in the Boxy form
const FALLBACK_EMAIL = "orders@elue-iq.com"; // Boxy asks for an email; customers don't give one

type Order = Schema["Order"]["type"];
type Reply = { status?: string; code?: number; message?: string; object?: unknown };

// ---- Boxy API -------------------------------------------------------------------

const base = () => `${String(env.BOXY_API_HOST).replace(/\/+$/, "")}/api/v1/merchants`;

async function call(path: string, init: RequestInit = {}): Promise<{ ok: boolean; http: number; reply: Reply; raw: Response }> {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      "api-key": env.BOXY_API_KEY,
      "api-secret": env.BOXY_API_SECRET,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const clone = res.clone();
  const text = await res.text().catch(() => "");
  let reply: Reply = {};
  try {
    reply = JSON.parse(text) as Reply;
  } catch {
    reply = { message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: res.ok && (reply.status ?? "success") === "success", http: res.status, reply, raw: clone };
}

function fail(r: { http: number; reply: Reply }, what: string): never {
  const msg = String(r.reply.message ?? `HTTP ${r.http}`).slice(0, 300);
  throw new Error(`boxy_${what}:${msg}`);
}

type RegionRow = { uid: string; province_code: string; area_name: string; zaeem_area_id: number };
let regionRows: RegionRow[] | null = null;

async function allRegions(): Promise<RegionRow[]> {
  if (regionRows) return regionRows;
  const r = await call("/regions/provinces");
  if (!r.ok || !Array.isArray(r.reply.object)) fail(r, "regions");
  regionRows = r.reply.object as RegionRow[];
  return regionRows;
}

async function regions(province: string): Promise<BoxyRegion[]> {
  const code = BOXY_PROVINCE[province];
  if (!code) throw new Error("boxy_province:لا توجد محافظة مطابقة لدى بوكسي.");
  return (await allRegions())
    .filter((r) => r.province_code === code)
    .map((r) => ({ id: Number(r.zaeem_area_id), name: String(r.area_name).trim() }));
}

// The order in Boxy's create / edit form.
function orderBody(o: Order, regionName: string): Record<string, unknown> {
  const code = BOXY_PROVINCE[o.province ?? ""];
  if (!code) throw new Error("boxy_province:لا توجد محافظة مطابقة لدى بوكسي.");
  return {
    is_fragile: true, // «قابل للكسر»
    temperature_control: true, // «نقل مبرد» (field name as Boxy returns it in order webhooks)
    ready_to_pick_up: false,
    shipment_fee_type: "BY_MERCHANT",
    payment_type: "COLLECT_ON_DELIVERY",
    pick_up_type: "PICK_UP",
    description: "", // notes stay empty: the order number is already in custom_id
    custom_id: o.orderNumber,
    products: boxyProducts(o as Parameters<typeof boxyProducts>[0]),
    saved_pick_up_address_uid: env.BOXY_PICKUP_UID,
    size: SIZE,
    contact: {
      full_name: o.name,
      address_text: [o.province, o.area, o.address].filter(Boolean).join(" - ").slice(0, 250),
      phone: o.phone,
      secondary_phone: null,
      email: FALLBACK_EMAIL,
      region_name: regionName,
      province_code: code,
    },
  };
}

// ---- Orders ---------------------------------------------------------------------

async function getOrder(id: string | null | undefined): Promise<Order> {
  if (!id) throw new Error("missing_order");
  const { data } = await client.models.Order.get({ id });
  if (!data) throw new Error("order_not_found");
  return data;
}

type BoxyOrder = {
  uid?: string;
  platform_code?: string;
  fee?: number | null;
  deleted_at?: string | null;
  updated_at?: string | null;
  tracking_page?: string | null;
  tracking_auth_page?: string | null;
  exception_comment?: string | null;
  merchant_action_required_merchant_text?: string | null;
  status?: { title?: string; slug?: string; merchant_title?: string } | null;
  statuses?: { slug?: string; created_at?: string; pivot?: { created_at?: string } }[] | null;
};

const slugOf = (b: BoxyOrder) => String(b.status?.slug ?? "").toLowerCase();
const cancelledAtBoxy = (b: BoxyOrder) => Boolean(b.deleted_at) || /cancel|delet/i.test(slugOf(b));

// Clears every Boxy field so the order counts as «not sent» and can be sent again.
async function releaseBoxy(o: Order, why: string): Promise<void> {
  console.log("boxy order gone, releasing", o.orderNumber, o.boxyUid, why);
  const { errors } = await client.models.Order.update({
    id: o.id,
    boxyUid: null,
    boxyCode: null,
    boxyLink: null,
    boxyFee: null,
    boxyStatus: null,
    boxyStatusTitle: null,
    boxyNote: null,
    boxySentAt: null,
    boxyUpdatedAt: new Date().toISOString(),
    trackStatus: null,
    trackEta: null,
    trackEvents: null,
  });
  if (errors?.length) {
    console.error("releasing the Boxy order failed", o.orderNumber, JSON.stringify(errors).slice(0, 600));
    throw new Error("save_failed");
  }
}

async function fetchBoxy(uid: string): Promise<BoxyOrder | "gone"> {
  const r = await call(`/orders/${encodeURIComponent(uid)}`);
  if (r.http === 404) return "gone";
  if (!r.ok || !r.reply.object) fail(r, "check");
  return r.reply.object as BoxyOrder;
}

// Saves a Boxy status on our order.
async function applyStatus(o: Order, b: BoxyOrder): Promise<"updated" | "released"> {
  if (o.status !== "DELIVERED" && cancelledAtBoxy(b)) {
    await releaseBoxy(o, slugOf(b) || "cancelled");
    return "released";
  }
  const slug = slugOf(b);
  const next = statusFromBoxy(slug);
  const keep = o.status === "CANCELLED" || o.status === "DELIVERED";
  const line = boxyTrack(slug);
  const events = parseTrackEvents(o.trackEvents);
  let trackEvents: TrackEvent[] | undefined;
  if (line && events[events.length - 1]?.text !== line) {
    trackEvents = [...events, { at: b.updated_at ? new Date(b.updated_at).toISOString() : new Date().toISOString(), text: line }].slice(-30);
  }
  const { errors } = await client.models.Order.update({
    id: o.id,
    ...(line ? { trackStatus: line } : {}),
    ...(trackEvents ? { trackEvents: JSON.stringify(trackEvents) } : {}),
    boxyStatus: slug || o.boxyStatus,
    boxyStatusTitle: b.status?.merchant_title || b.status?.title || o.boxyStatusTitle,
    boxyNote: b.exception_comment || b.merchant_action_required_merchant_text || null,
    boxyFee: b.fee != null ? Number(b.fee) : o.boxyFee,
    boxyLink: b.tracking_page ?? o.boxyLink,
    boxyUpdatedAt: new Date().toISOString(),
    ...(next && !keep && next !== o.status ? { status: next } : {}),
  });
  if (errors?.length) {
    console.error("saving the Boxy status failed", o.orderNumber, JSON.stringify(errors).slice(0, 600));
    throw new Error("save_failed");
  }
  return "updated";
}

async function refresh(orderId?: string | null): Promise<{ updated: string[]; released: string[] }> {
  const orders: Order[] = [];
  if (orderId) {
    const o = await getOrder(orderId);
    if (o.boxyUid) orders.push(o);
  } else {
    let nextToken: string | null | undefined;
    do {
      const res = await client.models.Order.list({
        filter: { boxyUid: { attributeExists: true }, status: { ne: "DELIVERED" } },
        limit: 500,
        nextToken,
      });
      for (const o of res.data) if (o.boxyUid && o.status !== "CANCELLED") orders.push(o);
      nextToken = res.nextToken;
    } while (nextToken);
  }
  const updated: string[] = [];
  const released: string[] = [];
  for (let i = 0; i < orders.length; i += 5) {
    await Promise.all(
      orders.slice(i, i + 5).map(async (o) => {
        try {
          const b = await fetchBoxy(o.boxyUid!);
          if (b === "gone") {
            await releaseBoxy(o, "missing from Boxy");
            released.push(o.orderNumber);
          } else {
            (await applyStatus(o, b)) === "released" ? released.push(o.orderNumber) : updated.push(o.orderNumber);
          }
        } catch (err) {
          console.error("boxy refresh failed for", o.orderNumber, err);
        }
      }),
    );
  }
  return { updated, released };
}

async function createAtBoxy(o: Order, regionName: string, regionId?: number | null) {
  let uid = `DEV${Date.now()}`;
  let code = `DEV-BXO-${Date.now()}`;
  let fee: number | null = null;
  let track: string | null = null;
  if (PRODUCTION) {
    const r = await call("/orders/request", { method: "POST", body: JSON.stringify(orderBody(o, regionName)) });
    if (!r.ok) fail(r, "send");
    const order = ((r.reply.object as { order?: BoxyOrder } | undefined)?.order ?? {}) as BoxyOrder;
    if (!order.uid) fail(r, "send");
    uid = order.uid!;
    code = order.platform_code ?? uid;
    fee = order.fee != null ? Number(order.fee) : null;
    track = order.tracking_page ?? null;
  }
  const now = new Date().toISOString();
  await client.models.Order.update({
    id: o.id,
    boxyUid: uid,
    boxyCode: code,
    boxyLink: track,
    boxyFee: fee,
    boxyStatus: "new",
    boxyStatusTitle: "طلب جديد لدى بوكسي",
    boxyNote: null,
    boxyRegionId: regionId ?? null,
    boxyRegionName: regionName,
    boxySentAt: now,
    boxyUpdatedAt: now,
    trackStatus: boxyTrack("new"),
    trackEvents: JSON.stringify([{ at: now, text: boxyTrack("new")! }]),
    trackEta: null,
    ...(o.status === "NEW" ? { status: "CONFIRMED" as const } : {}),
  });
  return { ok: true, code, link: track, fee, collect: boxyCollect(o as Parameters<typeof boxyCollect>[0]) };
}

// ---- Admin actions --------------------------------------------------------------

async function adminAction(args: {
  action: string;
  orderId?: string | null;
  province?: string | null;
  regionId?: number | null;
  regionName?: string | null;
}): Promise<unknown> {
  switch (args.action) {
    case "regions":
      return { regions: await regions(String(args.province ?? "")) };

    // Saved pick-up addresses on the Boxy account (to find BOXY_PICKUP_UID).
    case "pickups": {
      const r = await call("/saved-pick-up-addresses");
      if (!r.ok) fail(r, "pickups");
      const items = ((r.reply.object as { items?: Array<Record<string, unknown>> })?.items ?? []).map((p) => ({
        uid: p.uid,
        title: p.title,
        default: p.default,
        address: p.address_text,
      }));
      return { pickups: items };
    }

    case "send": {
      let o = await getOrder(args.orderId);
      if (o.status === "CANCELLED") throw new Error("cancelled");
      if (o.boxyUid) {
        if (!PRODUCTION) throw new Error(`already_sent:${o.boxyCode ?? o.boxyUid}`);
        const b = await fetchBoxy(o.boxyUid);
        if (b !== "gone" && !cancelledAtBoxy(b)) throw new Error(`already_sent:${o.boxyCode ?? o.boxyUid}`);
        await releaseBoxy(o, "send: gone at Boxy");
        o = await getOrder(o.id);
      }
      const name = String(args.regionName ?? "").trim();
      if (!name) throw new Error("missing_region");
      return createAtBoxy(o, name, args.regionId);
    }

    case "update": {
      let o = await getOrder(args.orderId);
      if (!o.boxyUid) throw new Error("not_sent");
      const name = String(args.regionName ?? o.boxyRegionName ?? "").trim();
      if (!name) throw new Error("missing_region");
      if (PRODUCTION) {
        const b = await fetchBoxy(o.boxyUid);
        if (b === "gone" || cancelledAtBoxy(b)) {
          await releaseBoxy(o, "update: gone at Boxy");
          o = await getOrder(o.id);
          return { ...(await createAtBoxy(o, name, args.regionId)), recreated: true };
        }
        const r = await call(`/orders/${encodeURIComponent(o.boxyUid)}`, { method: "PATCH", body: JSON.stringify(orderBody(o, name)) });
        if (!r.ok) fail(r, "update");
      }
      await client.models.Order.update({
        id: o.id,
        boxyRegionName: name,
        ...(args.regionId ? { boxyRegionId: args.regionId } : {}),
        boxyUpdatedAt: new Date().toISOString(),
      });
      return { ok: true };
    }

    case "cancel": {
      const o = await getOrder(args.orderId);
      if (!o.boxyUid) throw new Error("not_sent");
      if (PRODUCTION) {
        const r = await call(`/orders/${encodeURIComponent(o.boxyUid)}/cancel`, { method: "POST" });
        // Already gone at Boxy is fine: the goal (not at Boxy) is met.
        if (!r.ok && r.http !== 404) {
          const b = await fetchBoxy(o.boxyUid);
          if (b !== "gone" && !cancelledAtBoxy(b)) fail(r, "cancel");
        }
      }
      await releaseBoxy(o, "cancelled from the admin");
      return { ok: true };
    }

    case "label": {
      const o = await getOrder(args.orderId);
      if (!o.boxyUid) throw new Error("not_sent");
      if (!PRODUCTION) throw new Error("boxy_label:الملصق متاح في الموقع الفعلي فقط.");
      const r = await call(`/orders/${encodeURIComponent(o.boxyUid)}/pick-up-labels`, { headers: { Accept: "application/pdf, application/json" } });
      const type = r.raw.headers.get("content-type") ?? "";
      if (type.includes("pdf")) {
        const buf = Buffer.from(await r.raw.arrayBuffer());
        return { pdf: buf.toString("base64") };
      }
      if (!r.ok) fail(r, "label");
      return { raw: JSON.stringify(r.reply.object ?? r.reply).slice(0, 2000) };
    }

    case "refresh":
      return refresh(args.orderId);

    default:
      throw new Error("unknown_action");
  }
}

// ---- Entry ----------------------------------------------------------------------

// ---- Webhook (Boxy's notifications) ------------------------------------------------

type UrlEvent = {
  requestContext: { http: { method: string } };
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
};

const WEBHOOK_HEADER = "x-elue-key";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Boxy's payload shape isn't fixed for us, so look for the fields we need anywhere in it.
function findText(v: unknown, keys: string[], depth = 0): string | null {
  if (!v || typeof v !== "object" || depth > 5) return null;
  const rec = v as Record<string, unknown>;
  for (const k of keys) {
    const x = rec[k];
    if (typeof x === "string" && x.trim()) return x.trim();
    if (typeof x === "number") return String(x);
  }
  for (const x of Object.values(rec)) {
    const f = findText(x, keys, depth + 1);
    if (f) return f;
  }
  return null;
}

async function webhook(event: UrlEvent) {
  const reply = (statusCode: number, body: unknown) => ({
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (event.requestContext.http.method !== "POST") return reply(405, { ok: false });
  const key = event.headers?.[WEBHOOK_HEADER] ?? "";
  if (!env.BOXY_WEBHOOK_KEY || !sameSecret(key, env.BOXY_WEBHOOK_KEY)) return reply(401, { ok: false });

  const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = { text: raw.slice(0, 500) };
  }
  console.log("boxy webhook", raw.slice(0, 2000));

  const uid = findText(payload, ["order_uid", "uid"]);
  const code = findText(payload, ["platform_code", "code", "tracking_code"]);
  const custom = findText(payload, ["custom_id", "merchant_order_id"]);
  const kind = findText(payload, ["event", "event_type", "trigger", "type", "topic", "name"]);
  const title = findText(payload, ["merchant_title", "title", "message", "text", "comment", "exception_comment", "description"]);
  const detail = findText(payload, ["exception_comment", "merchant_action_required_merchant_text", "comment", "message", "description"]);

  // Find our order from whatever identifier came.
  let order: Order | null = null;
  const or = [
    ...(uid ? [{ boxyUid: { eq: uid } }] : []),
    ...(code ? [{ boxyCode: { eq: code } }] : []),
    ...(custom ? [{ orderNumber: { eq: custom } }] : []),
  ];
  if (or.length) {
    const { data } = await client.models.Order.list({ filter: { or }, limit: 5 });
    order = data[0] ?? null;
  }

  const now = new Date().toISOString();
  let statusTitle: string | null = null;
  if (order?.boxyUid) {
    try {
      const b = await fetchBoxy(order.boxyUid);
      if (b !== "gone") {
        statusTitle = b.status?.merchant_title || b.status?.title || null;
        await applyStatus(order, b);
      }
    } catch (err) {
      console.error("boxy webhook refresh failed", order.orderNumber, err);
    }
  }

  const eventTitle = [statusTitle, title].filter((x, i, a) => x && a.indexOf(x) === i).join(" — ") || kind || "إشعار من بوكسي";
  await client.models.BoxyEvent.create({
    at: now,
    kind: kind ?? undefined,
    orderNumber: order?.orderNumber ?? custom ?? undefined,
    boxyCode: code ?? order?.boxyCode ?? undefined,
    title: eventTitle.slice(0, 300),
    detail: detail?.slice(0, 600) ?? undefined,
    raw: raw.slice(0, 3500),
  });
  if (order) {
    // Re-read: applyStatus may have just saved the order.
    const fresh = (await client.models.Order.get({ id: order.id })).data ?? order;
    const prev = Array.isArray(fresh.boxyEvents) ? (fresh.boxyEvents as { at: string; text: string }[]) : [];
    await client.models.Order.update({
      id: order.id,
      boxyEvents: [...prev, { at: now, text: eventTitle.slice(0, 300) }].slice(-40),
    });
  }
  return reply(200, { ok: true, matched: Boolean(order) });
}

export const handler = async (event: unknown) => {
  if ((event as UrlEvent)?.requestContext?.http) return webhook(event as UrlEvent);
  // Every 10 minutes: pull the latest status of every open Boxy order.
  // EventBridge Scheduler sends no fixed shape (an empty event), so: not the admin's call (arguments) = the schedule.
  if (!(event as { arguments?: unknown })?.arguments) {
    if (!PRODUCTION) return { skipped: "dev" };
    try {
      return await refresh();
    } catch (err) {
      console.error("scheduled boxy refresh failed", err);
      return { failed: true };
    }
  }
  return adminAction((event as { arguments: Parameters<typeof adminAction>[0] }).arguments);
};
