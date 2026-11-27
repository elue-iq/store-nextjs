// Web push for the team: a notification on the team's phones for every new order (admin app).
// Free: the phones' own push services (Apple, Google) deliver it; our order function sends it.
//
// The server's key pair (VAPID). The public half is here; the private half is the secret
// VAPID_PRIVATE_KEY in Amplify (Hosting > Secrets), read at runtime by place-order. They are a
// pair: change both together (phones that turned notifications on then turn them on again).
import { formatIQD } from "./site";

export const VAPID_PUBLIC_KEY = "BCDMeGmnfi7ua_ZDNIZfpfkhLxs5tHPZ40Dj8smJAXU1xTxeHfTOViEy40Q9pTFpFEsYIEpCfiQKhBDMBwc1daQ";
export const PUSH_SUBJECT = "mailto:orders@elue-iq.com";

// What the service worker (public/admin-sw.js) shows.
export type PushMessage = { title: string; body: string; url: string; tag?: string };

export function newOrderPush(o: {
  id: string;
  orderNumber: string;
  name: string;
  province?: string | null;
  total: number;
  jars?: number | null;
  saleType?: string | null;
  createdBy?: string | null;
}): PushMessage {
  const n = o.jars ?? 0;
  const jars = n ? (n === 1 ? "علبة" : n === 2 ? "علبتان" : n <= 10 ? `${n} علب` : `${n} علبة`) : null;
  return {
    title: `${o.saleType === "WHOLESALE" ? "طلب جملة" : "طلب جديد"} ${o.orderNumber}`,
    body: [o.name, o.province, jars, formatIQD(o.total)].filter(Boolean).join(" · ") + (o.createdBy ? " (سجّله الفريق)" : ""),
    url: `/admin?order=${encodeURIComponent(o.id)}`,
    tag: o.id,
  };
}

// The browser wants the public key as bytes.
export function vapidKeyBytes(): Uint8Array {
  const b64 = VAPID_PUBLIC_KEY.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (VAPID_PUBLIC_KEY.length % 4)) % 4);
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
