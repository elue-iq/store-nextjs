import { defineFunction } from "@aws-amplify/backend";

// The customer's review of a delivered order (AppSync mutation `submitReview`).
export const submitReview = defineFunction({
  name: "submit-review",
  resourceGroupName: "data",
  timeoutSeconds: 15,
});
