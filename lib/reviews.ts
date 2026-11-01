// Customer reviews: two ratings (delivery, taste) and an optional note, one per
// delivered order. Every review is shown publicly exactly as written (no editing,
// no deleting). A customer's latest delivered order must be reviewed before they
// order again (site.reviewRequiredToReorder). Plain TypeScript, no imports from the
// browser, so it is shared with the backend functions.

export const REVIEW_MAX_COMMENT = 600;

export type ReviewKind = "delivery" | "taste";

// The words that appear (and change) as the customer taps the stars.
export const RATING_WORDS: Record<ReviewKind, string[]> = {
  taste: ["ما عجبني", "عادي…", "زين", "حلو هواي", "خرافي!"],
  delivery: ["تأخر وتعبنا", "مو زين", "عادي", "زين وبوقته", "ممتاز، وصل مبرّد وبوقته"],
};
export const RATING_FACES = ["😕", "😐", "🙂", "😋", "🤩"];

export const REVIEW_TEXT = {
  title: "شلون كانت تجربتك؟",
  intro: "دقيقة وحدة. رأيك يخلينا نصير أحسن.",
  delivery: "تقييم التوصيل",
  deliveryHint: "الموعد، التبريد، والتعامل",
  taste: "تقييم الطعم",
  tasteHint: "شلون كان طعم الترافل؟",
  noteLabel: "ملاحظة (اختيارية)",
  notePlaceholder: "اكتب أي شي تحب نعرفه…",
  transparencyTitle: "الشفافية 100%",
  transparency: "نعرض كل التقييمات كما هي، بلا تعديل ولا حذف، حتى ملاحظتك تنعرض بالضبط كما كتبتها (باسمك الأول فقط).",
  submit: "إرسال التقييم",
  thanks: "شكراً، وصلنا رأيك 🤎",
  reorderOpen: "تقدر تطلب مرة ثانية متى ما تحب.",
};

export function ratingValid(n: unknown): n is 1 | 2 | 3 | 4 | 5 {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 5;
}

// The customer's name as shown publicly: first name only.
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0]?.slice(0, 24) || "زبون";
}

export const average = (nums: number[]): number => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

// "4.6"
export const fmtAvg = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

// The latest delivered order that has no review yet (null when nothing is waiting).
export function pendingReview<T extends { status?: string | null; reviewed?: boolean | null; createdAt: string }>(orders: T[]): T | null {
  const delivered = orders.filter((o) => o.status === "DELIVERED").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = delivered[0];
  return latest && !latest.reviewed ? latest : null;
}

export function reviewPath(orderNumber: string): string {
  return `/review?order=${encodeURIComponent(orderNumber)}`;
}
