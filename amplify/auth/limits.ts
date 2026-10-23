// Login abuse limits, shared by create-auth-challenge and verify-auth-challenge.
// Counters live in one small DynamoDB table and delete themselves (TTL).
//
// Why: every code is a paid WhatsApp message, and a 4-digit code can be guessed
// if someone may try forever. So:
//   - one number: at most 5 codes an hour and 10 a day
//   - all numbers together: at most 300 codes an hour (caps the cost of an attack)
//   - one number: 10 wrong codes in a day locks it until the next day (Baghdad time)

import { ConditionalCheckFailedException, DynamoDBClient, GetItemCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";

export const LIMITS = {
  codesPerNumberPerHour: 5,
  codesPerNumberPerDay: 10,
  codesPerHourAllNumbers: 300,
  wrongCodesPerNumberPerDay: 10,
};

const db = new DynamoDBClient({});
const TABLE = process.env.LIMITS_TABLE ?? "";

// Baghdad calendar day and hour, e.g. "2026-10-23" and "2026-10-23T14".
function baghdad(): { day: string; hour: string } {
  const s = new Date(Date.now() + 3 * 3600_000).toISOString();
  return { day: s.slice(0, 10), hour: s.slice(0, 13) };
}

const ttl = (seconds: number) => String(Math.floor(Date.now() / 1000) + seconds);

// Adds 1 to a counter unless it already reached `limit`. false = over the limit.
async function take(id: string, limit: number, keepSeconds: number): Promise<boolean> {
  try {
    await db.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: { id: { S: id } },
        UpdateExpression: "ADD #n :one SET #e = if_not_exists(#e, :exp)",
        ConditionExpression: "attribute_not_exists(#n) OR #n < :limit",
        ExpressionAttributeNames: { "#n": "count", "#e": "expires" },
        ExpressionAttributeValues: { ":one": { N: "1" }, ":limit": { N: String(limit) }, ":exp": { N: ttl(keepSeconds) } },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

async function read(id: string): Promise<number> {
  const res = await db.send(new GetItemCommand({ TableName: TABLE, Key: { id: { S: id } }, ConsistentRead: true }));
  return Number(res.Item?.count?.N ?? "0");
}

const failKey = (phone: string) => `fail#${phone}#${baghdad().day}`;

export async function isLocked(phone: string): Promise<boolean> {
  return (await read(failKey(phone))) >= LIMITS.wrongCodesPerNumberPerDay;
}

export async function recordWrongCode(phone: string): Promise<void> {
  await take(failKey(phone), Number.MAX_SAFE_INTEGER, 2 * 86400);
}

// Before sending a new code. Throws "locked" or "rate_limited" (shown to the customer).
export async function allowNewCode(phone: string): Promise<void> {
  if (await isLocked(phone)) throw new Error("locked");
  const { day, hour } = baghdad();
  if (!(await take(`otp#${phone}#${hour}`, LIMITS.codesPerNumberPerHour, 2 * 3600))) throw new Error("rate_limited");
  if (!(await take(`otp#${phone}#${day}`, LIMITS.codesPerNumberPerDay, 2 * 86400))) throw new Error("rate_limited");
  if (!(await take(`otp#all#${hour}`, LIMITS.codesPerHourAllNumbers, 2 * 3600))) {
    console.error("ALERT: hourly WhatsApp code cap reached for all numbers");
    throw new Error("rate_limited");
  }
}
