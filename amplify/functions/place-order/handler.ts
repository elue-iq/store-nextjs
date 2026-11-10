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
import { clientIp, cleanTracking, sendPurchase, type Tracking } from "./meta";
import { sendOrderConfirmation } from "../../../lib/orderConfirmation";
import { pendingReview } from "../../../lib/reviews";
import { createPayment, getPaymentStatus, qiConfig, verifyNotification, type QiPayment } from "../../../lib/qi";
import { GetFunctionUrlConfigCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { BatchGetItemCommand } from "@aws-sdk/client-dynamodb";
import {
  commissionFor,
  couponHint,
  couponLabel,
  couponProblem,
  couponProblemText,
  creditBalance,
  normalizeCode,
  priceOrder,
  type Coupon,
  type CouponKind,
  type CouponRule,
} from "../../../lib/coupons";

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

// ---- Coupons, credit and affiliate campaigns (rules in lib/coupons.ts) ----------

type CampaignRecord = Schema["Campaign"]["type"];

const asCoupon = (c: Schema["Coupon"]["type"]): Coupon => ({ ...c, kind: c.kind as CouponKind });
const ruleOf = (c: Coupon): CouponRule => ({
  code: c.code,
  kind: c.kind,
  value: c.value ?? null,
  maxDiscount: c.maxDiscount ?? null,
  buyQty: c.buyQty ?? null,
  freeQty: c.freeQty ?? null,
  minJars: c.minJars ?? null,
});

async function getCoupon(code: string): Promise<Coupon | null> {
  if (!code) return null;
  const { data } = await client.models.Coupon.get({ code });
  return data ? asCoupon(data) : null;
}

const liveCampaign = (c: CampaignRecord | null | undefined, now = new Date()) =>
  Boolean(c && c.active !== false && (!c.startsAt || now >= new Date(c.startsAt)) && (!c.endsAt || now <= new Date(c.endsAt)));

async function campaignBySlug(slug: string): Promise<CampaignRecord | null> {
  const clean = slug.trim().toLowerCase().slice(0, 40);
  if (!clean) return null;
  const { data } = await client.models.Campaign.list({ filter: { slug: { eq: clean } }, limit: 1000 });
  return (data ?? []).find((c) => liveCampaign(c)) ?? null;
}

async function campaignById(id: string | null | undefined): Promise<CampaignRecord | null> {
  if (!id) return null;
  const { data } = await client.models.Campaign.get({ id });
  return data ?? null;
}

type History = { status: string; couponCode?: string | null; cashback?: number | null; creditUsed?: number | null }[];

// A customer's earlier orders (by WhatsApp number), for coupon limits and credit.
async function historyFor(phone: string): Promise<History> {
  const { data } = await client.models.Order.listOrderByPhone(
    { phone },
    { limit: 500, selectionSet: ["status", "couponCode", "cashback", "creditUsed"] },
  );
  return (data ?? []) as History;
}

// Uses of a coupon by everyone: an atomic counter, refused once maxUses is reached.
async function takeCouponUse(code: string, maxUses: number | null | undefined): Promise<boolean> {
  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: process.env.COUNTERS_TABLE,
        Key: { id: { S: `coupon#${code}` } },
        UpdateExpression: "ADD #n :one",
        ...(maxUses ? { ConditionExpression: "attribute_not_exists(#n) OR #n < :max" } : {}),
        ExpressionAttributeNames: { "#n": "value" },
        ExpressionAttributeValues: { ":one": { N: "1" }, ...(maxUses ? { ":max": { N: String(maxUses) } } : {}) },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

type Deal = {
  coupon: Coupon | null;
  couponError: string | null;
  hint: string | null;
  campaign: CampaignRecord | null;
  credit: number;
};

// Works out which coupon and campaign apply. A typed code wins; otherwise the campaign's
// own coupon (visitor from its link). history = null for a visitor who isn't signed in.
async function findDeal(o: {
  couponCode: string;
  ref: string;
  jars: number;
  phone: string | null;
  history: History | null;
  useCredit: boolean;
}): Promise<Deal> {
  const linkCampaign = o.ref ? await campaignBySlug(o.ref) : null;
  const code = normalizeCode(o.couponCode) || normalizeCode(linkCampaign?.couponCode);
  const coupon = await getCoupon(code);
  const now = new Date();
  let problem = code ? couponProblem(coupon, { now, jars: o.jars }) : null;
  if (!problem && coupon && o.history) {
    const uses = o.history.filter((h) => h.status !== "CANCELLED" && h.couponCode === coupon.code).length;
    const previous = o.history.filter((h) => h.status !== "CANCELLED").length;
    problem = couponProblem(coupon, { now, jars: o.jars, customerUses: uses, previousOrders: previous });
  }
  const usable = coupon && !problem ? coupon : null;
  // The coupon's campaign (code shared by an influencer) counts first; else the link's.
  const couponCampaign = usable?.campaignId ? await campaignById(usable.campaignId) : null;
  const campaign = liveCampaign(couponCampaign) ? couponCampaign : linkCampaign;
  return {
    coupon: usable,
    couponError: code && problem ? couponProblemText(problem, coupon) : null,
    hint: coupon && (!problem || problem === "min_jars") ? couponHint(ruleOf(coupon), o.jars) : null,
    campaign,
    credit: o.useCredit && o.history ? creditBalance(o.history) : 0,
  };
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
  // Optional second phone number.
  const phone2Raw = String(args.phone2 ?? "").trim();
  const phone2 = phone2Raw ? normalizeIraqiMobile(phone2Raw) : null;
  if (phone2Raw && !phone2) throw new Error('invalid_fields:{"phone2":"الرقم الثاني غير صحيح."}');
  // Baghdad: the delivery period and the wanted day (anything else is ignored).
  const inBaghdad = province === SLOT_PROVINCE;
  const deliverySlot = inBaghdad ? (isSlotKey(args.deliverySlot) ? args.deliverySlot : DEFAULT_SLOT) : null;
  const deliveryDate = inBaghdad ? cleanSlotDate(args.deliveryDate) : null;
  const source = String(args.source ?? "").trim().slice(0, 200) || null;
  // Marketing details from the customer's browser (cleaned: never trusted as is).
  const attribution = cleanAttribution(args.attribution);
  const heardFrom = HEARD_KEYS.has(String(args.heardFrom ?? "")) ? String(args.heardFrom) : null;
  const heardNote = heardFrom ? String(args.heardNote ?? "").trim().slice(0, 100) || null : null;
  const tracking = cleanTracking(args.tracking, (event as unknown as { request?: { headers?: Record<string, string> } }).request?.headers, PRODUCTION);

  let rawItems: unknown = args.items;
  if (typeof rawItems === "string") {
    try {
      rawItems = JSON.parse(rawItems);
    } catch {
      rawItems = [];
    }
  }
  const items = Array.isArray(rawItems) ? (rawItems.slice(0, 10) as CartItem[]) : [];
  const { lines } = priceCart(items);

  const fields = checkDelivery({ name, province, area, address });
  if (Object.keys(fields).length) throw new Error(`invalid_fields:${JSON.stringify(fields)}`);
  if (!lines.length) throw new Error("empty_cart");
  const jars = lines.reduce((n, l) => n + l.qty, 0);
  if (!isTeam && jars > ORDER_RULES.maxJarsPerOrder) throw new Error(`too_many_jars:${ORDER_RULES.maxJarsPerOrder}`);
  // Free delivery for larger orders (site.freeDeliveryMinJars jars or more), unless the fee was prepaid.
  if (!deliveryPaid && freeDeliveryFor(jars)) freeDelivery = true;

  // Coupon, credit and affiliate campaign. A code that can't be used stops the order with
  // the reason (the checkout already showed it), so nobody pays more than they expected.
  const history = await historyFor(phone);
  const deal = await findDeal({
    couponCode: String(args.couponCode ?? ""),
    ref: String(args.ref ?? ""),
    jars,
    phone,
    history,
    useCredit: !paid,
  });
  if (deal.couponError && normalizeCode(args.couponCode)) throw new Error(`coupon:${deal.couponError}`);
  const rule = deal.coupon ? ruleOf(deal.coupon) : null;
  const pricing = priceOrder(
    lines.map((l) => ({ price: l.product.price, qty: l.qty })),
    rule,
    deal.credit,
  );
  if (!deliveryPaid && pricing.freeDelivery) freeDelivery = true;
  const sponsor = deal.campaign ? (await client.models.Sponsor.get({ id: deal.campaign.sponsorId })).data : null;
  const selfReferral = Boolean(sponsor?.phone && sponsor.phone === phone);
  const commission = deal.campaign && !selfReferral ? commissionFor(jars, pricing.freeJars, deal.campaign.commissionPerJar) : 0;

  // The team may still take an order for a flavor marked sold out (e.g. stock on the way).
  const soldOut = forCustomer ? new Set<string>() : await unavailableSlugs();
  const missing = lines.filter((l) => soldOut.has(l.product.slug)).map((l) => l.product.slug);
  if (missing.length) throw new Error(`out_of_stock:${missing.join(",")}`);

  const customer = forCustomer ? await ensureCustomer(phone) : null;
  const owner = customer ? customer.owner : `${identity.sub}::${identity.username}`;

  const saveAndNotify = async () => {
    if (deal.coupon && !(await takeCouponUse(deal.coupon.code, deal.coupon.maxUses))) {
      throw new Error(`coupon:${couponProblemText("used_up")}`);
    }
    const number = await nextOrderNumber();
    const total = pricing.total;
    const payAmount = total + (freeDelivery ? 0 : site.deliveryFee);
    const { data: order, errors } = await client.models.Order.create({
      orderNumber: number,
      phone,
      name,
      province,
      area,
      address,
      note,
      phone2: phone2 && phone2 !== phone ? phone2 : null,
      source,
      attribution: attribution ? JSON.stringify(attribution) : null,
      creatorRef: creatorRefOf(attribution),
      // From the Instagram DM flow (ManyChat): the ad id or ref the conversation started from.
      sourceRef: isTeam ? String(args.sourceRef ?? "").trim().slice(0, 100) || null : null,
      heardFrom,
      heardNote,
      capi: isTeam ? null : JSON.stringify(tracking),
      items: lines.map((l) => ({
        slug: l.product.slug,
        nameAr: l.product.nameAr,
        nameEn: l.product.nameEn,
        qty: l.qty,
        price: l.product.price,
      })),
      jars,
      total,
      subtotal: pricing.subtotal,
      discount: pricing.discount || null,
      couponCode: deal.coupon?.code ?? null,
      couponLabel: rule ? couponLabel(rule) : null,
      coupon: rule ? JSON.stringify(rule) : null,
      cashback: pricing.cashback || null,
      creditUsed: pricing.creditUsed || null,
      campaignId: deal.campaign?.id ?? null,
      campaignSlug: deal.campaign?.slug ?? null,
      sponsorId: deal.campaign?.sponsorId ?? null,
      commission: deal.campaign ? commission : null,
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
    // Report the purchase to Meta (website orders only; never blocks the order).
    if (!isTeam) await reportPurchase(order, tracking, Date.parse(order.createdAt) || Date.now());
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

// ---- Marketing: where the order came from, and the Meta purchase -----------------

const HEARD_KEYS = new Set(["ig_ad", "ig_page", "creator", "friend", "whatsapp", "other"]);

// The saved campaign details (utm_*, fbclid, referrer, landing page): plain short strings only.
type CleanTouch = Record<string, string | number | Record<string, string | number>>;

function cleanTouch(a: Record<string, unknown>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, max] of [["utm_source", 80], ["utm_medium", 80], ["utm_campaign", 80], ["utm_content", 80], ["utm_term", 80], ["fbclid", 300], ["ref", 80], ["referrer", 200], ["landing", 300]] as const) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, max);
  }
  if (typeof a.at === "number" && Number.isFinite(a.at)) out.at = a.at;
  return out;
}

function cleanAttribution(raw: unknown): CleanTouch | null {
  let a: Record<string, unknown> = {};
  try {
    a = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return null;
  }
  const out: CleanTouch = cleanTouch(a);
  if (a.first && typeof a.first === "object") {
    const first = cleanTouch(a.first as Record<string, unknown>);
    if (Object.keys(first).length) out.first = first;
  }
  return Object.keys(out).length ? out : null;
}

// The creator behind a ?ref=<creator> link (latest touch, else first touch): a short lowercase slug.
function creatorRefOf(attribution: CleanTouch | null): string | null {
  const first = attribution?.first as Record<string, string> | undefined;
  const raw = String(attribution?.ref ?? first?.ref ?? "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 60);
  return raw || null;
}

// IPv4 -> a.b.c.0, IPv6 -> first three groups: enough to tell networks apart, not people.
function ipPrefix(ip: string | undefined): string {
  if (!ip) return "";
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":") + "::";
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.0` : "";
}

function parseTracking(raw: string | null | undefined): Tracking {
  try {
    return raw ? (JSON.parse(raw) as Tracking) : {};
  } catch {
    return {};
  }
}

// A test order (source has "test=") is never reported to Meta.
const isTestOrder = (o: { source?: string | null }) => /(^|\s|&)test=/.test(o.source ?? "");

// Purchase → Meta Conversions API, with a time limit (the order is already saved).
async function reportPurchase(order: OrderRecord, tracking: Tracking, atMs: number): Promise<void> {
  if (isTestOrder(order)) return;
  await sendPurchase(
    {
      orderNumber: order.orderNumber,
      phone: order.phone,
      name: order.name,
      province: order.province,
      items: (order.items ?? []) as { slug: string; qty: number; price: number }[],
      jars: order.jars,
      total: order.total,
      freeDelivery: order.freeDelivery,
    },
    tracking,
    { production: PRODUCTION, atMs },
  );
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
    phone2: order.phone2 ?? null,
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
    subtotal: order.subtotal ?? null,
    discount: order.discount ?? null,
    creditUsed: order.creditUsed ?? null,
    couponCode: order.couponCode ?? null,
    couponLabel: order.couponLabel ?? null,
    cashback: order.cashback ?? null,
    campaignSlug: order.campaignSlug ?? null,
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
    // The payment is confirmed: this is the purchase (once, thanks to claimPayment).
    if (updated.capi) await reportPurchase(updated, parseTracking(updated.capi), Date.now());
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

// ---- Checkout price, affiliate visits ---------------------------------------------

type QuoteArgs = { items: unknown; couponCode?: string | null; ref?: string | null; province?: string | null; phone?: string | null };

async function quote(event: { identity: unknown; arguments: QuoteArgs }) {
  const identity = event.identity as AppSyncIdentityCognito | null;
  const isTeam = Boolean(identity && (identity.groups ?? []).includes("ADMINS"));
  const phone =
    isTeam && event.arguments.phone
      ? normalizeIraqiMobile(String(event.arguments.phone))
      : isTeam
        ? null
        : identity && "sub" in identity
          ? await customerPhone(identity)
          : null;
  let rawItems: unknown = event.arguments.items;
  if (typeof rawItems === "string") {
    try {
      rawItems = JSON.parse(rawItems);
    } catch {
      rawItems = [];
    }
  }
  const { lines } = priceCart(Array.isArray(rawItems) ? (rawItems.slice(0, 10) as CartItem[]) : []);
  const jars = lines.reduce((n, l) => n + l.qty, 0);
  const history = phone ? await historyFor(phone) : null;
  const deal = await findDeal({
    couponCode: String(event.arguments.couponCode ?? ""),
    ref: String(event.arguments.ref ?? ""),
    jars,
    phone,
    history,
    useCredit: true,
  });
  const rule = deal.coupon ? ruleOf(deal.coupon) : null;
  const p = priceOrder(lines.map((l) => ({ price: l.product.price, qty: l.qty })), rule, deal.credit);
  return JSON.stringify({
    ...p,
    deliveryFee: p.freeDelivery ? 0 : site.deliveryFee,
    pay: p.total + (p.freeDelivery ? 0 : site.deliveryFee),
    credit: deal.credit,
    coupon: deal.coupon
      ? { code: deal.coupon.code, label: couponLabel(rule!), ok: true, hint: deal.hint }
      : normalizeCode(event.arguments.couponCode) || deal.couponError
        ? { code: normalizeCode(event.arguments.couponCode), ok: false, error: deal.couponError, hint: deal.hint }
        : null,
    campaign: deal.campaign ? { slug: deal.campaign.slug } : null,
  });
}

async function campaignVisit(event: { arguments: { ref: string } }) {
  const c = await campaignBySlug(String(event.arguments.ref ?? ""));
  if (!c) return JSON.stringify({ ok: false });
  await dynamo
    .send(
      new UpdateItemCommand({
        TableName: process.env.COUNTERS_TABLE,
        Key: { id: { S: `visit#${c.slug}` } },
        UpdateExpression: "ADD #n :one",
        ExpressionAttributeNames: { "#n": "value" },
        ExpressionAttributeValues: { ":one": { N: "1" } },
      }),
    )
    .catch((err) => console.error("counting the visit failed", err));
  const coupon = await getCoupon(normalizeCode(c.couponCode));
  const usable = coupon && !couponProblem(coupon, { now: new Date(), jars: 99 }) ? coupon : null;
  return JSON.stringify({
    ok: true,
    slug: c.slug,
    endsAt: c.endsAt ?? null,
    coupon: usable ? { code: usable.code, label: couponLabel(ruleOf(usable)) } : null,
  });
}

async function campaignStats(event: { arguments: { slugs: (string | null)[] } }) {
  const slugs = [...new Set((event.arguments.slugs ?? []).filter((s): s is string => Boolean(s)))].slice(0, 100);
  const visits: Record<string, number> = {};
  for (let i = 0; i < slugs.length; i += 100) {
    const chunk = slugs.slice(i, i + 100);
    const r = await dynamo.send(
      new BatchGetItemCommand({
        RequestItems: { [process.env.COUNTERS_TABLE!]: { Keys: chunk.map((s) => ({ id: { S: `visit#${s}` } })) } },
      }),
    );
    for (const item of r.Responses?.[process.env.COUNTERS_TABLE!] ?? []) {
      visits[String(item.id?.S ?? "").replace(/^visit#/, "")] = Number(item.value?.N ?? 0);
    }
  }
  return JSON.stringify({ visits });
}

// ---- Entry ----------------------------------------------------------------------

export const handler = async (event: unknown) => {
  if ((event as UrlEvent)?.requestContext?.http) return qiNotification(event as UrlEvent);
  const field = (event as { info?: { fieldName?: string } })?.info?.fieldName;
  if (field === "qiConfirm") return qiConfirm(event as Parameters<typeof qiConfirm>[0]);
  if (field === "quote") return quote(event as Parameters<typeof quote>[0]);
  if (field === "campaignVisit") return campaignVisit(event as Parameters<typeof campaignVisit>[0]);
  if (field === "campaignStats") return campaignStats(event as Parameters<typeof campaignStats>[0]);
  try {
    return await placeOrderHandler(event as PlaceOrderEvent);
  } catch (err) {
    // Rejected requests: who sent them (browser name and network only, no personal data).
    const msg = err instanceof Error ? err.message : "";
    if (msg.startsWith("invalid_fields") || msg === "not_signed_in") {
      const headers = (event as { request?: { headers?: Record<string, string> } })?.request?.headers;
      let fields = "";
      if (msg.startsWith("invalid_fields:")) {
        try {
          fields = Object.keys(JSON.parse(msg.slice("invalid_fields:".length))).join(",");
        } catch {}
      }
      console.warn(
        "place-order rejected",
        JSON.stringify({
          code: msg.split(":")[0],
          fields,
          ip: ipPrefix(clientIp(headers)),
          ua: String(headers?.["user-agent"] ?? "").slice(0, 200),
          origin: String(headers?.origin ?? headers?.referer ?? "").slice(0, 120),
          signedIn: Boolean((event as { identity?: unknown })?.identity),
        }),
      );
    }
    throw err;
  }
};
