import type { AppSyncIdentityCognito } from "aws-lambda";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/place-order";
import type { Schema } from "../../data/resource";
import { priceCart, type CartItem } from "../../../lib/order-text";
import { checkFields, cleanName } from "../../../lib/validate";
import { buildOrderMessage, sendToTelegram } from "../../../lib/telegram";

// placeOrder: the only way an order is created.
// 1. Checks the customer is logged in (their WhatsApp number comes from the login, not the form).
// 2. Checks name/address and prices the cart from our own product list.
// 3. Saves the order in DynamoDB.            <- the order is safe from here on
// 4. Sends it to the Telegram group (3 tries). If Telegram fails the order is
//    still saved and shows on /admin.

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

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
  const phoneE164 = String(identity?.claims?.phone_number ?? "");
  if (!identity?.sub || !/^\+9647\d{9}$/.test(phoneE164)) throw new Error("not_signed_in");
  const phone = phoneE164.slice(1);

  const args = event.arguments;
  const name = cleanName(String(args.name ?? "")).slice(0, 80);
  const address = String(args.address ?? "").trim().slice(0, 400);
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

  const fields = checkFields({ name, phone, address });
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
    address,
    note,
    source,
    returning,
  });
  const telegramSent = await sendToTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, message);
  if (telegramSent) await client.models.Order.update({ id: order.id, telegramSent: true });

  return { id: order.id, orderNumber: number, createdAt: order.createdAt, telegramSent };
};
