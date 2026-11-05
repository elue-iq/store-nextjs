import { defineFunction, secret } from "@aws-amplify/backend";

export const placeOrder = defineFunction({
  name: "place-order",
  resourceGroupName: "data",
  timeoutSeconds: 25,
  environment: {
    TELEGRAM_BOT_TOKEN: secret("TELEGRAM_BOT_TOKEN"),
    TELEGRAM_CHAT_ID: secret("TELEGRAM_CHAT_ID"),
    EATIX_CLIENT_ID: secret("EATIX_CLIENT_ID"),
    EATIX_CLIENT_SECRET: secret("EATIX_CLIENT_SECRET"),
    EATIX_SHOP_CODE: secret("EATIX_SHOP_CODE"),
    EATIX_CHANNEL: secret("EATIX_CHANNEL"),
    EATIX_ITEMS: secret("EATIX_ITEMS"),
    EATIX_ENABLED: secret("EATIX_ENABLED"),
    OTPIQ_API_KEY: secret("OTPIQ_API_KEY"),
    QI_API_HOST: secret("QI_API_HOST"),
    QI_USERNAME: secret("QI_USERNAME"),
    QI_PASSWORD: secret("QI_PASSWORD"),
    QI_TERMINAL_ID: secret("QI_TERMINAL_ID"),
  },
});
