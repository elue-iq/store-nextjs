import { defineFunction, secret } from "@aws-amplify/backend";

// The customer's review of a delivered order (AppSync mutation `submitReview`).
export const submitReview = defineFunction({
  name: "submit-review",
  resourceGroupName: "data",
  timeoutSeconds: 15,
  // A low rating alerts the team on Telegram, so someone contacts the customer quickly.
  environment: {
    TELEGRAM_BOT_TOKEN: secret("TELEGRAM_BOT_TOKEN"),
    TELEGRAM_CHAT_ID: secret("TELEGRAM_CHAT_ID"),
  },
});
