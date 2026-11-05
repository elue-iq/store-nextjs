import { defineFunction, secret } from "@aws-amplify/backend";

// Orders taken in Instagram DMs (ManyChat). A public address that ManyChat calls,
// checked by a secret header. It places the order through the same placeOrder
// function the website and the admin use, as the team, so every rule (pricing,
// free delivery from 4 jars, sold-out flavors, Telegram, Eatix, admin screen) is shared.
export const igOrder = defineFunction({
  name: "ig-order",
  resourceGroupName: "data",
  timeoutSeconds: 28,
  environment: {
    IG_ORDER_KEY: secret("IG_ORDER_KEY"),
  },
});
