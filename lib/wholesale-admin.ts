// The team's default wholesale jar price (WholesaleSetting, team-only), with a safe fallback.

import { dataClient } from "./data";
import { DEFAULT_WHOLESALE_PRICE, WHOLESALE_SETTING_ID, cleanUnitPrice } from "./wholesale";

export async function loadWholesalePrice(): Promise<number> {
  try {
    const { data } = await dataClient.models.WholesaleSetting.get({ id: WHOLESALE_SETTING_ID });
    return cleanUnitPrice(data?.price) ?? DEFAULT_WHOLESALE_PRICE;
  } catch {
    return DEFAULT_WHOLESALE_PRICE;
  }
}

export async function saveWholesalePrice(price: number): Promise<boolean> {
  let res = await dataClient.models.WholesaleSetting.update({ id: WHOLESALE_SETTING_ID, price });
  if (!res.data) res = await dataClient.models.WholesaleSetting.create({ id: WHOLESALE_SETTING_ID, price });
  if (!res.data || res.errors?.length) {
    console.error("saving the wholesale price failed", res.errors);
    return false;
  }
  return true;
}
