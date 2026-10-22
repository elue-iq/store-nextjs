import { defineFunction, secret } from "@aws-amplify/backend";

export const placeOrder = defineFunction({
  name: "place-order",
  resourceGroupName: "data",
  timeoutSeconds: 25,
  environment: {
    TELEGRAM_BOT_TOKEN: secret("TELEGRAM_BOT_TOKEN"),
    TELEGRAM_CHAT_ID: secret("TELEGRAM_CHAT_ID"),
  },
});
