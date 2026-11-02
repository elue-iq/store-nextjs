import { setDefaultResultOrder } from "node:dns";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/eatix";
import type { Schema } from "../../data/resource";
import { cancelOrder, eatixConfig, eatixFields, browse, probe, sendOrder, toEatixOrder } from "../../../lib/eatix";

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

  // Diagnostic (ADMINS only, creates nothing): which store / channel values does Eatix accept?
  if (action === "probe") {
    const shops = [cfg.shopCode, "2615781743"];
    const channels = [cfg.channel, "a0daadb32b774ffca81a7f5481bdd8ba", "ELUE", "2615781743"];
    const results: Record<string, unknown> = {};
    for (const shop of shops) {
      for (const ch of channels) {
        results[`shop=${shop} channel=${ch}`] = await probe(cfg, shop, ch);
        await new Promise((r) => setTimeout(r, 1200)); // Eatix answers "open_018: do not operate frequently" to bursts
      }
    }
    return results;
  }

  // Diagnostic (ADMINS only, read-only paths): where does Eatix keep the menu / item ids?
  if (action === "browse") {
    const paths = ["/open/item/v1/list", "/open/item/v1/get", "/open/menu/v1/get", "/open/menu/v1/list", "/open/shop/v1/item/list", "/open/shop/v1/menu", "/open/goods/v1/list", "/open/category/v1/list", "/open/shop/v1/category/list", "/open/item/v1/query"];
    const results: Record<string, unknown> = {};
    // orderId may carry a JSON list of extra request bodies for /open/item/v1/get (paging etc.).
    let bodies: Record<string, unknown>[] | null = null;
    try {
      bodies = orderId ? (JSON.parse(orderId) as Record<string, unknown>[]) : null;
    } catch {
      bodies = null;
    }
    if (bodies) {
      for (const [i, b] of bodies.entries()) {
        results[`get#${i} ${JSON.stringify(b)}`] = await browse(cfg, "/open/item/v1/get", b);
        await new Promise((r) => setTimeout(r, 1200));
      }
      return results;
    }
    for (const path of paths) {
      results[path] = await browse(cfg, path);
      await new Promise((r) => setTimeout(r, 1200));
    }
    return results;
  }

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
