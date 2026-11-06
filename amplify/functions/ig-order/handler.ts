import { setDefaultResultOrder } from "node:dns";
import { timingSafeEqual } from "node:crypto";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { ConditionalCheckFailedException, DynamoDBClient, GetItemCommand, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { env } from "$amplify/env/ig-order";
import { priceCart, type CartItem } from "../../../lib/order-text";
import { normalizeIraqiMobile } from "../../../lib/phone";
import { freeDeliveryFor, site } from "../../../lib/site";
import { products } from "../../../lib/products";
import { begin, isStart, next, notStarted, type ChatState, type Reply, type Turn } from "../../../lib/ig-chat";

// Instagram DM orders from ManyChat (External Request step).
//
// ManyChat sends JSON with the answers it collected; we place the order through
// placeOrder as the team (same checks as the admin), and answer with
//   { ok: true,  orderNumber, total, jars, freeDelivery, message }
//   { ok: false, error: "<what to tell the customer, Arabic>", field? }
// Logical failures are HTTP 200 with ok:false so ManyChat can branch on `ok`;
// only a wrong/missing key is 401.

setDefaultResultOrder("ipv4first");

const lambda = new LambdaClient({});
const dynamo = new DynamoDBClient({});
const KEY_HEADER = "x-elue-key";

type UrlEvent = {
  requestContext: { http: { method: string } };
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
};

const json = (statusCode: number, body: unknown) => ({
  statusCode,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify(body),
});

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Quantity answers arrive as text ("2", "٢", ""), from separate ManyChat fields.
const qtyOf = (v: unknown): number => {
  const s = String(v ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const n = Math.floor(Number(s));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 20) : 0;
};

// Either `items: [{slug, qty}]`, or one field per flavor named after its slug
// (q_carrot, q_hazelnut, q_peanut-butter, q_dark-chocolate).
function itemsFrom(body: Record<string, unknown>): CartItem[] {
  if (Array.isArray(body.items)) {
    return body.items
      .map((i) => ({ slug: String((i as CartItem)?.slug ?? ""), qty: qtyOf((i as CartItem)?.qty) }))
      .filter((i) => i.slug && i.qty);
  }
  return products
    .map((p) => ({ slug: p.slug, qty: qtyOf(body[`q_${p.slug}`] ?? body[`q_${p.slug.replace(/-/g, "_")}`]) }))
    .filter((i) => i.qty);
}

// The same customer sending the same order twice within 10 minutes (a double tap,
// a retried request) creates one order only.
async function firstTime(dedupeKey: string): Promise<boolean> {
  const now = Date.now();
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: process.env.COUNTERS_TABLE,
        Item: { id: { S: `ig#${dedupeKey}` }, until: { N: String(now + 10 * 60_000) } },
        ConditionExpression: "attribute_not_exists(id) OR #u < :now",
        ExpressionAttributeNames: { "#u": "until" },
        ExpressionAttributeValues: { ":now": { N: String(now) } },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

// placeOrder's error codes -> a sentence for the customer.
function explain(message: string): { error: string; field?: string } {
  if (message.startsWith("invalid_fields:")) {
    try {
      const fields = JSON.parse(message.slice("invalid_fields:".length)) as Record<string, string>;
      const [field, text] = Object.entries(fields)[0] ?? [];
      if (field && text) return { error: text, field };
    } catch {
      /* fall through */
    }
  }
  if (message === "empty_cart") return { error: "لم يتم اختيار أي علبة. اختاروا النكهة والعدد.", field: "items" };
  if (message.startsWith("out_of_stock:")) return { error: "إحدى النكهات المختارة نفدت كميتها حالياً. اختاروا نكهة ثانية.", field: "items" };
  return { error: "تعذّر تسجيل الطلب الآن. راح يتواصل معكم واحد من الفريق." };
}

async function placeIgOrder(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const phone = normalizeIraqiMobile(String(body.phone ?? ""));
  if (!phone) return { ok: false, field: "phone", error: "رقم الهاتف غير صحيح. اكتبوه بصيغة 07xxxxxxxxx." };

  const items = itemsFrom(body);
  const { lines, total } = priceCart(items);
  if (!lines.length) return { ok: false, field: "items", error: "لم يتم اختيار أي علبة. اختاروا النكهة والعدد." };
  const jars = lines.reduce((n, l) => n + l.qty, 0);

  // Same customer + same cart = same order.
  const dedupe = `${phone}#${lines.map((l) => `${l.product.slug}x${l.qty}`).sort().join(",")}`;
  if (!(await firstTime(dedupe))) return { ok: false, duplicate: true, error: "طلبكم مسجّل قبل قليل. راح يتواصل معكم الفريق." };

  // placeOrder reads who is calling from the AppSync identity. This is the ÉLUE
  // team (ADMINS) placing the order for the customer's number; ÉLUE's own
  // WhatsApp number is only the "created by" label shown to the team.
  const botPhone = site.whatsappNumber;
  const appSyncEvent = {
    arguments: {
      name: String(body.name ?? ""),
      province: String(body.province ?? ""),
      area: String(body.area ?? ""),
      address: String(body.address ?? ""),
      note: String(body.note ?? "").slice(0, 380),
      source: "Instagram DM",
      items: JSON.stringify(items),
      customerPhone: phone,
    },
    identity: {
      sub: "ig-order",
      username: "ig-order",
      groups: ["ADMINS"],
      claims: { phone_number: `+${botPhone}` },
    },
  };

  const res = await lambda.send(
    new InvokeCommand({
      FunctionName: process.env.PLACE_ORDER_FUNCTION,
      Payload: Buffer.from(JSON.stringify(appSyncEvent)),
    }),
  );
  const payload = res.Payload ? Buffer.from(res.Payload).toString("utf8") : "";
  if (res.FunctionError) {
    // Let the customer try again with the same cart.
    await dynamo
      .send(new PutItemCommand({ TableName: process.env.COUNTERS_TABLE, Item: { id: { S: `ig#${dedupe}` }, until: { N: "0" } } }))
      .catch(() => undefined);
    let message = "";
    try {
      message = String((JSON.parse(payload) as { errorMessage?: string }).errorMessage ?? "");
    } catch {
      /* ignore */
    }
    console.error("ig-order: placeOrder failed", message.slice(0, 300));
    return { ok: false, ...explain(message) };
  }
  const result = JSON.parse(payload) as { orderNumber?: string };
  const free = freeDeliveryFor(jars);
  return {
    ok: true,
    orderNumber: result.orderNumber,
    jars,
    total,
    freeDelivery: free,
    deliveryFee: free ? 0 : site.deliveryFee,
    message: `تم تسجيل طلبكم ✅ رقم الطلب ${result.orderNumber}. المبلغ ${total.toLocaleString("en-US")} دينار${
      free ? " والتوصيل مجاني" : ` + ${site.deliveryFee.toLocaleString("en-US")} توصيل`
    }. راح يتواصل معكم الفريق لتأكيد الموعد.`,
  };
}

// ---- The DM conversation (ManyChat dynamic block) ---------------------------------------

// Quick replies jump back into the ManyChat automation that calls us (its flow id).
const FLOW_ID = "content20261105211553_659322";

async function loadState(id: string): Promise<ChatState | null> {
  const r = await dynamo.send(new GetItemCommand({ TableName: process.env.COUNTERS_TABLE, Key: { id: { S: `igchat#${id}` } } }));
  const until = Number(r.Item?.until?.N ?? 0);
  if (!r.Item?.state?.S || until < Date.now()) return null;
  return JSON.parse(r.Item.state.S) as ChatState;
}

async function saveState(id: string, state: ChatState | null): Promise<void> {
  await dynamo.send(
    new PutItemCommand({
      TableName: process.env.COUNTERS_TABLE,
      Item: state
        ? { id: { S: `igchat#${id}` }, state: { S: JSON.stringify(state) }, until: { N: String(Date.now() + 60 * 60_000) } }
        : { id: { S: `igchat#${id}` }, until: { N: "0" } },
    }),
  );
}

const block = (replies: Reply[]) => {
  const last = replies[replies.length - 1];
  return {
    version: "v2",
    content: {
      type: "instagram",
      messages: replies.map((r) => ({ type: "text", text: r.text })),
      actions: [],
      ...(last?.quick?.length ? { quick_replies: last.quick.map((caption) => ({ type: "flow", caption, target: FLOW_ID })) } : {}),
    },
  };
};

async function chatTurn(body: Record<string, unknown>) {
  const c = body.chat as Record<string, unknown>;
  const id = String(c.id ?? "").trim();
  const text = String(c.text ?? "").trim();
  if (!id) return block([{ text: "حدث خطأ بسيط. اكتبوا «أحچي ويا الفريق»." }]);

  const state = await loadState(id);
  let turn: Turn;
  if (isStart(text)) turn = begin();
  else if (!state) {
    console.log("ig-order notStarted", { len: text.length, head: text.slice(0, 12) });
    turn = notStarted();
  }
  else turn = next(state, text);

  if (turn.place) {
    const result = await placeIgOrder(turn.place as unknown as Record<string, unknown>);
    await saveState(id, null);
    const message = result.ok ? String(result.message) : String(result.error ?? "تعذّر تسجيل الطلب. راح يتواصل معكم الفريق.");
    return block([{ text: message }]);
  }
  await saveState(id, turn.state);
  return block(turn.replies);
}

export const handler = async (event: UrlEvent) => {
  if (event.requestContext.http.method !== "POST") return json(405, { ok: false });
  const key = event.headers?.[KEY_HEADER] ?? "";
  if (!env.IG_ORDER_KEY || !sameSecret(key, env.IG_ORDER_KEY)) return json(401, { ok: false });

  let body: Record<string, unknown>;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json(400, { ok: false });
  }

  if (body.chat && typeof body.chat === "object") return json(200, await chatTurn(body));
  return json(200, await placeIgOrder(body));
};
