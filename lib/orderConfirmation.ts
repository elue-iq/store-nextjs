// "We received your order": a WhatsApp message to a customer who placed their own order,
// sent through OTPIQ (the same provider that sends the login codes).
//
// OTPIQ can only send WhatsApp messages as an approved template, from a WhatsApp Business API
// number connected to OTPIQ. The template (Utility, Arabic) is created in the OTPIQ dashboard:
//   مرحباً {{1}} 🧡
//   استلم فريق ÉLUE طلبكم {{2}} وراح نجهزه بكل حرص.
//   لمتابعة الطلب: {{3}}
//   شكراً لاختياركم ÉLUE
// Until site.orderConfirmation is filled in, nothing is sent. A failure never affects the order.

import { site } from "./site";

export type OrderConfirmationInput = {
  apiKey: string;
  phone: string; // 9647XXXXXXXXX
  name: string;
  orderNumber: string;
  origin: string; // https://elue-iq.com
};

export async function sendOrderConfirmation(i: OrderConfirmationInput): Promise<{ sent: boolean; reason?: string }> {
  const c = site.orderConfirmation;
  if (!c.templateName || !c.whatsappAccountId || !c.whatsappPhoneId) return { sent: false, reason: "not_configured" };
  if (!i.apiKey) return { sent: false, reason: "no_api_key" };
  try {
    const res = await fetch("https://api.otpiq.com/api/sms", {
      method: "POST",
      headers: { Authorization: `Bearer ${i.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: i.phone,
        smsType: "whatsapp-template",
        provider: "whatsapp",
        templateName: c.templateName,
        whatsappAccountId: c.whatsappAccountId,
        whatsappPhoneId: c.whatsappPhoneId,
        templateParameters: {
          body: {
            "1": i.name.trim().slice(0, 60) || "عزيزي الزبون",
            "2": i.orderNumber,
            "3": `${i.origin}/account?order=${encodeURIComponent(i.orderNumber)}`,
          },
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("order confirmation failed", res.status, body.slice(0, 300));
      return { sent: false, reason: `http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("order confirmation crashed", err);
    return { sent: false, reason: "error" };
  }
}
