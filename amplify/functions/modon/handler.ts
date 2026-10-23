import { setDefaultResultOrder } from "node:dns";
import { timingSafeEqual } from "node:crypto";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/modon";
import type { Schema } from "../../data/resource";
import { MODON_CITY, modonCollect, statusFromModon, type ModonRegion } from "../../../lib/modon";

// Modon Express integration.
//
// 1. From the admin (AppSync mutation `modon`, ADMINS only):
//    regions  – Modon's regions for a city (for the region picker)
//    send     – create the order at Modon. This is real: a driver comes to pick it up.
//    update   – send the order's current details to Modon (only before pickup)
//    delete   – delete it at Modon (only before pickup)
//    refresh  – read the latest Modon status (one order, or every open one)
// 2. From Modon (function URL): status-update webhook, checked by a secret header.
//
// Nothing here creates a Modon order except the "send" action.

setDefaultResultOrder("ipv4first");

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

const BASE = "https://mcht.modon-express.net/v1/merchant";
// Only production (the "amplify" branch) creates, edits or deletes real Modon
// orders. The dev copy reads Modon's regions but only pretends to send.
const PRODUCTION = process.env.STAGE === "amplify";
const WEBHOOK_HEADER = "x-elue-key";
const PACKAGE_SIZE = 1; // «عادي» (our box is about 20×30×20 cm)
const TYPE_NAME = "ترافل شوكولاتة ÉLUE";

type Order = Schema["Order"]["type"];
type ModonReply = { status?: boolean; errNum?: string | number; msg?: string; data?: unknown };

// ---- Modon API ---------------------------------------------------------------

let token = "";

async function call(path: string, init: RequestInit = {}): Promise<ModonReply> {
  const res = await fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(12_000) });
  const text = await res.text();
  try {
    return JSON.parse(text) as ModonReply;
  } catch {
    return { status: false, msg: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
}

async function login(): Promise<string> {
  const form = new FormData();
  form.append("username", env.MODON_USERNAME);
  form.append("password", env.MODON_PASSWORD);
  const reply = await call("/login", { method: "POST", body: form });
  const t = (reply.data as { token?: string } | undefined)?.token;
  if (!reply.status || !t) throw new Error(`modon_login:${reply.msg ?? "failed"}`);
  token = t;
  return t;
}

// Calls with the login token; logs in again once if the token was refused.
async function authed(path: string, init: RequestInit = {}, form?: () => FormData): Promise<ModonReply> {
  const go = async () => {
    const sep = path.includes("?") ? "&" : "?";
    return call(`${path}${sep}token=${encodeURIComponent(token || (await login()))}`, {
      ...init,
      ...(form ? { body: form() } : {}),
    });
  };
  let reply = await go();
  if (!reply.status && /token|توكن|تسجيل الدخول|صلاحية/i.test(String(reply.msg ?? ""))) {
    await login();
    reply = await go();
  }
  return reply;
}

function fail(reply: ModonReply, what: string): never {
  throw new Error(`modon_${what}:${reply.msg ?? "failed"}`);
}

const regionCache = new Map<number, ModonRegion[]>();

async function regions(cityId: number): Promise<ModonRegion[]> {
  const cached = regionCache.get(cityId);
  if (cached) return cached;
  const reply = await authed(`/regions?city_id=${cityId}`);
  if (!reply.status || !Array.isArray(reply.data)) fail(reply, "regions");
  const list = (reply.data as { id: string | number; region_name: string }[]).map((r) => ({
    id: Number(r.id),
    name: String(r.region_name).trim(),
  }));
  regionCache.set(cityId, list);
  return list;
}

// The order's details in Modon's create/edit form.
function orderForm(o: Order, regionId: number, qr?: string): FormData {
  const cityId = MODON_CITY[o.province ?? ""];
  if (!cityId) throw new Error("modon_city:لا توجد مدينة مطابقة لدى مدن لهذه المحافظة.");
  const form = new FormData();
  if (qr) form.append("qr_id", qr);
  form.append("client_name", o.name);
  form.append("client_mobile", `+${o.phone}`);
  form.append("city_id", String(cityId));
  form.append("region_id", String(regionId));
  form.append("location", [o.area, o.address].filter(Boolean).join(" - ") || o.area || o.province || "-");
  form.append("type_name", TYPE_NAME);
  form.append("items_number", String(o.jars));
  form.append("price", String(modonCollect(o.total)));
  form.append("package_size", String(PACKAGE_SIZE));
  form.append("merchant_notes", [o.orderNumber, o.note].filter(Boolean).join(" — ").slice(0, 400));
  form.append("replacement", "0");
  return form;
}

// ---- Orders -----------------------------------------------------------------

async function getOrder(id: string | null | undefined): Promise<Order> {
  if (!id) throw new Error("missing_order");
  const { data } = await client.models.Order.get({ id });
  if (!data) throw new Error("order_not_found");
  return data;
}

type ModonOrder = {
  id?: string | number;
  qr_id?: string | number;
  status_id?: string | number;
  status?: string;
  deliver_done?: string | number;
  issue_notes?: string | null;
  delivery_price?: string | number | null;
  price?: string | number | null;
};

// Saves a Modon status on our order (webhook, refresh).
async function applyStatus(m: ModonOrder): Promise<string | null> {
  const modonId = String(m.id ?? "");
  if (!modonId) return null;
  const { data } = await client.models.Order.listOrderByModonId({ modonId }, { limit: 1 });
  const o = data?.[0];
  if (!o) return null;
  const next = statusFromModon(m);
  const keep = o.status === "CANCELLED" || o.status === "DELIVERED";
  await client.models.Order.update({
    id: o.id,
    modonStatusId: m.status_id != null ? String(m.status_id) : o.modonStatusId,
    modonStatus: m.status ?? o.modonStatus,
    modonNote: m.issue_notes || null,
    modonFee: m.delivery_price != null && m.delivery_price !== "" ? Number(m.delivery_price) : o.modonFee,
    modonUpdatedAt: new Date().toISOString(),
    ...(next && !keep && next !== o.status ? { status: next } : {}),
  });
  return o.orderNumber;
}

async function refresh(orderId?: string | null): Promise<{ updated: string[] }> {
  let ids: string[];
  if (orderId) {
    const o = await getOrder(orderId);
    ids = o.modonId ? [o.modonId] : [];
  } else {
    // Every order at Modon that isn't finished yet.
    ids = [];
    let nextToken: string | null | undefined;
    do {
      const res = await client.models.Order.list({
        filter: { modonId: { attributeExists: true }, status: { ne: "DELIVERED" } },
        limit: 500,
        nextToken,
      });
      for (const o of res.data) if (o.modonId && o.status !== "CANCELLED") ids.push(o.modonId);
      nextToken = res.nextToken;
    } while (nextToken);
  }
  const updated: string[] = [];
  for (let i = 0; i < ids.length; i += 25) {
    const batch = ids.slice(i, i + 25);
    const reply = await authed("/get-orders-by-ids-bulk", { method: "POST" }, () => {
      const f = new FormData();
      f.append("ids", batch.join(","));
      return f;
    });
    if (!reply.status) fail(reply, "refresh");
    for (const m of (Array.isArray(reply.data) ? reply.data : []) as ModonOrder[]) {
      const n = await applyStatus(m);
      if (n) updated.push(n);
    }
  }
  return { updated };
}

// ---- Admin actions ----------------------------------------------------------

async function adminAction(args: {
  action: string;
  orderId?: string | null;
  cityId?: number | null;
  regionId?: number | null;
  regionName?: string | null;
}): Promise<unknown> {
  switch (args.action) {
    case "regions": {
      const cityId = Number(args.cityId);
      if (!cityId) throw new Error("missing_city");
      return { regions: await regions(cityId) };
    }

    case "send": {
      const o = await getOrder(args.orderId);
      if (o.modonId) throw new Error(`already_sent:${o.modonQr ?? o.modonId}`);
      if (o.status === "CANCELLED") throw new Error("cancelled");
      const regionId = Number(args.regionId);
      if (!regionId) throw new Error("missing_region");
      const reply: ModonReply = PRODUCTION
        ? await authed("/create-order", { method: "POST" }, () => orderForm(o, regionId))
        : { status: true, data: { id: `DEV${Date.now()}`, qr_id: `DEV-${Date.now()}`, qr_link: null, company_price: 5000 } };
      if (!reply.status) fail(reply, "send");
      const d = (Array.isArray(reply.data) ? reply.data[0] : reply.data) as Record<string, unknown>;
      const now = new Date().toISOString();
      await client.models.Order.update({
        id: o.id,
        modonId: String(d?.id ?? d?.qr_id ?? ""),
        modonQr: String(d?.qr_id ?? d?.id ?? ""),
        modonLink: d?.qr_link ? String(d.qr_link) : null,
        modonPrice: Number(d?.price ?? modonCollect(o.total)),
        modonFee: d?.company_price != null ? Number(d.company_price) : null,
        modonStatusId: "1",
        modonStatus: "طلب جديد لدى مدن",
        modonNote: null,
        modonRegionId: regionId,
        modonRegionName: args.regionName ?? null,
        modonSentAt: now,
        modonUpdatedAt: now,
        ...(o.status === "NEW" ? { status: "CONFIRMED" as const } : {}),
      });
      return { ok: true, qr: d?.qr_id ?? d?.id, link: d?.qr_link ?? null, fee: d?.company_price ?? null };
    }

    case "update": {
      const o = await getOrder(args.orderId);
      if (!o.modonQr || !o.modonRegionId) throw new Error("not_sent");
      const regionId = Number(args.regionId) || o.modonRegionId;
      const reply: ModonReply = PRODUCTION
        ? await authed("/edit-order", { method: "POST" }, () => orderForm(o, regionId, o.modonQr!))
        : { status: true };
      if (!reply.status) fail(reply, "update");
      await client.models.Order.update({
        id: o.id,
        modonPrice: modonCollect(o.total),
        modonRegionId: regionId,
        ...(args.regionName ? { modonRegionName: args.regionName } : {}),
        modonUpdatedAt: new Date().toISOString(),
      });
      return { ok: true };
    }

    case "delete": {
      const o = await getOrder(args.orderId);
      if (!o.modonQr) throw new Error("not_sent");
      const reply: ModonReply = PRODUCTION
        ? await authed("/delete-orders", { method: "POST" }, () => {
            const f = new FormData();
            f.append("qr_id", o.modonQr!);
            return f;
          })
        : { status: true };
      if (!reply.status) fail(reply, "delete");
      await client.models.Order.update({
        id: o.id,
        modonId: null,
        modonQr: null,
        modonLink: null,
        modonPrice: null,
        modonFee: null,
        modonStatusId: null,
        modonStatus: null,
        modonNote: null,
        modonSentAt: null,
        modonUpdatedAt: new Date().toISOString(),
      });
      return { ok: true };
    }

    case "refresh":
      return PRODUCTION ? refresh(args.orderId) : { updated: [] };

    default:
      throw new Error("unknown_action");
  }
}

// ---- Webhook ----------------------------------------------------------------

type UrlEvent = {
  requestContext: { http: { method: string } };
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
};

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function webhook(event: UrlEvent) {
  const reply = (statusCode: number, body: unknown) => ({
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (event.requestContext.http.method !== "POST") return reply(405, { ok: false });
  const key = event.headers?.[WEBHOOK_HEADER] ?? "";
  if (!env.MODON_WEBHOOK_KEY || !sameSecret(key, env.MODON_WEBHOOK_KEY)) return reply(401, { ok: false });

  let payload: unknown;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    payload = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false });
  }
  // One order, or a list / {data: …} wrapper.
  const wrapped = (payload as { data?: unknown })?.data ?? payload;
  const list = (Array.isArray(wrapped) ? wrapped : [wrapped]) as ModonOrder[];
  console.log("modon webhook", JSON.stringify(list).slice(0, 2000));
  const updated: string[] = [];
  for (const m of list) {
    const n = await applyStatus(m);
    if (n) updated.push(n);
  }
  return reply(200, { ok: true, updated });
}

// ---- Entry ------------------------------------------------------------------

export const handler = async (event: unknown) => {
  if ((event as UrlEvent)?.requestContext?.http) return webhook(event as UrlEvent);
  const e = event as { arguments: Parameters<typeof adminAction>[0] };
  return adminAction(e.arguments);
};
