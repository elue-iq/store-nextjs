// Iraqi mobile number helpers. Used by both the browser and the API routes.
//
// Accepts what people actually type: 0771 633 5533, 771-633-5533,
// +964 771 633 5533, 00964..., and Arabic-Indic digits (٠٧٧١...).
// Returns the number as 9647XXXXXXXXX (no plus), or null if it isn't
// an Iraqi mobile number.

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => {
    const i = ARABIC_DIGITS.indexOf(d);
    return String(i >= 0 ? i : PERSIAN_DIGITS.indexOf(d));
  });
}

export function normalizeIraqiMobile(input: string): string | null {
  let digits = toLatinDigits(input).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  digits = digits.replace(/\D/g, "");

  if (digits.startsWith("964")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);

  // Iraqi mobile numbers: 7 followed by 9 digits.
  if (!/^7\d{9}$/.test(digits)) return null;
  return `964${digits}`;
}

// 9647716335533 -> 0771 633 5533
export function formatIraqiMobile(normalized: string): string {
  const local = `0${normalized.slice(3)}`;
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}
