// The local courier's app (/courier): calls the `courierApp` function.

import { dataClient, errorCode } from "./data";
import type { DispatchOrder } from "./dispatch";

export type CourierOrder = Omit<DispatchOrder, "items"> & {
  items?: ({ slug?: string; nameAr: string; nameEn: string; qty: number; price: number; gift?: boolean | null } | null)[] | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export const ERROR_TEXT: Record<string, string> = {
  not_courier: "هذا الرقم غير مسجّل كمندوب. تواصل مع ÉLUE.",
  not_yours: "هذا الطلب مو مسند إليك. تواصل مع ÉLUE.",
  not_found: "ما لقينا هذا الطلب.",
  cancelled: "الطلب ملغى.",
  already_delivered: "الطلب مسلَّم من قبل.",
  not_signed_in: "انتهت جلسة الدخول. سجّل الدخول مجدداً.",
};

export async function callCourier(args: { action: "mine" | "get" | "status"; orderNumber?: string; status?: "OUT_FOR_DELIVERY" | "DELIVERED" }) {
  try {
    const { data, errors } = await dataClient.mutations.courierApp(args);
    if (errors?.length || !data) return { ok: false as const, code: errorCode(errors) || "failed" };
    // a.json() can arrive double-encoded (a string holding JSON text): decode until it is an object.
    let parsed: unknown = data;
    for (let i = 0; i < 3 && typeof parsed === "string"; i++) parsed = JSON.parse(parsed);
    const body = (parsed ?? {}) as { courier?: string; phone?: string; orders?: CourierOrder[]; order?: CourierOrder };
    return { ok: true as const, ...body };
  } catch (err) {
    console.error("courierApp failed", err);
    return { ok: false as const, code: "failed" };
  }
}

// "EL-0012" from a scanned code or typed text (the label's QR holds the order number).
export function orderNumberFrom(text: string): string | null {
  return text.toUpperCase().match(/\b(?:EL|DEV)-\d{3,6}\b/)?.[0] ?? null;
}
