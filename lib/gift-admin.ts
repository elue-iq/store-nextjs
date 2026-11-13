// The team's gift actions (mutation «giftAdmin», checked on the server):
// - status:   jars of a campaign taken so far / left
// - setGifts: the gift lines of an existing order (a campaign's gift or a manual one)
// - sync:     after an order is cancelled or reopened, its gift jars go back / are taken again

import { dataClient, errorCode, errorDetail } from "./data";
import { GIFT_TEAM_ERROR, type GiftPick } from "./gifts";

export type GiftCampaign = NonNullable<Awaited<ReturnType<typeof dataClient.models.GiftCampaign.get>>["data"]>;

export type GiftStatus = { used: number; cap: number | null; left: number | null; released?: number };

// "gift:cap" -> the Arabic reason for the team.
export function giftErrorText(errors: { message?: string }[] | undefined | null, fallback = "تعذّر حفظ الهدية. حاول مجددًا."): string {
  if (errorCode(errors) === "gift") return GIFT_TEAM_ERROR[errorDetail(errors)] ?? fallback;
  return fallback;
}

export async function callGiftAdmin(args: {
  action: "status" | "sync" | "setGifts";
  campaignId?: string;
  orderId?: string;
  gifts?: GiftPick[];
}): Promise<{ data: Record<string, unknown> | null; error: string }> {
  try {
    const { data, errors } = await dataClient.mutations.giftAdmin({
      action: args.action,
      campaignId: args.campaignId,
      orderId: args.orderId,
      gifts: args.gifts ? JSON.stringify(args.gifts) : undefined,
    });
    if (errors?.length) return { data: null, error: giftErrorText(errors) };
    let parsed: unknown = data;
    for (let i = 0; i < 3 && typeof parsed === "string"; i++) parsed = JSON.parse(parsed);
    return { data: (parsed ?? {}) as Record<string, unknown>, error: "" };
  } catch (err) {
    console.error("giftAdmin failed", err);
    return { data: null, error: "تعذّر الاتصال الآن. حاول مجددًا." };
  }
}

export async function listGiftCampaigns(): Promise<GiftCampaign[]> {
  const { data } = await dataClient.models.GiftCampaign.list({ limit: 200 });
  return [...(data ?? [])].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
