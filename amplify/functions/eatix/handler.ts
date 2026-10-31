import { setDefaultResultOrder } from "node:dns";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/eatix";
import type { Schema } from "../../data/resource";
import { cancelOrder, eatixConfig, eatixFields, sendOrder, toEatixOrder } from "../../../lib/eatix";

// Admin actions for Eatix (ADMINS only):
//   send   – push (or push again) an order to Eatix
//   cancel – cancel it at Eatix
// The dev copy never calls Eatix: it only records SIMULATED.

setDefaultResultOrder("ipv4first");

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

const PRODUCTION = process.env.STAGE === "amplify";
const cfg = eatixConfig(env as unknown as Record<string, string>);

export const handler: Schema["eatix"]["functionHandler"] = async (event) => {
  const { action, orderId } = event.arguments;
  if (!orderId) throw new Error("missing_order");
  const { data: o } = await client.models.Order.get({ id: orderId });
  if (!o) throw new Error("not_found");

  if (action === "send") {
    if (o.eatixId && o.eatixStatus === "SENT") throw new Error(`already_sent:${o.eatixId}`);
    const order = toEatixOrder(o as Parameters<typeof toEatixOrder>[0]);
    const r = PRODUCTION ? await sendOrder(cfg, order) : ({ ok: true, eatixId: `DEV${Date.now()}` } as const);
    await client.models.Order.update({ id: o.id, ...eatixFields(r, !PRODUCTION) });
    if (!r.ok) throw new Error(`eatix_send:${r.error === "disabled" ? "الربط مع Eatix غير مفعّل بعد." : r.error}`);
    return { ok: true, eatixId: r.eatixId };
  }

  if (action === "cancel") {
    if (!o.eatixId) throw new Error("not_sent");
    const r = PRODUCTION ? await cancelOrder(cfg, o.eatixId) : ({ ok: true, eatixId: o.eatixId } as const);
    if (!r.ok) throw new Error(`eatix_cancel:${r.error}`);
    await client.models.Order.update({ id: o.id, eatixStatus: "CANCELLED" });
    return { ok: true };
  }

  throw new Error("unknown_action");
};
