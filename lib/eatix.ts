// Eatix (cashier + payment gateway) — shared by the placeOrder and eatix functions.
// Plain TypeScript with relative imports only, so it bundles into a function.
//
// ÉLUE stays the source of truth. Eatix gets a COPY of every order so it shows
// on the cashier device and in their accounting. A failure here never blocks
// an order: it is recorded on the order (eatixStatus FAILED) and can be retried.
//
// Everything marked CONFIRM is an assumption from the Eatix docs, which leave
// those values undefined. Sending is OFF (EATIX_ENABLED != "true") until Eatix
// has confirmed them and the channel / item ids are in place.

export const EATIX_BASE = "https://gateway.eatix.iq";

// CONFIRM with Eatix: the amount unit for IQD. 1 = whole dinars (15,000 IQD -> 15000).
export const AMOUNT_FACTOR = 1;
// CONFIRM with Eatix: values the docs list without meaning.
export const EATIX_DEFAULTS = {
  orderFrom: 0,
  bizType: 0,
  orderType: 0,
  orderStatus: 1, // 1 = "To be accepted" (their status list)
  deliveryType: 1,
  deliveryStatus: 0,
  unpaid: 0,
  paid: 1,
} as const;

export type EatixConfig = {
  clientId: string;
  clientSecret: string;
  shopCode: string;
  channel: string;
  // ÉLUE product slug -> the item in Eatix's menu.
  items: Record<string, { itemId: string; skuId?: string; categoryId?: string; skuName?: string }>;
  enabled: boolean;
  // Eatix 'sale type' (their order requires it; value to be confirmed).
  saleTypeId?: string;
  saleTypeName?: string;
  // Extra fields Eatix turns out to require (seatCode ...), merged into the order's top level and info block.
  extra?: Record<string, unknown>;
};

// The ÉLUE products in Eatix's menu (category ترافلز). These ids are not secret, so they live in the code;
// the EATIX_ITEMS secret, when it holds something, overrides them.
const EATIX_CATEGORY = "6c462b09e06b49dcb6bd401ed292fc1a";
export const EATIX_ITEMS: EatixConfig["items"] = {
  "dark-chocolate": { itemId: "e25edc1cd4fd4a7bb005e2a4c2a06cc6", skuId: "dcca15b25fd44014baa45d94ef1d335b", categoryId: EATIX_CATEGORY },
  hazelnut: { itemId: "b4e45bc79ad043a3a413e095fa95d52b", skuId: "cea821854d8544e4b3bdbb5ecde5ae92", categoryId: EATIX_CATEGORY },
  carrot: { itemId: "2fe8e56a13ea4e3ba260ced0251a3f20", skuId: "4ed7d0c8b4dc4f15ae7a00e667f55c85", categoryId: EATIX_CATEGORY },
  "peanut-butter": { itemId: "8f0e926f29f744d3923b3f00187171fa", skuId: "32c3ddc2b95a468998369ce2cc494d9f", categoryId: EATIX_CATEGORY },
};

export function eatixConfig(env: Record<string, string | undefined>): EatixConfig {
  let items: EatixConfig["items"] = EATIX_ITEMS;
  try {
    const extra = JSON.parse(env.EATIX_ITEMS || "{}") as EatixConfig["items"];
    if (Object.keys(extra).length) items = extra;
  } catch {
    items = EATIX_ITEMS;
  }
  return {
    clientId: env.EATIX_CLIENT_ID ?? "",
    clientSecret: env.EATIX_CLIENT_SECRET ?? "",
    shopCode: env.EATIX_SHOP_CODE ?? "",
    channel: env.EATIX_CHANNEL ?? "",
    items,
    // On by default now that the store, channel and items are confirmed; EATIX_ENABLED="off" is the kill switch.
    enabled: env.EATIX_ENABLED !== "off",
  };
}

type EatixReply = { code?: number; errorCode?: string; message?: string; msg?: string; data?: unknown };

export class EatixError extends Error {}

let cached: { token: string; until: number } | null = null;

async function post(path: string, body: unknown, token?: string): Promise<EatixReply> {
  const res = await fetch(`${EATIX_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as EatixReply;
  } catch {
    return { code: 0, message: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  }
}

async function accessToken(cfg: EatixConfig, force = false): Promise<string> {
  if (!force && cached && cached.until > Date.now()) return cached.token;
  const reply = await post("/oauth2/token", {
    grantType: "client_credentials",
    scope: "basic",
    clientId: cfg.clientId,
    clientSecret: cfg.clientSecret,
  });
  const d = reply.data as { accessToken?: string; expiresIn?: number } | undefined;
  if (reply.code !== 1 || !d?.accessToken) throw new EatixError(`login:${reply.message ?? reply.msg ?? "failed"}`);
  // Refresh an hour early.
  cached = { token: d.accessToken, until: Date.now() + Math.max(60, (d.expiresIn ?? 3600) - 3600) * 1000 };
  return d.accessToken;
}

// Calls with the cached token; gets a new one once if the old one was refused.
async function authed(cfg: EatixConfig, path: string, body: unknown): Promise<EatixReply> {
  let reply = await post(path, body, await accessToken(cfg));
  if (reply.code !== 1 && /token|auth|unauthorized|401/i.test(`${reply.errorCode} ${reply.message}`)) {
    reply = await post(path, body, await accessToken(cfg, true));
  }
  return reply;
}

export type EatixOrder = {
  orderNumber: string;
  createdAt: string; // ISO
  name: string;
  phone: string; // 9647XXXXXXXXX
  province?: string | null;
  area?: string | null;
  address: string;
  note?: string | null;
  items: { slug: string; nameAr: string; nameEn: string; qty: number; price: number }[];
  total: number;
  paid?: boolean | null;
  freeDelivery?: boolean | null;
  deliveryFee: number;
};

function ymd(d: Date): string {
  // Baghdad business date, yyyyMMdd.
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short" }).format(d).replace(/-/g, "");
}

// The order in Eatix's «submit» format. Throws if a product has no Eatix item id.
export function buildSubmit(cfg: EatixConfig, o: EatixOrder) {
  const at = new Date(o.createdAt);
  const f = AMOUNT_FACTOR;
  const delivery = o.freeDelivery ? 0 : o.deliveryFee;
  const resultAmount = (o.total + delivery) * f;
  const paid = Boolean(o.paid);
  const submit = {
    shopCode: cfg.shopCode,
    channel: cfg.channel,
    ...(cfg.saleTypeId ? { saleTypeId: cfg.saleTypeId, saleTypeName: cfg.saleTypeName ?? "" } : {}),
    outOrderId: o.orderNumber, // unique; our number is the reference
    isPrePay: paid ? 1 : 0,
    watingOrderInfoParam: {
      ...(cfg.saleTypeId ? { saleTypeId: cfg.saleTypeId, saleTypeName: cfg.saleTypeName ?? "" } : {}),
      businessDate: ymd(at),
      orderFrom: EATIX_DEFAULTS.orderFrom,
      bizType: EATIX_DEFAULTS.bizType,
      orderType: EATIX_DEFAULTS.orderType,
      orderTime: at.getTime(),
      payStatus: paid ? EATIX_DEFAULTS.paid : EATIX_DEFAULTS.unpaid,
      orderStatus: EATIX_DEFAULTS.orderStatus,
      endTime: 0,
      endDate: "",
      guestNum: 1,
      originalAmount: resultAmount,
      discountAmount: 0,
      resultAmount,
      receiveAmount: paid ? resultAmount : 0,
      outFee: delivery * f,
      packingFee: 0,
      taxFee: 0,
      tipFee: 0,
      extraCharge: 0,
      ...(cfg.extra ?? {}),
    },
    watingOrderInfoExtParam: {
      outOrderId: o.orderNumber,
      channel: cfg.channel,
      memberName: o.name,
      memberPhone: `+${o.phone}`,
    },
    watingOrderInstanceParamList: o.items.map((i) => {
      const m = cfg.items[i.slug];
      if (!m?.itemId) throw new EatixError(`item:${i.slug} has no Eatix item id`);
      return {
        itemId: m.itemId,
        itemName: i.nameEn,
        skuId: m.skuId ?? "",
        skuName: m.skuName ?? "",
        categoryId: m.categoryId ?? "",
        num: i.qty,
        orderNum: i.qty,
        price: i.price * f,
        customerPrice: i.price * f,
        totalFee: i.price * i.qty * f,
        resultAmount: i.price * i.qty * f,
        discountAmount: 0,
        memo: "",
      };
    }),
    watingOrderPayParamList: [{ fee: paid ? resultAmount : 0, payName: paid ? "Prepaid" : "Cash on delivery" }],
    watingOrderInfoDeliveryParam: {
      deliveryType: EATIX_DEFAULTS.deliveryType,
      deliveryStatus: EATIX_DEFAULTS.deliveryStatus,
      consignee: o.name,
      consigneePhone: `+${o.phone}`,
      consigneeAddr: [o.province, o.area, o.address].filter(Boolean).join(" - "),
    },
    watingOrderCampaignsParamList: [],
    watingOrderSpecialParamList: [],
  };
  // Trial fields (cfg.extra) win over the defaults above.
  return { ...submit, ...(cfg.extra ?? {}) };
}

export type SendResult = { ok: true; eatixId: string } | { ok: false; error: string };

// Sends one order. Never throws: the caller records the result on the order.
export async function sendOrder(cfg: EatixConfig, o: EatixOrder): Promise<SendResult> {
  try {
    if (!cfg.enabled) return { ok: false, error: "disabled" };
    if (!cfg.clientId || !cfg.clientSecret || !cfg.shopCode || !cfg.channel) return { ok: false, error: "not_configured" };
    const reply = await authed(cfg, "/open/order/v1/submit", buildSubmit(cfg, o));
    const id = (reply.data as { orderId?: string } | undefined)?.orderId;
    if (reply.code !== 1 || !id) {
      return { ok: false, error: `${reply.errorCode ?? ""} ${reply.message ?? reply.msg ?? "failed"}`.trim() };
    }
    return { ok: true, eatixId: String(id) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}

// Cancels an order at Eatix (an order cancelled in ÉLUE).
export async function cancelOrder(cfg: EatixConfig, eatixId: string): Promise<SendResult> {
  try {
    if (!cfg.enabled) return { ok: false, error: "disabled" };
    const reply = await authed(cfg, "/open/order/v1/cancel", { shopCode: cfg.shopCode, channel: cfg.channel, orderId: eatixId });
    if (reply.code !== 1) return { ok: false, error: `${reply.errorCode ?? ""} ${reply.message ?? reply.msg ?? "failed"}`.trim() };
    return { ok: true, eatixId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "failed" };
  }
}

// An ÉLUE order row -> what sendOrder needs. `items` may arrive as JSON text.
export function toEatixOrder(o: {
  orderNumber: string;
  createdAt: string;
  name: string;
  phone: string;
  province?: string | null;
  area?: string | null;
  address: string;
  note?: string | null;
  items: unknown;
  total: number;
  paid?: boolean | null;
  freeDelivery?: boolean | null;
}): EatixOrder {
  let items: unknown = o.items;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch {
      items = [];
    }
  }
  return {
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    name: o.name,
    phone: o.phone,
    province: o.province,
    area: o.area,
    address: o.address,
    note: o.note,
    items: Array.isArray(items) ? (items as EatixOrder["items"]) : [],
    total: o.total,
    paid: o.paid,
    freeDelivery: o.freeDelivery,
    deliveryFee: 0, // the courier's fee is not known when the order is placed
  };
}

// What to store on the order after a send attempt.
export function eatixFields(r: SendResult, simulated: boolean) {
  const now = new Date().toISOString();
  if (r.ok) return { eatixId: r.eatixId, eatixStatus: simulated ? "SIMULATED" : "SENT", eatixError: null, eatixSentAt: now };
  if (r.error === "disabled") return { eatixStatus: "OFF", eatixError: null };
  return { eatixStatus: "FAILED", eatixError: r.error.slice(0, 300) };
}

// Diagnostic: asks Eatix to cancel an order that does not exist, with the given
// store / channel values. Creates nothing; the reply shows whether Eatix knows
// the store and channel (a "not found" for the order means they are accepted).
export async function probe(cfg: EatixConfig, shopCode: string, channel: string): Promise<unknown> {
  try {
    return await authed(cfg, "/open/order/v1/cancel", { shopCode, channel, orderId: "PROBE-0", outOrderId: "PROBE-0" });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "failed" };
  }
}

// Diagnostic: a read-only call (item / menu / category lookups only) with the store and channel.
export async function browse(cfg: EatixConfig, path: string, extra: Record<string, unknown> = {}): Promise<unknown> {
  if (!/^\/open\/(item|menu|goods|category|shop|member|customer|user|pay|payment|trade|order|sale|saleType|saletype|sales)\/v1\/[A-Za-z/]*(list|get|query|menu|detail|info|methods|config)$/.test(path)) return { error: "path_not_allowed" };
  try {
    return await authed(cfg, path, { shopCode: cfg.shopCode, channel: cfg.channel, ...extra });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "failed" };
  }
}
