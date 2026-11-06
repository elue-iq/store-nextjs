// Delivery periods for orders inside Baghdad (our own couriers). We cannot promise an
// exact time, so the customer picks a day and one of a few evening periods; the choice
// is printed on the courier label and sent to the courier. Plain TypeScript with no
// imports, so it runs in the browser and bundles into the functions.

export const SLOT_PROVINCE = "بغداد";

export type SlotKey = "open" | "eve" | "night";

export const DELIVERY_SLOTS: { key: SlotKey; label: string; range: string; short: string }[] = [
  { key: "open", label: "مفتوح", range: "من 6 مساءً إلى 12 ليلاً", short: "6 مساءً – 12 ليلاً (مفتوح)" },
  { key: "eve", label: "6 – 9 مساءً", range: "من 6 إلى 9 مساءً", short: "6 – 9 مساءً" },
  { key: "night", label: "9 مساءً – 12 ليلاً", range: "من 9 مساءً إلى 12 ليلاً", short: "9 مساءً – 12 ليلاً" },
];

export const DEFAULT_SLOT: SlotKey = "open";
const DAYS_AHEAD = 5; // tomorrow + this many more days can be picked

export const isSlotKey = (k: unknown): k is SlotKey => DELIVERY_SLOTS.some((s) => s.key === k);
export const slotOf = (k: unknown) => DELIVERY_SLOTS.find((s) => s.key === k) ?? DELIVERY_SLOTS[0];

const DAY = 86_400_000;

// Today in Baghdad as YYYY-MM-DD.
export function baghdadToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const addDays = (ymd: string, n: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

// "الجمعة 7/11"
export function dateLabel(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat("ar-IQ", { timeZone: "UTC", weekday: "long" }).format(d);
  return `${weekday} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}

// The days the customer can pick: "earliest" (empty value) and the next few days.
export function slotDateOptions(now: Date = new Date()): { value: string; label: string }[] {
  const today = baghdadToday(now);
  return [
    { value: "", label: "أقرب موعد ممكن" },
    ...Array.from({ length: DAYS_AHEAD }, (_, i) => {
      const v = addDays(today, i + 1);
      return { value: v, label: i === 0 ? `غداً · ${dateLabel(v)}` : dateLabel(v) };
    }),
  ];
}

// A date coming from a client: kept only if it is a real day from today to a week ahead.
export function cleanSlotDate(v: unknown, now: Date = new Date()): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  if (Number.isNaN(Date.parse(`${s}T00:00:00Z`))) return null;
  const today = baghdadToday(now);
  return s >= today && s <= addDays(today, 7) ? s : null;
}

type SlotOrder = { province?: string | null; deliverySlot?: string | null; deliveryDate?: string | null };

// "الجمعة 7/11 · 6 – 9 مساءً" (only for Baghdad orders that have a period).
export function slotText(o: SlotOrder): string | null {
  if (o.province !== SLOT_PROVINCE || !o.deliverySlot) return null;
  const s = slotOf(o.deliverySlot);
  return [o.deliveryDate ? dateLabel(o.deliveryDate) : null, s.short].filter(Boolean).join(" · ");
}

// The two lines printed on the label: the day, then the period.
export function slotLines(o: SlotOrder): string[] {
  if (o.province !== SLOT_PROVINCE || !o.deliverySlot) return [];
  return [o.deliveryDate ? dateLabel(o.deliveryDate) : "أقرب موعد ممكن", slotOf(o.deliverySlot).short];
}
