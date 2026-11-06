import { products } from "./products";
import { PROVINCES, isProvince } from "./iraq";
import { nameError, areaError, addressError, phoneError } from "./validate";
import { normalizeIraqiMobile } from "./phone";
import { priceCart } from "./order-text";
import { freeDeliveryFor, site } from "./site";

// The order conversation in Instagram DMs, as a small state machine. ManyChat only forwards
// what the customer wrote (or tapped) and shows what we answer; everything else lives here.
// Pure: no network, so it can be tested alone.

export type Step =
  | { at: "qty"; i: number }
  | { at: "name" | "phone" | "province" | "province_other" | "area" | "address" | "confirm" };

export type ChatState = {
  step: Step;
  qty: Record<string, number>;
  name?: string;
  phone?: string;
  province?: string;
  area?: string;
  address?: string;
};

export type Reply = {
  text: string;
  quick?: string[]; // quick-reply captions
};

export type Turn = {
  state: ChatState | null; // null: conversation finished or cancelled
  replies: Reply[];
  place?: { name: string; phone: string; province: string; area: string; address: string; items: { slug: string; qty: number }[] };
};

const START = /(^|\s)(اطلب|اطلبو|طلب|ابي اطلب|اريد اطلب|اريد اطلبو|order)(\s|$)/i;
const CANCEL = /^(إلغاء|الغاء|الغي|ألغي|cancel)$/i;
const digits = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));

const norm = (s: string) => s.replace(/[أإآ]/g, "ا").replace(/ى/g, "ي");
export const isStart = (text: string) => START.test(norm(text.trim()));

const label = (i: number) => products[i].nameAr;
const askQty = (i: number): Reply => ({
  text: `كم علبة تريدون من ${label(i)}؟`,
  quick: ["0", "1", "2", "3", "4"],
});

export const begin = (): Turn => ({
  state: { step: { at: "qty", i: 0 }, qty: {} },
  replies: [{ text: "أهلاً بيكم في ÉLUE 🤎 نسجّل طلبكم بخطوات سريعة. تقدرون تكتبون «إلغاء» بأي وقت." }, askQty(0)],
});

export const notStarted = (): Turn => ({
  state: null,
  replies: [{ text: "لتسجيل طلب اكتبوا «اطلب»، أو اكتبوا «أحچي ويا الفريق» ويرد عليكم واحد منا.", quick: ["اطلب"] }],
});

function summary(s: ChatState): string {
  const items = products.map((p) => ({ slug: p.slug, qty: s.qty[p.slug] ?? 0 })).filter((i) => i.qty);
  const { lines, total } = priceCart(items);
  const jars = lines.reduce((n, l) => n + l.qty, 0);
  const free = freeDeliveryFor(jars);
  const fmt = (n: number) => n.toLocaleString("en-US");
  return [
    "ملخص طلبكم:",
    ...lines.map((l) => `• ${l.product.nameAr} × ${l.qty}`),
    `المبلغ: ${fmt(total)} دينار${free ? " والتوصيل مجاني" : ` + ${fmt(site.deliveryFee)} توصيل`}`,
    `الاسم: ${s.name}`,
    `الهاتف: ${s.phone}`,
    `العنوان: ${s.province} - ${s.area} - ${s.address}`,
  ].join("\n");
}

function matchProvince(raw: string): string | null {
  const t = raw.trim();
  if (isProvince(t)) return t;
  const norm = (x: string) => x.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, "");
  const n = norm(t);
  if (n.length < 2) return null;
  return PROVINCES.find((p) => norm(p) === n) ?? PROVINCES.find((p) => norm(p).includes(n) || n.includes(norm(p))) ?? null;
}

export function next(state: ChatState, input: string): Turn {
  const text = input.trim();
  if (CANCEL.test(text)) {
    return { state: null, replies: [{ text: "تم إلغاء الطلب. إذا تحتاجون شي اكتبوا «اطلب» أو «أحچي ويا الفريق»." }] };
  }
  const s: ChatState = { ...state, qty: { ...state.qty } };
  const again = (reply: Reply, prefix?: string): Turn => ({
    state: s,
    replies: [prefix ? { text: prefix } : null, reply].filter((r): r is Reply => Boolean(r)),
  });

  switch (s.step.at) {
    case "qty": {
      const i = s.step.i;
      const n = Number(digits(text));
      if (!/^\d{1,2}$/.test(digits(text)) || !Number.isFinite(n)) return again(askQty(i), "اختاروا رقم من الأزرار أو اكتبوه (0 إلى 20).");
      s.qty[products[i].slug] = Math.min(n, 20);
      if (i + 1 < products.length) {
        s.step = { at: "qty", i: i + 1 };
        return again(askQty(i + 1));
      }
      if (!Object.values(s.qty).some((q) => q > 0)) {
        s.qty = {};
        s.step = { at: "qty", i: 0 };
        return again(askQty(0), "لم تختاروا أي علبة. نبدأ من جديد.");
      }
      s.step = { at: "name" };
      return again({ text: "اكتبوا اسمكم الكامل (الاسم الأول واسم الأب):" });
    }
    case "name": {
      const e = nameError(text);
      if (e) return again({ text: "اكتبوا اسمكم الكامل (الاسم الأول واسم الأب):" }, e);
      s.name = text.replace(/\s+/g, " ");
      s.step = { at: "phone" };
      return again({ text: "اكتبوا رقم هاتفكم (07xxxxxxxxx):" });
    }
    case "phone": {
      const e = phoneError(digits(text));
      const p = normalizeIraqiMobile(digits(text));
      if (e || !p) return again({ text: "اكتبوا رقم هاتفكم (07xxxxxxxxx):" }, e ?? undefined);
      s.phone = digits(text).replace(/\D/g, "").replace(/^964/, "0");
      s.step = { at: "province" };
      return again({ text: "المحافظة؟", quick: ["بغداد", "محافظة ثانية"] });
    }
    case "province": {
      if (text === "محافظة ثانية") {
        s.step = { at: "province_other" };
        return again({ text: "اكتبوا اسم المحافظة:" });
      }
      const p = matchProvince(text);
      if (!p) return again({ text: "المحافظة؟", quick: ["بغداد", "محافظة ثانية"] }, "ما عرفنا المحافظة.");
      s.province = p;
      s.step = { at: "area" };
      return again({ text: "المنطقة أو الحي؟" });
    }
    case "province_other": {
      const p = matchProvince(text);
      if (!p) return again({ text: "اكتبوا اسم المحافظة (مثال: البصرة، أربيل):" }, "ما عرفنا المحافظة.");
      s.province = p;
      s.step = { at: "area" };
      return again({ text: "المنطقة أو الحي؟" });
    }
    case "area": {
      const e = areaError(text);
      if (e) return again({ text: "المنطقة أو الحي؟" }, e);
      s.area = text;
      s.step = { at: "address" };
      return again({ text: "العنوان بالتفصيل مع أقرب نقطة دالة:" });
    }
    case "address": {
      const e = addressError(text);
      if (e) return again({ text: "العنوان بالتفصيل مع أقرب نقطة دالة:" }, e);
      s.address = text;
      s.step = { at: "confirm" };
      return again({ text: summary(s), quick: ["تأكيد", "إلغاء"] });
    }
    case "confirm": {
      if (text !== "تأكيد" && !/^(نعم|اي|أي|ايوه|أيوه|ok|yes)$/i.test(text)) {
        return again({ text: summary(s), quick: ["تأكيد", "إلغاء"] }, "اضغطوا تأكيد لتسجيل الطلب أو إلغاء.");
      }
      return {
        state: null,
        replies: [],
        place: {
          name: s.name!,
          phone: s.phone!,
          province: s.province!,
          area: s.area!,
          address: s.address!,
          items: products.map((p) => ({ slug: p.slug, qty: s.qty[p.slug] ?? 0 })).filter((i) => i.qty),
        },
      };
    }
  }
}
