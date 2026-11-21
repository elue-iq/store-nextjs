// Loyalty rewards: what customers can buy with their points (the team builds the list on
// /admin «المكافآت»). Plain TypeScript, relative imports only: the shop, the account page,
// the admin and the order server all use these rules.
//
// Points: 10 for every full 1,000 IQD of a delivered order (lib/loyalty.ts), plus points the
// team gives (PointsGrant). A reward spends its points on the order it is used on
// (Order.pointsSpent); a cancelled order gives them back. One reward per order, and not
// together with a discount code (a reward is the order's discount).
// Fixed point prices, never a moving exchange rate: customers redeem more when the value is clear.

import type { CouponRule } from "./coupons";
import { freeDeliveryFor } from "./site";

export type RewardKind = "ORDER_OFF" | "PRODUCT_OFF" | "FREE_PRODUCT" | "FREE_DELIVERY";
export const REWARD_KINDS: RewardKind[] = ["ORDER_OFF", "PRODUCT_OFF", "FREE_PRODUCT", "FREE_DELIVERY"];
export const REWARD_KIND_LABELS: Record<RewardKind, string> = {
  ORDER_OFF: "خصم مبلغ على الطلب",
  PRODUCT_OFF: "خصم مبلغ على نكهة",
  FREE_PRODUCT: "علبة مجانية من نكهة",
  FREE_DELIVERY: "توصيل مجاني",
};
export const needsProduct = (k: RewardKind) => k === "PRODUCT_OFF" || k === "FREE_PRODUCT";
export const needsValue = (k: RewardKind) => k === "ORDER_OFF" || k === "PRODUCT_OFF";

export type Reward = {
  id: string;
  title?: string | null;
  kind: string;
  points: number;
  value?: number | null;
  slug?: string | null;
  minJars?: number | null;
  active?: boolean | null;
  startsAt?: string | null;
  endsAt?: string | null;
  sort?: number | null;
};

export const REWARD_CODE = "POINTS"; // the rule's code on an order: the discount came from points

const iqd = (n: number) => `${(Number(n) || 0).toLocaleString("en-US")} د.ع`;

// «خصم 2,000 د.ع على جزر». nameOf: slug → the flavor's Arabic name.
export function rewardTitle(r: Reward, nameOf: (slug: string) => string | undefined): string {
  if (r.title?.trim()) return r.title.trim();
  const flavor = r.slug ? nameOf(r.slug) ?? r.slug : "";
  switch (r.kind as RewardKind) {
    case "ORDER_OFF":
      return `خصم ${iqd(r.value ?? 0)} على طلبكم`;
    case "PRODUCT_OFF":
      return `خصم ${iqd(r.value ?? 0)} على علبة ${flavor}`;
    case "FREE_PRODUCT":
      return `علبة ${flavor} مجانية`;
    case "FREE_DELIVERY":
      return "توصيل مجاني";
    default:
      return "مكافأة";
  }
}

// The reward as a pricing rule (lib/coupons.ts prices it like a code).
export function rewardRule(r: Reward): CouponRule {
  const kind = r.kind as RewardKind;
  return {
    code: REWARD_CODE,
    kind: kind === "ORDER_OFF" ? "FIXED" : kind === "FREE_DELIVERY" ? "FREE_DELIVERY" : kind,
    value: needsValue(kind) ? Math.max(0, Number(r.value ?? 0)) : null,
    slug: needsProduct(kind) ? r.slug ?? null : null,
    minJars: r.minJars ?? null,
  };
}

export type RewardProblem = "inactive" | "not_started" | "ended" | "points" | "needs_product" | "min_jars" | "empty_cart" | "already_free";

// Why this reward can't be used on this cart now (null = it can).
export function rewardProblem(
  r: Reward | null | undefined,
  ctx: { now: Date; balance: number; lines: { slug: string; qty: number }[] },
): RewardProblem | null {
  if (!r || r.active === false) return "inactive";
  if (r.startsAt && ctx.now < new Date(r.startsAt)) return "not_started";
  if (r.endsAt && ctx.now > new Date(r.endsAt)) return "ended";
  if (ctx.balance < r.points) return "points";
  const jars = ctx.lines.reduce((n, l) => n + l.qty, 0);
  if (!jars) return "empty_cart";
  if (needsProduct(r.kind as RewardKind) && !ctx.lines.some((l) => l.slug === r.slug && l.qty > 0)) return "needs_product";
  if (r.minJars && jars < r.minJars) return "min_jars";
  if (r.kind === "FREE_DELIVERY" && freeDeliveryFor(jars)) return "already_free";
  return null;
}

export function rewardProblemText(p: RewardProblem, r: Reward | null | undefined, balance: number, nameOf: (slug: string) => string | undefined): string {
  switch (p) {
    case "points":
      return `تحتاجون ${((r?.points ?? 0) - balance).toLocaleString("en-US")} نقطة بعد.`;
    case "needs_product":
      return `أضيفوا علبة ${r?.slug ? nameOf(r.slug) ?? "" : ""} للسلة حتى تستخدمونها.`;
    case "min_jars":
      return `تشتغل على ${r?.minJars ?? ""} علب أو أكثر.`;
    case "empty_cart":
      return "أضيفوا علبة للسلة أولاً.";
    case "already_free":
      return "التوصيل مجاني لطلبكم أصلاً: خلّوا نقاطكم لمكافأة ثانية.";
    case "not_started":
      return "تبدأ لاحقاً.";
    case "ended":
    case "inactive":
      return "هذه المكافأة غير متاحة حالياً.";
  }
}

// Shown on the account page: the rewards in order, cheapest first.
export const sortRewards = <T extends Reward>(list: T[]): T[] =>
  [...list].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.points - b.points);

export const liveReward = (r: Reward, now = new Date()) =>
  r.active !== false && !(r.startsAt && now < new Date(r.startsAt)) && !(r.endsAt && now > new Date(r.endsAt));

// Ready-made rewards for the admin, sized on 10 points per 1,000 IQD (about 6–10% back):
// the first one is reachable with one order of two jars.
export const REWARD_TEMPLATES: Omit<Reward, "id">[] = [
  { kind: "ORDER_OFF", points: 300, value: 2_000 },
  { kind: "FREE_DELIVERY", points: 450, minJars: 1 },
  { kind: "ORDER_OFF", points: 700, value: 5_000 },
  { kind: "FREE_PRODUCT", points: 1_500, slug: "dark-chocolate" },
];

// What the customer's points are worth at the best fixed-amount reward, for the dashboard.
export function pointValueIQD(rewards: Reward[]): number | null {
  const rates = rewards
    .filter((r) => (r.kind === "ORDER_OFF" || r.kind === "PRODUCT_OFF") && r.points > 0 && (r.value ?? 0) > 0)
    .map((r) => (r.value ?? 0) / r.points);
  return rates.length ? Math.max(...rates) : null;
}
