import { setDefaultResultOrder } from "node:dns";
import type { AppSyncIdentityCognito } from "aws-lambda";
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UsernameExistsException,
} from "@aws-sdk/client-cognito-identity-provider";
import { randomBytes } from "node:crypto";
import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/place-order";
import type { Schema } from "../../data/resource";
import { priceCart, type CartItem } from "../../../lib/order-text";
import { checkDelivery, cleanDelivery } from "../../../lib/validate";
import { normalizeIraqiMobile } from "../../../lib/phone";
import { buildOrderMessage, sendToTelegram } from "../../../lib/telegram";
import { eatixConfig, eatixFields, sendOrder, toEatixOrder } from "../../../lib/eatix";
import { OPEN_STATUSES, ORDER_RULES } from "../../../lib/order-rules";
import { freeDeliveryFor, needsPayRef, site } from "../../../lib/site";
import { cleanSlotDate, DEFAULT_SLOT, isSlotKey, SLOT_PROVINCE } from "../../../lib/delivery-slot";
import { sendOrderConfirmation } from "../../../lib/orderConfirmation";
import { pendingReview } from "../../../lib/reviews";
import { createPayment, getPaymentStatus, qiConfig, verifyNotification, type QiPayment } from "../../../lib/qi";
import { GetFunctionUrlConfigCommand, LambdaClient } from "@aws-sdk/client-lambda";

// placeOrder: the only way an order is created.
// 1. Checks the customer is logged in (their WhatsApp number comes from the login, not the form).
// 2. Checks name/address and prices the cart from our own product list.
// 3. Saves the order in DynamoDB.            <- the order is safe from here on
// 3b. Paying now with Qi Card: the order waits (not sent to Telegram/Eatix) until Qi confirms the
//     payment, by its signed notification (function URL) or by qiConfirm when the customer returns.
// 4. Sends it to the Telegram group (3 tries). If Telegram fails the order is
//    still saved and shows on /admin.

// Lambda has no IPv6 route to the internet; connecting to Telegram over IPv6
// first made some requests hang until they timed out.
setDefaultResultOrder("ipv4first");

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });
const cognito = new CognitoIdentityProviderClient({});

// The website calls us with the customer's access token, which carries their
// id but not their phone number, so the number is read from the login record.
async function customerPhone(identity: AppSyncIdentityCognito | null): Promise<string | null> {
  if (!identity?.sub || !identity.username) return null;
  const fromToken = String(identity.claims?.phone_number ?? "");
  if (/^\+9647\d{9}$/.test(fromToken)) return fromToken.slice(1);
  try {
    const user = await cognito.send(
      new AdminGetUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: identity.username }),
    );
    const phone = user.UserAttributes?.find((a) => a.Name === "phone_number")?.Value ?? "";
    return /^\+9647\d{9}$/.test(phone) ? phone.slice(1) : null;
  } catch (err) {
    console.error("customer lookup failed", err);
    return null;
  }
}

// The customer's account ("sub::username", the order's owner) for a WhatsApp
// number, so an order the team places shows in the customer's «طلباتي».
// null when the customer has never logged in.
async function ownerForPhone(phone: string): Promise<string | null> {
  try {
    const res = await cognito.send(
      new ListUsersCommand({ UserPoolId: process.env.USER_POOL_ID, Filter: `phone_number = "+${phone}"`, Limit: 1 }),
    );
    const user = res.Users?.[0];
    const sub = user?.Attributes?.find((a) => a.Name === "sub")?.Value;
    return user?.Username && sub ? `${sub}::${user.Username}` : null;
  } catch (err) {
    console.error("customer search failed", err);
    return null;
  }
}

// The customer's account for an order the team places. If the number has never
// logged in, the account is created now (same kind of account the website makes
// on first login), so the order is theirs from the start and they see it, with
// their points, as soon as they log in with that WhatsApp number. Returns
// created=true only for a new account, so its saved details can be filled in.
async function ensureCustomer(phone: string): Promise<{ owner: string | null; created: boolean }> {
  const existing = await ownerForPhone(phone);
  if (existing) return { owner: existing, created: false };
  try {
    const res = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: `+${phone}`,
        UserAttributes: [
          { Name: "phone_number", Value: `+${phone}` },
          { Name: "phone_number_verified", Value: "true" },
        ],
        MessageAction: "SUPPRESS", // no SMS from Cognito: the customer logs in with a WhatsApp code
      }),
    );
    // Same as a self-made account: confirmed, with a random password nobody uses.
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: process.env.USER_POOL_ID,
        Username: res.User?.Username,
        Password: `Aa1!${randomBytes(18).toString("base64url")}`,
        Permanent: true,
      }),
    );
    const sub = res.User?.Attributes?.find((a) => a.Name === "sub")?.Value;
    return res.User?.Username && sub ? { owner: `${sub}::${res.User.Username}`, created: true } : { owner: null, created: false };
  } catch (err) {
    if (err instanceof UsernameExistsException) return { owner: await ownerForPhone(phone), created: false };
    console.error("creating the customer account failed", err);
    return { owner: null, created: false };
  }
}

const dynamo = new DynamoDBClient({});
const eatixCfg = eatixConfig(env as unknown as Record<string, string>);

// Production is the "amplify" branch; any other branch (dev) is a test copy:
// order numbers start with DEV- and nothing is sent to the team's Telegram.
const PRODUCTION = process.env.STAGE === "amplify";

// One order at a time per customer: a short lock so two requests sent at the
// same moment can't both pass the checks below.
async function lockCustomer(owner: string): Promise<boolean> {
  const now = Date.now();
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: process.env.COUNTERS_TABLE,
        Item: { id: { S: `lock#${owner}` }, until: { N: String(now + 30_000) } },
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

async function unlockCustomer(owner: string) {
  await dynamo
    .send(new DeleteItemCommand({ TableName: process.env.COUNTERS_TABLE, Key: { id: { S: `lock#${owner}` } } }))
    .catch((err) => console.error("unlock failed", err));
}

// The customer's limits: one open order, a few orders a day.
async function checkCustomerLimits(owner: string, isTeam: boolean) {
  const { data } = await client.models.Order.listOrderByOwner(
    { owner },
    { limit: 200, selectionSet: ["id", "orderNumber", "status", "createdAt", "reviewed", "qiStatus", "paid"] },
  );
  let orders = data ?? [];
  // An order still waiting for a Qi payment the customer walked away from: they are starting
  // again, so it is cancelled and doesn't count as an open order.
  const abandoned = orders.filter((o) => o.qiStatus === "CREATED" && !o.paid && o.status === "NEW");
  for (const o of abandoned) {
    await client.models.Order.update({ id: o.id, status: "CANCELLED", qiStatus: "FAILED" }).catch((err) =>
      console.error("cancelling an abandoned payment order failed", err),
    );
  }
  if (abandoned.length) orders = orders.filter((o) => !abandoned.includes(o));
  const open = orders.filter((o) => (OPEN_STATUSES as readonly string[]).includes(o.status));
  if (open.length >= ORDER_RULES.maxOpenOrders) {
    open.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    throw new Error(`open_order:${open[0].orderNumber}`);
  }
  // The latest delivered order must be reviewed first (customers only; see lib/reviews.ts).
  if (site.reviewRequiredToReorder && !isTeam) {
    const waiting = pendingReview(orders);
    if (waiting) throw new Error(`review_required:${waiting.orderNumber}`);
  }
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  if (orders.filter((o) => o.createdAt > dayAgo).length >= ORDER_RULES.maxOrdersPer24h) {
    throw new Error("too_many_orders");
  }
}

// Next order number: EL-0001, EL-0002, ... (atomic, never repeats).
async function nextOrderNumber(): Promise<string> {
  const res = await dynamo.send(
    new UpdateItemCommand({
      TableName: process.env.COUNTERS_TABLE,
      Key: { id: { S: "order" } },
      UpdateExpression: "ADD #n :one",
      ExpressionAttributeNames: { "#n": "value" },
      ExpressionAttributeValues: { ":one": { N: "1" } },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  const n = Number(res.Attributes?.value?.N ?? "0");
  return `${PRODUCTION ? "EL" : "DEV"}-${String(n).padStart(4, "0")}`;
}

// Flavors the team has switched to «نفدت الكمية» on /admin.
async function unavailableSlugs(): Promise<Set<string>> {
  const { data } = await client.models.ProductSetting.list({ limit: 100 });
  return new Set((data ?? []).filter((s) => !s.available).map((s) => s.slug));
}

function baghdadTime(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short" }).format(d);
}

type PlaceOrderEvent = Parameters<Schema["placeOrder"]["functionHandler"]>[0];

async function placeOrderHandler(event: PlaceOrderEvent) {
  const identity = event.identity as AppSyncIdentityCognito | null;
  const callerPhone = await customerPhone(identity);
  if (!identity || !callerPhone) throw new Error("not_signed_in");

  const args = event.arguments;
  // The team placing an order for a customer.
  const isTeam = (identity.groups ?? []).includes("ADMINS");
  const forCustomer = Boolean(String(args.customerPhone ?? "").trim());
  if (forCustomer && !isTeam) throw new Error("forbidden");
  const phone = forCustomer ? normalizeIraqiMobile(String(args.customerPhone)) : callerPhone;
  if (!phone) throw new Error('invalid_fields:{"phone":"رقم الواتساب غير صحيح."}');
  const cashierOrderId = isTeam ? String(args.cashierOrderId ?? "").trim().slice(0, 60) || null : null;
  // Only the team can mark an order prepaid (customer paid the jars already)
  // or free-delivery (ÉLUE covers the fee).
  const paid = isTeam ? Boolean(args.paid) : false;
  // Delivery fee: already paid by the customer, or a gift from ÉLUE (never both).
  const deliveryPaid = isTeam ? Boolean(args.deliveryPaid) : false;
  let freeDelivery = isTeam && !deliveryPaid ? Boolean(args.freeDelivery) : false;
  // How it was paid in advance (Qi Card, ZainCash, other…) and its transaction number.
  // Required whenever the customer prepaid the jars or the delivery fee (a free-jars gift needs no number).
  const rawMethod = String(args.payMethod ?? "").trim().toUpperCase();
  const prepaid = paid || deliveryPaid;
  const payMethod = isTeam && prepaid && ["QI", "ZAINCASH", "OTHER", "GIFT"].includes(rawMethod) ? rawMethod : null;
  const payRef = payMethod && needsPayRef(payMethod) ? String(args.payRef ?? "").trim().slice(0, 80) || null : null;
  // For «دفع آخر»: what it was (e.g. bank transfer).
  const paidNote = isTeam && prepaid ? String(args.paidNote ?? "").trim().slice(0, 120) || null : null;
  if (isTeam && prepaid) {
    if (!payMethod) throw new Error('invalid_fields:{"payMethod":"اختر طريقة الدفع."}');
    if (needsPayRef(payMethod) && !payRef) throw new Error('invalid_fields:{"payRef":"اكتب رقم العملية أو الحوالة."}');
  }
  const slotAccepted = Boolean(args.slotAccepted);
  // The customer pays now with Qi Card (customers only; the team records prepaid orders by hand).
  const online = !isTeam && Boolean(args.payOnline);
  const qi = qiConfig(env as unknown as Record<string, string>);
  if (online && !qi) throw new Error("pay_unavailable");
  const { name, province, area, address } = cleanDelivery({
    name: String(args.name ?? ""),
    province: String(args.province ?? ""),
    area: String(args.area ?? ""),
    address: String(args.address ?? ""),
  });
  const note = String(args.note ?? "").trim().slice(0, 400) || null;
  // Baghdad: the delivery period and the wanted day (anything else is ignored).
  const inBaghdad = province === SLOT_PROVINCE;
  const deliverySlot = inBaghdad ? (isSlotKey(args.deliverySlot) ? args.deliverySlot : DEFAULT_SLOT) : null;
  const deliveryDate = inBaghdad ? cleanSlotDate(args.deliveryDate) : null;
  const source = String(args.source ?? "").trim().slice(0, 200) || null;

  let rawItems: unknown = args.items;
  if (typeof rawItems === "string") {
    try {
      rawItems = JSON.parse(rawItems);
    } catch {
      rawItems = [];
    }
  }
  const items = Array.isArray(rawItems) ? (rawItems.slice(0, 10) as CartItem[]) : [];
  const { lines, total } = priceCart(items);

  const fields = checkDelivery({ name, province, area, address });
  if (Object.keys(fields).length) throw new Error(`invalid_fields:${JSON.stringify(fields)}`);
  if (!lines.length) throw new Error("empty_cart");
  const jars = lines.reduce((n, l) => n + l.qty, 0);
  if (!isTeam && jars > ORDER_RULES.maxJarsPerOrder) throw new Error(`too_many_jars:${ORDER_RULES.maxJarsPerOrder}`);
  // Free delivery for larger orders (site.freeDeliveryMinJars jars or more), unless the fee was prepaid.
  if (!deliveryPaid && freeDeliveryFor(jars)) freeDelivery = true;

  // The team may still take an order for a flavor marked sold out (e.g. stock on the way).
  const soldOut = forCustomer ? new Set<string>() : await unavailableSlugs();
  const missing = lines.filter((l) => soldOut.has(l.product.slug)).map((l) => l.product.slug);
  if (missing.length) throw new Error(`out_of_stock:${missing.join(",")}`);

  const customer = forCustomer ? await ensureCustomer(phone) : null;
  const owner = customer ? customer.owner : `${identity.sub}::${identity.username}`;

  const saveAndNotify = async () => {
    const number = await nextOrderNumber();
    const payAmount = total + (freeDelivery ? 0 : site.deliveryFee);
    const { data: order, errors } = await client.models.Order.create({
      orderNumber: number,
      phone,
      name,
      province,
      area,
      address,
      note,
      source,
      items: lines.map((l) => ({
        slug: l.product.slug,
        nameAr: l.product.nameAr,
        nameEn: l.product.nameEn,
        qty: l.qty,
        price: l.product.price,
      })),
      jars,
      total,
      status: "NEW",
      telegramSent: false,
      cashierOrderId,
      paid,
      paidNote,
      payMethod,
      payRef,
      freeDelivery,
      deliveryPaid,
      slotAccepted: slotAccepted || inBaghdad,
      deliverySlot,
      deliveryDate,
      createdBy: forCustomer ? callerPhone : null,
      owner,
      ...(online ? { qiStatus: "CREATED" } : {}),
    });
    if (!order || errors?.length) {
      console.error("Saving the order failed", JSON.stringify(errors));
      throw new Error("save_failed");
    }

    // A brand-new customer's saved details («معلوماتي») start from this order.
    if (customer?.created && owner) {
      const { errors: profileErrors } = await client.models.CustomerProfile.create({ name, province, area, address, owner });
      if (profileErrors?.length) console.error("saving the customer profile failed", JSON.stringify(profileErrors));
    }

    // Paying now: create the Qi payment and send the customer to its page. The team is told
    // only after Qi confirms the payment (see finishPayment).
    if (online && qi) {
      const notificationUrl = await ownUrl();
      const pay = notificationUrl
        ? await createPayment(qi, {
            orderNumber: number,
            amount: payAmount,
            finishUrl: `${siteOrigin()}/order/paid?o=${encodeURIComponent(number)}`,
            notificationUrl,
            name,
            phone,
          })
        : ({ ok: false, error: "no_notification_url" } as const);
      if (!pay.ok || !pay.data.formUrl || !pay.data.paymentId) {
        console.error("Qi payment could not be created", pay.ok ? JSON.stringify(pay.data).slice(0, 300) : pay.error);
        await client.models.Order.update({ id: order.id, status: "CANCELLED", qiStatus: "FAILED" });
        throw new Error("pay_failed");
      }
      await client.models.Order.update({ id: order.id, qiPaymentId: pay.data.paymentId });
      return { id: order.id, orderNumber: number, createdAt: order.createdAt, telegramSent: false, payUrl: pay.data.formUrl };
    }

    const telegramSent = await notifyTeam(order);
    return { id: order.id, orderNumber: number, createdAt: order.createdAt, telegramSent, payUrl: null };
  };

  // Customers ordering for themselves: one order at a time (see lib/order-rules.ts).
  const lockedOwner = forCustomer ? null : owner;
  if (lockedOwner && !(await lockCustomer(lockedOwner))) throw new Error("busy");
  try {
    if (lockedOwner) await checkCustomerLimits(lockedOwner, isTeam);
    return await saveAndNotify();
  } finally {
    if (lockedOwner) await unlockCustomer(lockedOwner);
  }
}

// ---- Telling the team about an order ------------------------------------------

type OrderRecord = Schema["Order"]["type"];

// Telegram, the Eatix cashier copy and the customer's WhatsApp confirmation. Used when an
// order is placed, or (Qi Card) when its payment is confirmed. Returns whether Telegram got it.
async function notifyTeam(order: OrderRecord): Promise<boolean> {
  const previous = await client.models.Order.listOrderByPhone({ phone: order.phone }, { limit: 2, selectionSet: ["id"] });
  const returning = (previous.data ?? []).some((o) => o.id !== order.id);
  const { lines } = priceCart(
    (order.items ?? []).filter((i): i is NonNullable<typeof i> => Boolean(i)).map((i) => ({ slug: i.slug, qty: i.qty })),
  );
  const message = buildOrderMessage({
    orderNumber: order.orderNumber,
    time: baghdadTime(new Date(order.createdAt)),
    lines,
    total: order.total,
    name: order.name,
    phone: order.phone,
    province: order.province ?? "",
    area: order.area ?? "",
    address: order.address,
    note: order.note ?? null,
    deliverySlot: order.deliverySlot ?? null,
    deliveryDate: order.deliveryDate ?? null,
    source: order.source ?? null,
    returning,
    createdBy: order.createdBy ?? null,
    cashierOrderId: order.cashierOrderId ?? null,
    paid: Boolean(order.paid),
    paidNote: order.paidNote ?? null,
    payMethod: order.payMethod ?? null,
    payRef: order.payRef ?? null,
    freeDelivery: Boolean(order.freeDelivery),
    deliveryPaid: Boolean(order.deliveryPaid),
  });
  // The dev copy never messages the team's Telegram group.
  const telegramSent = PRODUCTION ? await sendToTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, message) : false;
  if (!PRODUCTION) console.log("DEV order, Telegram skipped:\n" + message);
  if (telegramSent) await client.models.Order.update({ id: order.id, telegramSent: true });

  // Copy of the order to Eatix (cashier device). Best effort: a failure is
  // recorded on the order (retry on /admin) and never blocks the order.
  try {
    const r = PRODUCTION
      ? await sendOrder(eatixCfg, toEatixOrder(order as Parameters<typeof toEatixOrder>[0]))
      : ({ ok: true, eatixId: `DEV${Date.now()}` } as const);
    const { errors: eErrors } = await client.models.Order.update({ id: order.id, ...eatixFields(r, !PRODUCTION) });
    if (eErrors?.length) console.error("saving the Eatix result failed", JSON.stringify(eErrors));
    if (!r.ok && r.error !== "disabled") console.error("Eatix push failed", r.error);
  } catch (err) {
    console.error("Eatix push crashed", err);
  }

  // A customer who placed their own order gets a WhatsApp confirmation (orders the team enters are not).
  // Live only, best effort: it never blocks or fails the order.
  if (!order.createdBy && PRODUCTION) {
    const r = await sendOrderConfirmation({ apiKey: env.OTPIQ_API_KEY, phone: order.phone, name: order.name, orderNumber: order.orderNumber, origin: "https://elue-iq.com" });
    if (!r.sent && r.reason !== "not_configured") console.error("order confirmation not sent:", r.reason);
  } else if (!order.createdBy) {
    console.log("DEV order, WhatsApp confirmation skipped");
  }
  return telegramSent;
}

// ---- Qi Card payments -----------------------------------------------------------

const lambdaClient = new LambdaClient({});
const siteOrigin = () => (PRODUCTION ? "https://elue-iq.com" : "https://dev.dqa1y51n2g520.amplifyapp.com");

// This function's own public address (where Qi sends its signed notification).
let cachedUrl = "";
async function ownUrl(): Promise<string> {
  if (cachedUrl) return cachedUrl;
  try {
    const r = await lambdaClient.send(new GetFunctionUrlConfigCommand({ FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME }));
    cachedUrl = r.FunctionUrl ?? "";
  } catch (err) {
    console.error("own function url lookup failed", err);
  }
  return cachedUrl;
}

// Exactly-once guard: the first caller to claim an order's payment result does the work.
async function claimPayment(orderNumber: string): Promise<boolean> {
  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: process.env.COUNTERS_TABLE,
        Item: { id: { S: `qipaid#${orderNumber}` }, at: { N: String(Date.now()) } },
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

// Applies Qi's verdict on an order's payment. SUCCESS: the order is paid (jars + delivery fee),
// then the team is told. FAILED: the order is cancelled. Anything else changes nothing yet.
async function finishPayment(order: OrderRecord, p: QiPayment): Promise<{ status: string; paid: boolean }> {
  if (order.paid) return { status: "SUCCESS", paid: true };
  const expected = order.total + (order.freeDelivery ? 0 : site.deliveryFee);
  if (p.status === "SUCCESS") {
    if (Number(p.amount ?? 0) < expected) {
      console.error("Qi amount is lower than the order", order.orderNumber, p.amount, expected);
      return { status: "CREATED", paid: false };
    }
    if (!(await claimPayment(order.orderNumber))) return { status: "SUCCESS", paid: true };
    const { data: updated, errors } = await client.models.Order.update({
      id: order.id,
      paid: true,
      deliveryPaid: !order.freeDelivery,
      payMethod: "QI",
      payRef: p.paymentId ?? order.qiPaymentId ?? null,
      qiStatus: "SUCCESS",
    });
    if (!updated || errors?.length) {
      console.error("saving the paid order failed", order.orderNumber, JSON.stringify(errors));
      throw new Error("save_failed");
    }
    await notifyTeam(updated);
    return { status: "SUCCESS", paid: true };
  }
  if (p.status === "FAILED" || p.status === "AUTHENTICATION_FAILED" || p.canceled) {
    if (order.status === "NEW") await client.models.Order.update({ id: order.id, status: "CANCELLED", qiStatus: "FAILED" });
    return { status: "FAILED", paid: false };
  }
  return { status: "CREATED", paid: false };
}

// Qi's notification (function URL): checked by its signature before anything is changed.
type UrlEvent = {
  requestContext: { http: { method: string } };
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
};

async function qiNotification(event: UrlEvent) {
  const reply = (statusCode: number, body: unknown) => ({ statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (event.requestContext.http.method !== "POST") return reply(405, { ok: false });
  let body: QiPayment;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : (event.body ?? "");
    body = JSON.parse(raw) as QiPayment;
  } catch {
    return reply(400, { ok: false });
  }
  const signature = event.headers?.["x-signature"] ?? event.headers?.["X-Signature"] ?? "";
  if (!verifyNotification(body, signature)) {
    console.error("Qi notification: bad signature", JSON.stringify(body).slice(0, 300));
    return reply(401, { ok: false });
  }
  if (!body.paymentId) return reply(400, { ok: false });
  const { data } = await client.models.Order.listOrderByQiPaymentId({ qiPaymentId: body.paymentId }, { limit: 1 });
  const order = data?.[0];
  if (!order) {
    console.error("Qi notification for an unknown payment", body.paymentId);
    return reply(200, { ok: true, ignored: true });
  }
  const result = await finishPayment(order, body);
  return reply(200, { ok: true, ...result });
}

// qiConfirm (the customer is back from Qi's page): asks Qi for the payment's status.
async function qiConfirm(event: { identity: unknown; arguments: { orderNumber: string } }) {
  const identity = event.identity as AppSyncIdentityCognito | null;
  if (!identity?.sub || !identity.username) throw new Error("not_signed_in");
  const owner = `${identity.sub}::${identity.username}`;
  const orderNumber = String(event.arguments.orderNumber ?? "").trim();
  const { data } = await client.models.Order.listOrderByOwner({ owner }, { limit: 200 });
  const order = (data ?? []).find((o) => o.orderNumber === orderNumber);
  if (!order) throw new Error("order_not_found");
  if (order.paid) return { orderNumber, status: "SUCCESS", paid: true };
  if (order.qiStatus !== "CREATED" || !order.qiPaymentId) return { orderNumber, status: order.qiStatus ?? "FAILED", paid: false };
  const qi = qiConfig(env as unknown as Record<string, string>);
  if (!qi) throw new Error("pay_unavailable");
  const r = await getPaymentStatus(qi, order.qiPaymentId);
  if (!r.ok) {
    console.error("Qi status check failed", r.error);
    return { orderNumber, status: "CREATED", paid: false };
  }
  const result = await finishPayment(order, r.data);
  return { orderNumber, ...result };
}

// ---- Entry ----------------------------------------------------------------------

export const handler = async (event: unknown) => {
  if ((event as UrlEvent)?.requestContext?.http) return qiNotification(event as UrlEvent);
  const field = (event as { info?: { fieldName?: string } })?.info?.fieldName;
  if (field === "qiConfirm") return qiConfirm(event as Parameters<typeof qiConfirm>[0]);
  return placeOrderHandler(event as PlaceOrderEvent);
};
