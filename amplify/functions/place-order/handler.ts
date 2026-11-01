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
import { needsPayRef, site } from "../../../lib/site";
import { pendingReview } from "../../../lib/reviews";

// placeOrder: the only way an order is created.
// 1. Checks the customer is logged in (their WhatsApp number comes from the login, not the form).
// 2. Checks name/address and prices the cart from our own product list.
// 3. Saves the order in DynamoDB.            <- the order is safe from here on
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
    { limit: 200, selectionSet: ["orderNumber", "status", "createdAt", "reviewed"] },
  );
  const orders = data ?? [];
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

export const handler: Schema["placeOrder"]["functionHandler"] = async (event) => {
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
  const freeDelivery = isTeam && !deliveryPaid ? Boolean(args.freeDelivery) : false;
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
  const { name, province, area, address } = cleanDelivery({
    name: String(args.name ?? ""),
    province: String(args.province ?? ""),
    area: String(args.area ?? ""),
    address: String(args.address ?? ""),
  });
  const note = String(args.note ?? "").trim().slice(0, 400) || null;
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

  // The team may still take an order for a flavor marked sold out (e.g. stock on the way).
  const soldOut = forCustomer ? new Set<string>() : await unavailableSlugs();
  const missing = lines.filter((l) => soldOut.has(l.product.slug)).map((l) => l.product.slug);
  if (missing.length) throw new Error(`out_of_stock:${missing.join(",")}`);

  const customer = forCustomer ? await ensureCustomer(phone) : null;
  const owner = customer ? customer.owner : `${identity.sub}::${identity.username}`;

  const saveAndNotify = async () => {
    const previous = await client.models.Order.listOrderByPhone({ phone }, { limit: 1, selectionSet: ["id"] });
    const returning = (previous.data?.length ?? 0) > 0;

    const number = await nextOrderNumber();
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
      slotAccepted,
      createdBy: forCustomer ? callerPhone : null,
      owner,
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

    const message = buildOrderMessage({
      orderNumber: number,
      time: baghdadTime(new Date(order.createdAt)),
      lines,
      total,
      name,
      phone,
      province,
      area,
      address,
      note,
      source,
      returning,
      createdBy: forCustomer ? callerPhone : null,
      cashierOrderId,
      paid,
      paidNote,
      payMethod,
      payRef,
      freeDelivery,
      deliveryPaid,
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

    return { id: order.id, orderNumber: number, createdAt: order.createdAt, telegramSent };
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
};
