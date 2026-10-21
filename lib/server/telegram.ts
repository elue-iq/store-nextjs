import "server-only";

// Sends one message to the orders group, retrying a few times.
// Returns true only when Telegram confirms the message was delivered.

const RETRY_DELAYS_MS = [0, 800, 2000];

export async function sendToTelegram(html: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;

  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: html,
          parse_mode: "HTML",
          link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) return true;
      // 4xx other than 429 means a setup problem (wrong token or chat id): retrying won't help.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        console.error("Telegram rejected the message:", res.status, await res.text().catch(() => ""));
        return false;
      }
    } catch (err) {
      console.error("Telegram request failed:", err);
    }
  }
  return false;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
