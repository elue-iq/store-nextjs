import { defineFunction, secret } from "@aws-amplify/backend";

// Boxy (delivery company): the admin's «أرسل إلى بوكسي» and friends (AppSync mutation,
// team only), plus Boxy's notification webhook (function URL, checked by a secret header) and a status refresh every 10 minutes. Needs four secrets in Amplify:
// BOXY_API_KEY, BOXY_API_SECRET, BOXY_PICKUP_UID (saved pick-up address), BOXY_API_HOST.
export const boxy = defineFunction({
  name: "boxy",
  resourceGroupName: "data",
  timeoutSeconds: 25,
  schedule: "every 10m",
  environment: {
    BOXY_API_KEY: secret("BOXY_API_KEY"),
    BOXY_API_SECRET: secret("BOXY_API_SECRET"),
    BOXY_PICKUP_UID: secret("BOXY_PICKUP_UID"),
    BOXY_API_HOST: secret("BOXY_API_HOST"),
    BOXY_WEBHOOK_KEY: secret("BOXY_WEBHOOK_KEY"), // value of the custom header Boxy sends with each notification
  },
});
