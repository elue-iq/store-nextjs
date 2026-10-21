// Browser data client for orders (AWS AppSync + DynamoDB).
// Created once at module scope, as Amplify recommends.

import { generateClient } from "aws-amplify/data";
import type { Schema } from "@/amplify/data/resource";

export const dataClient = generateClient<Schema>({ authMode: "userPool" });

export type Order = Schema["Order"]["type"];
export type OrderStatus = NonNullable<Order["status"]>;

export const STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: "جديد",
  CONFIRMED: "مؤكَّد",
  OUT_FOR_DELIVERY: "قيد التوصيل",
  DELIVERED: "تم التوصيل",
  CANCELLED: "ملغى",
};

export const STATUS_ORDER: OrderStatus[] = ["NEW", "CONFIRMED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

export function baghdadTime(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso),
  );
}

export function newestFirst(a: { createdAt: string }, b: { createdAt: string }) {
  return b.createdAt.localeCompare(a.createdAt);
}

// GraphQL errors from placeOrder come back as plain messages like
// "invalid_fields:{...}" or "empty_cart".
export function errorCode(errors: { message?: string }[] | undefined | null): string {
  const message = errors?.[0]?.message ?? "";
  return message.split(":")[0].trim();
}

export function errorFields(errors: { message?: string }[] | undefined | null): Record<string, string> {
  const message = errors?.[0]?.message ?? "";
  const i = message.indexOf("invalid_fields:");
  if (i < 0) return {};
  try {
    return JSON.parse(message.slice(i + "invalid_fields:".length));
  } catch {
    return {};
  }
}
