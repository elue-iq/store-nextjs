import { defineFunction } from "@aws-amplify/backend";

// The local courier's app on /courier (AppSync mutation `courierApp`).
export const courierApp = defineFunction({
  name: "courier-app",
  resourceGroupName: "data",
  timeoutSeconds: 20,
});
