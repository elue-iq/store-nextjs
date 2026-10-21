"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Amplify } from "aws-amplify";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import outputs from "@/amplify_outputs.json";
import { logOut } from "@/lib/auth-flow";

// Configured once, in the browser. Tokens are kept on the device so the
// customer stays logged in (180 days, refreshed automatically).
//
// The site only uses the Cognito login tokens. The identity pool (temporary
// AWS credentials) is left out on purpose: fetching those credentials is an
// extra network step that can fail, and a failure there must never look like
// "logged out".
const config = JSON.parse(JSON.stringify(outputs)) as typeof outputs & {
  auth: { identity_pool_id?: string; unauthenticated_identities_enabled?: boolean };
};
delete config.auth.identity_pool_id;
config.auth.unauthenticated_identities_enabled = false;
Amplify.configure(config);

type Identity = { phone: string; owner: string; isAdmin: boolean };

type AuthState = {
  status: "loading" | "signedOut" | "signedIn";
  phone: string; // 9647XXXXXXXXX
  owner: string; // sub::username, used to list this customer's orders
  isAdmin: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

// The last known identity, so a temporary network problem while the login is
// being renewed doesn't flash "تسجيل الدخول" at a logged-in customer.
const CACHE_KEY = "elue-identity-v1";
function readCache(): Identity | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}
function writeCache(identity: Identity | null) {
  try {
    if (identity) window.localStorage.setItem(CACHE_KEY, JSON.stringify(identity));
    else window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage blocked: nothing to remember.
  }
}

// Errors that really mean "no valid login on this device".
const SIGNED_OUT_ERRORS = new Set(["UserUnAuthenticatedException", "NotAuthorizedException", "UserNotFoundException"]);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, "refresh" | "signOut">>({
    status: "loading",
    phone: "",
    owner: "",
    isAdmin: false,
  });
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (retry.current) clearTimeout(retry.current);
    try {
      const user = await getCurrentUser(); // renews the tokens if they have expired
      const session = await fetchAuthSession();
      const claims = session.tokens?.idToken?.payload ?? {};
      const groups = (claims["cognito:groups"] as string[] | undefined) ?? [];
      const identity: Identity = {
        phone: String(claims.phone_number ?? "").replace(/^\+/, ""),
        owner: `${user.userId}::${user.username}`,
        isAdmin: groups.includes("ADMINS"),
      };
      writeCache(identity);
      setState({ status: "signedIn", ...identity });
    } catch (err) {
      const name = (err as { name?: string } | null)?.name ?? "";
      if (SIGNED_OUT_ERRORS.has(name)) {
        writeCache(null);
        setState({ status: "signedOut", phone: "", owner: "", isAdmin: false });
        return;
      }
      // Network or service hiccup: keep the customer logged in and try again.
      console.warn("Login check failed, retrying", name, err);
      const cached = readCache();
      if (cached) setState({ status: "signedIn", ...cached });
      else setState({ status: "signedOut", phone: "", owner: "", isAdmin: false });
      retry.current = setTimeout(() => void refresh(), 8000);
    }
  }, []);

  useEffect(() => {
    // Show the last known state straight away, then confirm it.
    const cached = readCache();
    if (cached) setState({ status: "signedIn", ...cached });
    void refresh();
    const stop = Hub.listen("auth", ({ payload }) => {
      if (["signedIn", "signedOut", "tokenRefresh", "tokenRefresh_failure"].includes(payload.event)) void refresh();
    });
    const onOnline = () => void refresh();
    window.addEventListener("online", onOnline);
    return () => {
      stop();
      window.removeEventListener("online", onOnline);
      if (retry.current) clearTimeout(retry.current);
    };
  }, [refresh]);

  const signOut = useCallback(async () => {
    writeCache(null);
    await logOut();
    await refresh();
  }, [refresh]);

  return <AuthContext.Provider value={{ ...state, refresh, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
