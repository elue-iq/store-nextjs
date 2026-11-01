import { defineFunction, secret } from "@aws-amplify/backend";

// Local couriers on Telegram (AppSync mutation `dispatch`, team only): sends an
// assigned order to the courier's chat, resends it, takes it back, sends delivery
// problem reports, and tests a chat id. Uses the same bot as the team's order alerts.
export const dispatch = defineFunction({
  name: "dispatch",
  resourceGroupName: "data",
  timeoutSeconds: 25,
  environment: {
    TELEGRAM_BOT_TOKEN: secret("TELEGRAM_BOT_TOKEN"),
  },
});
