// Qi Card payment gateway (developers-gate.qi.iq) — shared by the placeOrder function.
// Plain TypeScript with relative imports only, so it bundles into the function.
//
// Flow: createPayment -> the customer pays on Qi's page (formUrl) -> Qi calls our
// notification address (signed) and sends the customer back to finishPaymentUrl ->
// we check the signature (or ask Qi for the status) before marking the order paid.

import { createVerify, randomUUID } from "node:crypto";

export type QiConfig = { host: string; username: string; password: string; terminalId: string };

export function qiConfig(env: Record<string, string | undefined>): QiConfig | null {
  const host = String(env.QI_API_HOST ?? "").trim().replace(/\/+$/, "");
  const username = String(env.QI_USERNAME ?? "").trim();
  const password = String(env.QI_PASSWORD ?? "").trim();
  const terminalId = String(env.QI_TERMINAL_ID ?? "").trim();
  // "pending" = the live address is not known yet: payments stay off.
  if (!/^https:\/\//i.test(host) || !username || !password || !terminalId) return null;
  return { host, username, password, terminalId };
}

// Qi's public key (RSA 2048), for checking the signature of their notifications.
export const QI_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAp9Q+a/cE2AhU/4Fa5emk
ZcBUGzErBx9kfzVY5Yu86sTaqcgd269JFDp+flaHDRY6sYJRIsVqQxiahzW6h08b
Ts1rqetqje1hy4zBNfKvLxyT1hAYJPeqkcwc8dpNc0LnRbU5ahrqvkkNjNswJuPK
9xOtOqhJzq/6sIuKtAIClbKaKgopmsp3cvlzfcyz4pRHz2W+gB5655dsnK+aQpW+
bxKuWIzRmnuCdFIIJxqwBs4VDqlBlKPbPbU6CPUxNpBxrpWcnR3BeuM6UoCKWnz5
kRxDBk8Vq7F2+qmwwoYWJdgHi3vjrzTaJbXHUN5xO0ZBjdd+lVn9L1bMnapl3PPs
9QIDAQAB
-----END PUBLIC KEY-----`;

export type QiPayment = {
  requestId?: string;
  paymentId?: string;
  status?: string; // CREATED | SUCCESS | FAILED | AUTHENTICATION_FAILED
  canceled?: boolean;
  amount?: number;
  currency?: string;
  creationDate?: string;
  formUrl?: string;
};

export type QiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function qiCall<T>(cfg: QiConfig, path: string, init: RequestInit = {}): Promise<QiResult<T>> {
  try {
    const res = await fetch(`${cfg.host}/api/v1${path}`, {
      ...init,
      headers: {
        "X-Terminal-Id": cfg.terminalId,
        Authorization: `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const err = (body as { error?: { code?: number; description?: string } } | null)?.error;
    if (!res.ok || err) return { ok: false, error: `qi_${err?.code ?? res.status}:${err?.description ?? text.slice(0, 120)}` };
    return { ok: true, data: body as T };
  } catch (e) {
    return { ok: false, error: `qi_network:${e instanceof Error ? e.message : "failed"}` };
  }
}

// amount in IQD (whole dinars). requestId = our order number, unique per terminal.
export function createPayment(
  cfg: QiConfig,
  i: { orderNumber: string; amount: number; finishUrl: string; notificationUrl: string; name: string; phone: string },
): Promise<QiResult<QiPayment>> {
  const [first, ...rest] = i.name.trim().split(/\s+/);
  return qiCall<QiPayment>(cfg, "/payment", {
    method: "POST",
    body: JSON.stringify({
      requestId: `${i.orderNumber}-${randomUUID().slice(0, 8)}`,
      amount: i.amount,
      currency: "IQD",
      locale: "ar_AE",
      finishPaymentUrl: i.finishUrl,
      notificationUrl: i.notificationUrl,
      customerInfo: { firstName: first || i.name, lastName: rest.join(" ") || undefined, phone: `+${i.phone}` },
      additionalInfo: { orderNumber: i.orderNumber },
    }),
  });
}

export function getPaymentStatus(cfg: QiConfig, paymentId: string): Promise<QiResult<QiPayment>> {
  return qiCall<QiPayment>(cfg, `/payment/${encodeURIComponent(paymentId)}/status`, { method: "GET" });
}

// Qi signs "paymentId|amount.000|currency|creationDate|status" (missing field = "-")
// with RSA-SHA256 and sends it base64 in the X-Signature header.
export function verifyNotification(body: QiPayment, signatureBase64: string, publicKey = QI_PUBLIC_KEY): boolean {
  if (!signatureBase64) return false;
  const text = [
    body.paymentId || "-",
    body.amount ? `${body.amount}.000` : "-",
    body.currency || "-",
    body.creationDate || "-",
    body.status || "-",
  ].join("|");
  try {
    const v = createVerify("sha256");
    v.update(text, "utf8");
    v.end();
    return v.verify(publicKey, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}
