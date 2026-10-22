import { setDefaultResultOrder } from "node:dns";
import type { AppSyncIdentityCognito } from "aws-lambda";
import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/place-order";
import type { Schema } from "../../data/resource";
import { priceCart, type CartItem } from "../../../lib/order-text";
import { checkDelivery, cleanDelivery } from "../../../lib/validate";
import { buildOrderMessage, sendToTelegram } from "../../../lib/telegram";

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

function orderNumber(): string {
  const t = Date.now().toString(36).slice(-5).toUpperCase();
  const r = Math.random().toString(36).slice(2, 4).toUpperCase();
  return `EL-${t}${r}`;
}

function baghdadTime(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short" }).format(d);
}

export const handler: Schema["placeOrder"]["functionHandler"] = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito | null;
  const phone = await customerPhone(identity);
  if (!identity || !phone) throw new Error("not_signed_in");

  const args = event.arguments;
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

  const owner = `${identity.sub}::${identity.username}`;
  const previous = await client.models.Order.listOrderByOwner({ owner }, { limit: 1, selectionSet: ["id"] });
  const returning = (previous.data?.length ?? 0) > 0;

  const number = orderNumber();
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
    jars: lines.reduce((n, l) => n + l.qty, 0),
    total,
    status: "NEW",
    telegramSent: false,
    owner,
  });
  if (!order || errors?.length) {
    console.error("Saving the order failed", JSON.stringify(errors));
    throw new Error("save_failed");
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
  });
  const telegramSent = await sendToTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, message);
  if (telegramSent) await client.models.Order.update({ id: order.id, telegramSent: true });

  return { id: order.id, orderNumber: number, createdAt: order.createdAt, telegramSent };
};
