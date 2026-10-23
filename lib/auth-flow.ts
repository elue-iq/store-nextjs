// WhatsApp-code login with AWS Cognito (custom sign-in).
//
// 1. sendLoginCode(phone): creates the account the first time (no password
//    the customer ever sees), then starts the sign-in. Cognito asks our
//    create-auth-challenge function, which sends the 4-digit code on WhatsApp.
// 2. confirmLoginCode(code): checks the code. 3 wrong tries end the attempt.
//
// After that the customer stays logged in on this device (180 days).

import { confirmSignIn, getCurrentUser, signIn, signOut, signUp } from "aws-amplify/auth";

export type SendResult = "sent" | "rate_limited" | "locked" | "invalid_phone" | "failed";
export type ConfirmResult = "ok" | "wrong" | "expired" | "failed";

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const body = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
  return `Aa1!${body}`;
}

function errorText(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as { name?: string; message?: string };
  return `${e.name ?? ""} ${e.message ?? ""}`;
}

// phone: 9647XXXXXXXXX
export async function sendLoginCode(phone: string): Promise<SendResult> {
  const username = `+${phone}`;

  // Someone else (or the same person) is already logged in on this device.
  try {
    await getCurrentUser();
    await signOut();
  } catch {
    // not logged in
  }

  try {
    await signUp({ username, password: randomPassword(), options: { userAttributes: { phone_number: username } } });
  } catch (err) {
    const text = errorText(err);
    if (!text.includes("UsernameExistsException")) {
      if (text.includes("invalid_phone")) return "invalid_phone";
      console.error("signUp failed", err);
      return "failed";
    }
  }

  try {
    const res = await signIn({ username, options: { authFlowType: "CUSTOM_WITHOUT_SRP" } });
    if (res.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE") return "sent";
    if (res.isSignedIn) return "sent";
    console.error("Unexpected sign-in step", res.nextStep.signInStep);
    return "failed";
  } catch (err) {
    const text = errorText(err);
    if (text.includes("locked")) return "locked";
    if (text.includes("rate_limited")) return "rate_limited";
    console.error("signIn failed", err);
    return "failed";
  }
}

export async function confirmLoginCode(code: string): Promise<ConfirmResult> {
  try {
    const res = await confirmSignIn({ challengeResponse: code });
    if (res.isSignedIn) return "ok";
    if (res.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_CUSTOM_CHALLENGE") return "wrong";
    return "failed";
  } catch (err) {
    const text = errorText(err);
    // 3 wrong tries, or the 5-minute window closed.
    if (text.includes("NotAuthorizedException") || text.includes("expired") || text.includes("session")) return "expired";
    console.error("confirmSignIn failed", err);
    return "failed";
  }
}

export async function logOut() {
  await signOut();
}
