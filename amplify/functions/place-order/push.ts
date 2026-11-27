// Sends web push notifications to the team's phones (see lib/push.ts).
// The private key is a secret read at runtime from Amplify's secret store
// (/amplify/shared/<app id>/VAPID_PRIVATE_KEY), like the Meta token: without it nothing is
// sent and nothing breaks. Never throws; never waits more than a few seconds per phone.

import webpush from "web-push";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { PUSH_SUBJECT, VAPID_PUBLIC_KEY, type PushMessage } from "../../../lib/push";

const TIMEOUT_MS = 4000;
let keyCache: { value: string | null; at: number } | null = null;

async function privateKey(): Promise<string | null> {
  if (keyCache && Date.now() - keyCache.at < 10 * 60_000) return keyCache.value;
  // The secret's name comes from the shared prefix in AMPLIFY_SSM_ENV_CONFIG (a dedicated
  // env var would push the function past Lambda's 4 KB limit on live).
  const prefix = (process.env.AMPLIFY_SSM_ENV_CONFIG ?? "").match(/\/amplify\/shared\/[A-Za-z0-9]+\//)?.[0];
  let value: string | null = null;
  if (prefix) {
    try {
      const r = await new SSMClient({}).send(new GetParameterCommand({ Name: `${prefix}VAPID_PRIVATE_KEY`, WithDecryption: true }));
      value = r.Parameter?.Value?.trim() || null;
    } catch (err) {
      if ((err as { name?: string }).name !== "ParameterNotFound") console.error("push: key read failed", (err as Error).message);
    }
  }
  keyCache = { value, at: Date.now() };
  return value;
}

export type PushTarget = { id: string; endpoint: string; p256dh: string; authKey: string };
export type PushResult = { sent: number; failed: number; gone: string[]; noKey?: boolean };

// Sends one message to every phone. Phones that unsubscribed or reinstalled answer 404/410:
// their ids come back in `gone`, so the caller removes them.
export async function sendPush(targets: PushTarget[], msg: PushMessage): Promise<PushResult> {
  const key = await privateKey();
  if (!key) return { sent: 0, failed: 0, gone: [], noKey: true };
  const options = {
    vapidDetails: { subject: PUSH_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: key },
    TTL: 6 * 3600, // a phone that is off still gets it within 6 hours
    urgency: "high" as const,
    timeout: TIMEOUT_MS,
  };
  const results = await Promise.allSettled(
    targets.map((t) =>
      webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.authKey } }, JSON.stringify(msg), options),
    ),
  );
  const out: PushResult = { sent: 0, failed: 0, gone: [] };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out.sent++;
    else {
      const code = (r.reason as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) out.gone.push(targets[i].id);
      else {
        out.failed++;
        console.error("push failed", code ?? "", String((r.reason as Error)?.message ?? r.reason).slice(0, 200));
      }
    }
  });
  return out;
}
