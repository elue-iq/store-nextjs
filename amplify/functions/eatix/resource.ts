import { defineFunction, secret } from "@aws-amplify/backend";

// Eatix (cashier device + payment gateway): the admin's «إرسال إلى Eatix» / cancel
// (AppSync mutation, team only). New orders are pushed by placeOrder itself.
export const eatix = defineFunction({
  name: "eatix",
  resourceGroupName: "data",
  timeoutSeconds: 25,
  environment: {
    EATIX_CLIENT_ID: secret("EATIX_CLIENT_ID"),
    EATIX_CLIENT_SECRET: secret("EATIX_CLIENT_SECRET"),
    EATIX_SHOP_CODE: secret("EATIX_SHOP_CODE"),
    EATIX_CHANNEL: secret("EATIX_CHANNEL"),
    EATIX_ITEMS: secret("EATIX_ITEMS"),
    EATIX_ENABLED: secret("EATIX_ENABLED"),
  },
});
