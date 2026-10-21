// Checkout field rules. Shared by the browser (messages under each field)
// and the place-order API (so the rules can't be skipped).

import { normalizeIraqiMobile } from "./phone";

export type Field = "name" | "phone" | "address";
export type FieldErrors = Partial<Record<Field, string>>;

export const CODE_LENGTH = 4;

// Wraps numbers inside Arabic text so they keep their left-to-right order
// (without it, "0771 234 5678" shows as "5678 234 0771").
export const ltr = (s: string) => `\u2066${s}\u2069`;

// Full name: at least two words (first name + father/family name),
// letters only, each word 2+ letters, 4+ letters in total.
export function nameError(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return "اكتبوا الاسم الكامل.";
  if (/[\d٠-٩۰-۹]/.test(name) || !/^[\p{L}\p{M}\s'.-]+$/u.test(name)) return "الاسم يتكون من حروف فقط.";
  const words = name.split(" ").filter(Boolean);
  const letters = name.replace(/[^\p{L}]/gu, "").length;
  if (words.length < 2 || letters < 4 || words.some((w) => w.replace(/[^\p{L}]/gu, "").length < 2)) {
    return "اكتبوا الاسم الكامل: الاسم الأول واسم الأب أو العائلة.";
  }
  return null;
}

export function phoneError(raw: string): string | null {
  if (!raw.trim()) return "اكتبوا رقم الواتساب.";
  if (!normalizeIraqiMobile(raw)) return "الرقم لازم يكون موبايل عراقي من 11 رقم يبدأ بـ 07، مثل \u20660771 234 5678\u2069.";
  return null;
}

export function addressError(raw: string): string | null {
  const address = raw.trim();
  if (!address) return "اكتبوا العنوان.";
  if (address.length < 8) return "اكتبوا العنوان بالتفصيل مع أقرب نقطة دالة.";
  return null;
}

export function checkFields(v: { name: string; phone: string; address: string }): FieldErrors {
  const errors: FieldErrors = {};
  const n = nameError(v.name);
  const p = phoneError(v.phone);
  const a = addressError(v.address);
  if (n) errors.name = n;
  if (p) errors.phone = p;
  if (a) errors.address = a;
  return errors;
}

export function cleanName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}
