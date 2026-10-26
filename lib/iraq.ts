// Iraq's 19 governorates (Halabja became the 19th in 2025).
// Baghdad first, the rest alphabetically.

export const PROVINCES = [
  "بغداد",
  "الأنبار",
  "أربيل",
  "البصرة",
  "بابل",
  "حلبجة",
  "دهوك",
  "ديالى",
  "ذي قار",
  "السليمانية",
  "صلاح الدين",
  "القادسية",
  "كربلاء",
  "كركوك",
  "المثنى",
  "ميسان",
  "النجف",
  "نينوى",
  "واسط",
] as const;

export type Province = (typeof PROVINCES)[number];


export function isProvince(v: string): v is Province {
  return (PROVINCES as readonly string[]).includes(v);
}

// One line for receipts, Telegram and the admin page.
export function fullAddress(o: { province?: string | null; area?: string | null; address: string }): string {
  return [o.province, o.area, o.address].filter(Boolean).join("، ");
}
