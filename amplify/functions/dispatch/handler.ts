import { setDefaultResultOrder } from "node:dns";
import type { AppSyncIdentityCognito } from "aws-lambda";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/dispatch";
import type { Schema } from "../../data/resource";
import { courierCancelHtml, courierHtml, issueHtml, type DispatchOrder } from "../../../lib/dispatch";
import { telegramSend } from "../../../lib/telegram";

// Local couriers on Telegram (ADMINS only):
//   bot        – the bot's @name (to show which bot to add to a courier's channel)
//   test       – send a test message to a chat id (checks the id and the bot's rights)
//   assign     – give the order to a courier and send it to their chat
//   resend     – send it again (e.g. after a failure)
//   unassign   – take it back (the courier is told not to deliver it)
//   cancel_notice – the order was cancelled: tell the courier it had been sent to
//   report     – send a delivery problem report to the order's courier chat
// The dev copy sends for real, but every order message is marked as a test.

setDefaultResultOrder("ipv4first");

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

const PRODUCTION = process.env.STAGE === "amplify";
const token = env.TELEGRAM_BOT_TOKEN;

type Order = Schema["Order"]["type"];

async function loadOrder(orderId: string | null | undefined): Promise<Order> {
  if (!orderId) throw new Error("missing_order");
  const { data } = await client.models.Order.get({ id: orderId });
  if (!data) throw new Error("not_found");
  return data;
}

async function loadCourier(id: string | null | undefined) {
  if (!id) throw new Error("missing_courier");
  const { data } = await client.models.Courier.get({ id });
  if (!data) throw new Error("courier_not_found");
  return data;
}

const asDispatch = (o: Order): DispatchOrder => o as unknown as DispatchOrder;

// Saves the outcome of a send on the order.
async function saveSend(o: Order, courier: { id: string; name: string }, res: { ok: true } | { ok: false; error: string }) {
  const { errors } = await client.models.Order.update({
    id: o.id,
    courierKind: "LOCAL",
    courierId: courier.id,
    courierName: courier.name,
    courierSentAt: res.ok ? new Date().toISOString() : o.courierSentAt ?? null,
    courierStatus: res.ok ? "SENT" : "FAILED",
    courierError: res.ok ? null : res.error,
  });
  if (errors?.length) console.error("saving the courier result failed", JSON.stringify(errors));
}

function issueList(o: Order): unknown[] {
  let list: unknown = o.issues;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  return Array.isArray(list) ? list : [];
}

export const handler: Schema["dispatch"]["functionHandler"] = async (event) => {
  const { action, orderId, courierId, chatId, kind, text } = event.arguments;
  const identity = event.identity as AppSyncIdentityCognito | null;
  const by = String(identity?.claims?.phone_number ?? identity?.username ?? "").replace(/^\+/, "");

  if (action === "bot") {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(6_000) });
      const body = (await res.json()) as { ok?: boolean; result?: { username?: string } };
      return { username: body.result?.username ?? null };
    } catch {
      return { username: null };
    }
  }

  if (action === "test") {
    if (!chatId) throw new Error("missing_chat");
    const label = PRODUCTION ? "" : "🧪 نسخة تجريبية\n";
    const res = await telegramSend(token, chatId.trim(), `${label}✅ <b>تجربة من ÉLUE</b>\nهذه القناة جاهزة لاستلام طلبات التوصيل وبلاغات المشاكل.`);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  const o = await loadOrder(orderId);

  if (action === "assign") {
    const courier = await loadCourier(courierId);
    if (courier.active === false) throw new Error("courier_inactive");
    if (o.modonQr) throw new Error(`already_modon:${o.modonQr}`);
    if (o.status === "CANCELLED") throw new Error("cancelled");
    // Given to another courier who already has it: tell them to drop it.
    if (o.courierKind === "LOCAL" && o.courierId && o.courierId !== courier.id && o.courierStatus === "SENT") {
      const prev = (await client.models.Courier.get({ id: o.courierId })).data;
      if (prev) await telegramSend(token, prev.telegramChatId, courierCancelHtml(o, "reassigned"));
    }
    const res = await telegramSend(token, courier.telegramChatId, courierHtml(asDispatch(o), !PRODUCTION));
    await saveSend(o, courier, res);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  if (action === "resend") {
    if (o.courierKind !== "LOCAL") throw new Error("not_assigned");
    const courier = await loadCourier(o.courierId);
    if (o.status === "CANCELLED") throw new Error("cancelled");
    const res = await telegramSend(token, courier.telegramChatId, courierHtml(asDispatch(o), !PRODUCTION));
    await saveSend(o, courier, res);
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  if (action === "unassign" || action === "cancel_notice") {
    let told = false;
    if (o.courierKind === "LOCAL" && o.courierId && o.courierStatus === "SENT") {
      const courier = (await client.models.Courier.get({ id: o.courierId })).data;
      if (courier) {
        const res = await telegramSend(token, courier.telegramChatId, courierCancelHtml(o, action === "unassign" ? "withdrawn" : "cancelled"));
        told = res.ok;
        if (!res.ok) console.error("cancel notice failed", res.error);
      }
    }
    if (action === "unassign") {
      await client.models.Order.update({
        id: o.id,
        courierKind: null,
        courierId: null,
        courierName: null,
        courierSentAt: null,
        courierStatus: null,
        courierError: null,
      });
    }
    return { ok: true, told };
  }

  if (action === "report") {
    if (o.courierKind !== "LOCAL" || !o.courierId) throw new Error("not_assigned");
    if (!kind) throw new Error("missing_kind");
    const courier = await loadCourier(o.courierId);
    const res = await telegramSend(token, courier.telegramChatId, issueHtml(asDispatch(o), kind, text ?? "", courier.name));
    const entry = { at: new Date().toISOString(), by, kind, text: (text ?? "").trim().slice(0, 500), to: courier.name, via: "telegram", ok: res.ok };
    await client.models.Order.update({ id: o.id, issues: [...issueList(o), entry].slice(-30) });
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  throw new Error("unknown_action");
};
