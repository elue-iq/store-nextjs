// Gift campaigns on the server: the rules, and the count of gift jars given so far.
//
// The count lives in the counters table and only ever changes inside a transaction:
//   gift#<campaignId>                 value = gift jars taken by live orders
//   giftres#<campaignId>#<orderId>    units = this order's share of that number
// Taking the last jar is one conditional write, so two orders can never both get it.
// An order that is cancelled gives its jars back (its reservation row is deleted and the
// number goes down in the same transaction), and reconcile() catches any order that was
// cancelled without telling us.

import {
  DynamoDBClient,
  GetItemCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
  type TransactWriteItem,
} from "@aws-sdk/client-dynamodb";
import { getProduct } from "../../../lib/products";
import { giftCampaignLive, MANUAL_GIFT, type GiftOffer, type GiftPick } from "../../../lib/gifts";

export type GiftCampaignFields = {
  id: string;
  name?: string | null;
  active?: boolean | null;
  startsAt?: string | null;
  endsAt?: string | null;
  banner?: string | null;
  products?: (string | null)[] | null;
  perOrder?: number | null;
  minPaidJars?: number | null;
  cap?: number | null;
  perPhone?: number | null;
  updatedAt?: string | null;
};

export type GiftRules = {
  id: string;
  name: string;
  banner: string;
  products: string[];
  perOrder: number;
  minPaidJars: number;
  cap: number | null; // null = no limit
  perPhone: number;
  endsAt: string | null;
};

const whole = (v: unknown, fallback: number, min: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min ? n : fallback;
};

export function rulesOf(c: GiftCampaignFields): GiftRules {
  return {
    id: c.id,
    name: c.name ?? "",
    banner: (c.banner ?? "").trim(),
    products: (c.products ?? []).filter((s): s is string => Boolean(s && getProduct(s))),
    perOrder: whole(c.perOrder, 1, 1),
    minPaidJars: whole(c.minPaidJars, 1, 0),
    cap: c.cap == null ? null : whole(c.cap, 0, 0),
    perPhone: whole(c.perPhone, 1, 1),
    endsAt: c.endsAt ?? null,
  };
}

// The one live campaign (switched on, inside its dates). With several, the latest change wins.
export function pickLive<T extends GiftCampaignFields>(all: T[], now = new Date()): T | null {
  return (
    all
      .filter((c) => giftCampaignLive(c, now))
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))[0] ?? null
  );
}

export const offerOf = (r: GiftRules): GiftOffer => ({
  id: r.id,
  banner: r.banner,
  products: r.products,
  perOrder: r.perOrder,
  minPaidJars: r.minPaidJars,
  endsAt: r.endsAt,
});

export type GiftProblem = "ended" | "changed" | "product" | "qty" | "min_jars" | "limit";

// Checks the picked gift jars against the campaign (everything but the total cap, which is
// taken atomically). phoneUses = this phone's earlier live orders with this campaign's gift.
export function giftProblem(
  r: GiftRules,
  o: { picks: GiftPick[]; paidJars: number; phoneUses: number },
): GiftProblem | null {
  const units = o.picks.reduce((n, p) => n + p.qty, 0);
  if (o.picks.some((p) => !r.products.includes(p.slug))) return "product";
  if (units > r.perOrder) return "qty";
  if (o.paidJars < r.minPaidJars) return "min_jars";
  if (o.phoneUses >= r.perPhone) return "limit";
  return null;
}

// ---- The count ---------------------------------------------------------------------

const table = () => process.env.COUNTERS_TABLE!;
const counterId = (campaignId: string) => `gift#${campaignId}`;
const reservationId = (campaignId: string, orderId: string) => `giftres#${campaignId}#${orderId}`;

export const countsAgainstCap = (campaignId: string | null | undefined): campaignId is string =>
  Boolean(campaignId) && campaignId !== MANUAL_GIFT;

export async function giftsUsed(dynamo: DynamoDBClient, campaignId: string): Promise<number> {
  const r = await dynamo.send(new GetItemCommand({ TableName: table(), Key: { id: { S: counterId(campaignId) } }, ConsistentRead: true }));
  return Math.max(0, Number(r.Item?.value?.N ?? 0));
}

async function reservedUnits(dynamo: DynamoDBClient, campaignId: string, orderId: string): Promise<number> {
  const r = await dynamo.send(
    new GetItemCommand({ TableName: table(), Key: { id: { S: reservationId(campaignId, orderId) } }, ConsistentRead: true }),
  );
  return Math.max(0, Number(r.Item?.units?.N ?? 0));
}

// Sets how many of the campaign's gift jars this order holds (0 = gives them all back).
// One transaction: the campaign's number and the order's reservation change together or
// not at all. Returns false when the cap has no room for the extra jars.
export async function setGiftUnits(
  dynamo: DynamoDBClient,
  campaignId: string,
  orderId: string,
  units: number,
  cap: number | null,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await reservedUnits(dynamo, campaignId, orderId);
    const delta = units - current;
    if (delta === 0) return true;
    if (delta > 0 && cap != null && delta > cap) return false;
    const guard = delta > 0 && cap != null;
    const counter: TransactWriteItem = {
      Update: {
        TableName: table(),
        Key: { id: { S: counterId(campaignId) } },
        UpdateExpression: "ADD #n :d",
        ...(guard ? { ConditionExpression: "attribute_not_exists(#n) OR #n <= :room" } : {}),
        ExpressionAttributeNames: { "#n": "value" },
        ExpressionAttributeValues: { ":d": { N: String(delta) }, ...(guard ? { ":room": { N: String(cap! - delta) } } : {}) },
      },
    };
    const key = { id: { S: reservationId(campaignId, orderId) } };
    const reservation: TransactWriteItem =
      current === 0
        ? {
            Put: {
              TableName: table(),
              Item: { ...key, units: { N: String(units) }, at: { N: String(Date.now()) } },
              ConditionExpression: "attribute_not_exists(id)",
            },
          }
        : units === 0
          ? {
              Delete: {
                TableName: table(),
                Key: key,
                ConditionExpression: "#u = :cur",
                ExpressionAttributeNames: { "#u": "units" },
                ExpressionAttributeValues: { ":cur": { N: String(current) } },
              },
            }
          : {
              Update: {
                TableName: table(),
                Key: key,
                UpdateExpression: "SET #u = :new",
                ConditionExpression: "#u = :cur",
                ExpressionAttributeNames: { "#u": "units" },
                ExpressionAttributeValues: { ":new": { N: String(units) }, ":cur": { N: String(current) } },
              },
            };
    try {
      await dynamo.send(new TransactWriteItemsCommand({ TransactItems: [counter, reservation] }));
      return true;
    } catch (err) {
      if (!(err instanceof TransactionCanceledException)) throw err;
      const [counterReason, reservationReason] = err.CancellationReasons ?? [];
      // No room under the cap: a definite no.
      if (counterReason?.Code === "ConditionalCheckFailed") return false;
      // The reservation changed under us (two requests for the same order): read it again.
      if (reservationReason?.Code === "ConditionalCheckFailed" || counterReason?.Code === "TransactionConflict" || reservationReason?.Code === "TransactionConflict") continue;
      throw err;
    }
  }
  return false;
}

type Reservation = { orderId: string; units: number; at: number };

export async function reservations(dynamo: DynamoDBClient, campaignId: string): Promise<Reservation[]> {
  const prefix = `giftres#${campaignId}#`;
  const out: Reservation[] = [];
  let start: Record<string, { S: string }> | undefined;
  do {
    const r = await dynamo.send(
      new ScanCommand({
        TableName: table(),
        FilterExpression: "begins_with(id, :p)",
        ExpressionAttributeValues: { ":p": { S: prefix } },
        ExclusiveStartKey: start,
        ConsistentRead: true,
      }),
    );
    for (const item of r.Items ?? []) {
      out.push({ orderId: String(item.id?.S ?? "").slice(prefix.length), units: Number(item.units?.N ?? 0), at: Number(item.at?.N ?? 0) });
    }
    start = r.LastEvaluatedKey as typeof start;
  } while (start);
  return out;
}

// Gives back the jars of orders that no longer hold the campaign's gift (cancelled, the gift
// removed, or an order that was never saved). loadOrder returns null for an unknown order.
// Returns how many jars came back.
export async function reconcileGifts(
  dynamo: DynamoDBClient,
  campaignId: string,
  loadOrder: (id: string) => Promise<{ status: string; giftCampaignId?: string | null; giftUnits?: number | null } | null>,
): Promise<number> {
  let released = 0;
  for (const r of await reservations(dynamo, campaignId)) {
    const order = await loadOrder(r.orderId);
    // An order being saved right now has its reservation but no row yet: leave young ones alone.
    if (!order && Date.now() - r.at < 5 * 60_000) continue;
    const holds = order && order.status !== "CANCELLED" && order.giftCampaignId === campaignId ? Number(order.giftUnits ?? 0) : 0;
    if (holds >= r.units) continue;
    if (await setGiftUnits(dynamo, campaignId, r.orderId, holds, null)) released += r.units - holds;
  }
  return released;
}
