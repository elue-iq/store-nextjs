import type { AppSyncIdentityCognito } from "aws-lambda";
import { AdminGetUserCommand, CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/courier-app";
import type { Schema } from "../../data/resource";

// courierApp: what a local courier can do, and nothing more.
//   mine    – their orders (open ones, and those delivered in the last 2 days)
//   get     – one order by number (the QR code on the label), only if it is theirs
//   status  – OUT_FOR_DELIVERY or DELIVERED for an order that is theirs
// The caller is a courier only if their login's WhatsApp number is on an active Courier.
// Only the fields a courier needs are returned (no payment details).

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });
const cognito = new CognitoIdentityProviderClient({});

type Order = Schema["Order"]["type"];

async function callerPhone(identity: AppSyncIdentityCognito | null): Promise<string | null> {
  if (!identity?.sub || !identity.username) return null;
  const fromToken = String(identity.claims?.phone_number ?? "");
  if (/^\+9647\d{9}$/.test(fromToken)) return fromToken.slice(1);
  try {
    const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: identity.username }));
    const phone = user.UserAttributes?.find((a) => a.Name === "phone_number")?.Value ?? "";
    return /^\+9647\d{9}$/.test(phone) ? phone.slice(1) : null;
  } catch (err) {
    console.error("phone lookup failed", err);
    return null;
  }
}

async function findCourier(phone: string) {
  const { data } = await client.models.Courier.list({ limit: 200 });
  return (data ?? []).find((c) => c.active !== false && (c.phone ?? "").replace(/\D/g, "") === phone) ?? null;
}

// The fields shown to a courier.
const view = (o: Order) => ({
  orderNumber: o.orderNumber,
  name: o.name,
  phone: o.phone,
  province: o.province,
  area: o.area,
  address: o.address,
  note: o.note,
  items: o.items,
  jars: o.jars,
  total: o.total,
  paid: o.paid,
  freeDelivery: o.freeDelivery,
  deliveryPaid: o.deliveryPaid,
  status: o.status,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
});

async function findOrder(orderNumber: string): Promise<Order | null> {
  let nextToken: string | null | undefined;
  do {
    const res = await client.models.Order.list({ filter: { orderNumber: { eq: orderNumber } }, limit: 1000, nextToken });
    if (res.data?.length) return res.data[0];
    nextToken = res.nextToken;
  } while (nextToken);
  return null;
}

export const handler: Schema["courierApp"]["functionHandler"] = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito | null;
  const phone = await callerPhone(identity);
  if (!phone) throw new Error("not_signed_in");
  const courier = await findCourier(phone);
  if (!courier) throw new Error("not_courier");
  const { action, status } = event.arguments;
  const orderNumber = String(event.arguments.orderNumber ?? "").trim().toUpperCase();

  if (action === "mine") {
    const orders: Order[] = [];
    let nextToken: string | null | undefined;
    do {
      const res = await client.models.Order.list({ filter: { courierId: { eq: courier.id } }, limit: 1000, nextToken });
      orders.push(...(res.data ?? []));
      nextToken = res.nextToken;
    } while (nextToken);
    const since = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    const shown = orders
      .filter((o) => o.courierKind === "LOCAL" && o.status !== "CANCELLED" && (o.status !== "DELIVERED" || o.updatedAt > since))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    console.log(`courierApp mine: ${courier.name} (${phone}) has ${orders.length} assigned, showing ${shown.length}`);
    return { courier: courier.name, phone, orders: shown.map(view) };
  }

  if (!orderNumber) throw new Error("missing_order");
  const o = await findOrder(orderNumber);
  if (!o) throw new Error("not_found");

  if (action === "get") return { order: view(o) };

  if (action === "status") {
    if (status !== "OUT_FOR_DELIVERY" && status !== "DELIVERED") throw new Error("bad_status");
    if (o.status === "CANCELLED") throw new Error("cancelled");
    if (o.status === "DELIVERED") throw new Error("already_delivered");
    if (status === o.status) return { order: view(o) };
    const { data, errors } = await client.models.Order.update({
      id: o.id,
      status,
      editedBy: `courier:${courier.name}`,
      editedAt: new Date().toISOString(),
      trackStatus: status === "DELIVERED" ? "تم التوصيل" : "المندوب في الطريق إليك",
    });
    if (errors?.length || !data) {
      console.error("courier status failed", JSON.stringify(errors));
      throw new Error("save_failed");
    }
    return { order: view(data) };
  }

  throw new Error("bad_action");
}
