import { defineFunction, secret } from "@aws-amplify/backend";

// Modon Express: the admin's «أرسل إلى مدن» and friends (AppSync mutation, team
// only), and Modon's status-update webhook (function URL, checked by a secret header).
export const modon = defineFunction({
  name: "modon",
  resourceGroupName: "data",
  timeoutSeconds: 25,
  schedule: "every 10m",
  environment: {
    MODON_USERNAME: secret("MODON_USERNAME"),
    MODON_PASSWORD: secret("MODON_PASSWORD"),
    MODON_WEBHOOK_KEY: secret("MODON_WEBHOOK_KEY"),
  },
});
