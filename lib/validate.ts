// Field rules. Shared by the browser (messages under each field)
// and the placeOrder function (so the rules can't be skipped).

import { normalizeIraqiMobile } from "./phone";
import { isProvince } from "./iraq";

export type Field = "name" | "phone" | "province" | "area" | "address";
export type FieldErrors = Partial<Record<Field, string>>;

export const CODE_LENGTH = 4;

// Wraps numbers inside Arabic text so they keep their left-to-right order
// (without it, "0771 234 5678" shows as "5678 234 0771").
export const ltr = (s: string) => `⁦${s}⁩`;

// Full name: at least two words (first name + father/family name),
// letters only, each word 2+ letters, 4+ letters in total.
export function nameError(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return "اكتبوا الاسم الكامل.";
  if (/[\d٠-٩۰-۹]/.test(name) || !/^[\p{L}\p{M}\s'.-]+$/u.test(name)) return "يجب أن يتكوّن الاسم من حروف فقط.";
  const words = name.split(" ").filter(Boolean);
  const letters = name.replace(/[^\p{L}]/gu, "").length;
  if (words.length < 2 || letters < 4 || words.some((w) => w.replace(/[^\p{L}]/gu, "").length < 2)) {
    return "اكتبوا الاسم الكامل: الاسم الأول واسم الأب أو العائلة.";
  }
  return null;
}

export function phoneError(raw: string): string | null {
  if (!raw.trim()) return "اكتبوا رقم الواتساب.";
  if (!normalizeIraqiMobile(raw)) {
    return "يجب أن يكون الرقم رقم هاتف عراقيًا من 11 خانة يبدأ بـ 07، مثل ⁦0771 234 5678⁩.";
  }
  return null;
}

export function provinceError(raw: string): string | null {
  return isProvince(raw.trim()) ? null : "اختاروا المحافظة.";
}

export function areaError(raw: string): string | null {
  const area = raw.trim();
  if (!area) return "اكتبوا المنطقة أو الحي.";
  if (area.length < 2) return "اكتبوا اسم المنطقة أو الحي كاملًا.";
  return null;
}

export function addressError(raw: string): string | null {
  const address = raw.trim();
  if (!address) return "اكتبوا تفاصيل العنوان.";
  if (address.length < 6) return "اكتبوا تفاصيل العنوان مع أقرب نقطة دالة.";
  return null;
}

export type DeliveryInfo = { name: string; province: string; area: string; address: string };

export function checkDelivery(v: DeliveryInfo): FieldErrors {
  const errors: FieldErrors = {};
  const checks: [Field, string | null][] = [
    ["name", nameError(v.name)],
    ["province", provinceError(v.province)],
    ["area", areaError(v.area)],
    ["address", addressError(v.address)],
  ];
  for (const [field, message] of checks) if (message) errors[field] = message;
  return errors;
}

export function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function cleanDelivery(v: DeliveryInfo): DeliveryInfo {
  return {
    name: cleanName(v.name).slice(0, 80),
    province: v.province.trim(),
    area: v.area.trim().replace(/\s+/g, " ").slice(0, 80),
    address: v.address.trim().slice(0, 400),
  };
}
