import type { AppSyncIdentityCognito } from "aws-lambda";
import { Amplify } from "aws-amplify";
import { generateClient } from "aws-amplify/data";
import { getAmplifyDataClientConfig } from "@aws-amplify/backend/function/runtime";
import { env } from "$amplify/env/submit-review";
import type { Schema } from "../../data/resource";
import { REVIEW_MAX_COMMENT, firstNameOf, ratingValid } from "../../../lib/reviews";
import { escapeHtml, sendToTelegram } from "../../../lib/telegram";
import { formatIraqiMobile } from "../../../lib/phone";
import { site } from "../../../lib/site";

// submitReview: saves the customer's review of one of THEIR delivered orders.
//   - the order must be theirs, delivered, and not reviewed yet (one review per order);
//   - both ratings 1–5; the note is optional and kept exactly as written (trimmed, length-limited);
//   - the review is created (public, never edited), and the order is marked reviewed,
//     which lets the customer order again.

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: "iam" });

export const handler: Schema["submitReview"]["functionHandler"] = async (event) => {
  const identity = event.identity as AppSyncIdentityCognito | null;
  if (!identity?.sub || !identity.username) throw new Error("not_signed_in");
  const owner = `${identity.sub}::${identity.username}`;

  const { orderNumber, delivery, taste } = event.arguments;
  const comment = String(event.arguments.comment ?? "").trim().slice(0, REVIEW_MAX_COMMENT) || null;
  if (!ratingValid(delivery) || !ratingValid(taste)) throw new Error("invalid_rating");

  const { data: orders } = await client.models.Order.listOrderByOwner({ owner }, { limit: 200 });
  const order = (orders ?? []).find((o) => o.orderNumber === orderNumber);
  if (!order) throw new Error("not_found");
  if (order.status !== "DELIVERED") throw new Error("not_delivered");
  if (order.reviewed) throw new Error("already_reviewed");

  const deliveredBy =
    order.modonQr || order.courierKind === "MODON"
      ? "مدن Express"
      : order.boxyUid || order.courierKind === "BOXY"
        ? "بوكسي"
        : order.courierKind === "LOCAL"
          ? (order.courierName ?? "توصيل محلي")
          : null;

  // The order number is the review's key: a second review of the same order is refused.
  const created = await client.models.Review.create({
    orderNumber: order.orderNumber,
    delivery,
    taste,
    comment,
    firstName: firstNameOf(order.name),
    flavors: (order.items ?? []).filter((i): i is NonNullable<typeof i> => Boolean(i)).map((i) => i.slug ?? "").filter(Boolean),
    jars: order.jars,
    deliveredBy,
    phone: order.phone,
    owner,
  });
  if (created.errors?.length || !created.data) {
    console.error("review create failed", JSON.stringify(created.errors));
    const exists = JSON.stringify(created.errors ?? []).includes("ConditionalCheckFailed");
    throw new Error(exists ? "already_reviewed" : "save_failed");
  }

  const { errors } = await client.models.Order.update({ id: order.id, reviewed: true, reviewedAt: new Date().toISOString() });
  if (errors?.length) console.error("marking the order reviewed failed", JSON.stringify(errors));

  // 3 stars or less: the team hears about it now (live only), to call the customer the same day.
  if (Math.min(delivery, taste) <= 3 && process.env.STAGE === "amplify") {
    const text = [
      `<b>⚠️ تقييم منخفض ${order.orderNumber}</b>`,
      `الطعم ${taste}/5 · التوصيل ${delivery}/5${deliveredBy ? ` (${escapeHtml(deliveredBy)})` : ""}`,
      comment ? `«${escapeHtml(comment)}»` : null,
      `${escapeHtml(order.name)} · <a href="https://wa.me/${order.phone}">${formatIraqiMobile(order.phone)}</a>`,
      `<a href="${site.address}/admin?order=${encodeURIComponent(order.orderNumber)}">فتح الطلب</a>`,
    ]
      .filter(Boolean)
      .join("\n");
    await sendToTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, text).catch((err) => console.error("low-review alert failed", err));
  }

  return JSON.stringify({ ok: true });
};
