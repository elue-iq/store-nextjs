// The customer's saved delivery details (CustomerProfile in DynamoDB).

import { dataClient } from "./data";
import { cleanDelivery, type DeliveryInfo } from "./validate";

export type Profile = DeliveryInfo & { id: string };

export const EMPTY_DELIVERY: DeliveryInfo = { name: "", province: "", area: "", address: "" };

export async function loadProfile(): Promise<Profile | null> {
  const { data, errors } = await dataClient.models.CustomerProfile.list({ limit: 10 });
  if (errors?.length) throw new Error(errors[0].message);
  const p = [...(data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return p ? { id: p.id, name: p.name, province: p.province, area: p.area, address: p.address } : null;
}

export async function saveProfile(values: DeliveryInfo, existingId?: string | null): Promise<Profile> {
  const clean = cleanDelivery(values);
  const res = existingId
    ? await dataClient.models.CustomerProfile.update({ id: existingId, ...clean })
    : await dataClient.models.CustomerProfile.create(clean);
  if (!res.data || res.errors?.length) throw new Error(res.errors?.[0]?.message ?? "profile_save_failed");
  return { id: res.data.id, ...clean };
}
