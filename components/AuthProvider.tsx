"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Amplify } from "aws-amplify";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import outputs from "@/amplify_outputs.json";
import { logOut } from "@/lib/auth-flow";

// Configured once, in the browser. Tokens are kept on the device so the
// customer stays logged in (180 days, refreshed automatically).
Amplify.configure(outputs);

type AuthState = {
  status: "loading" | "signedOut" | "signedIn";
  phone: string; // 9647XXXXXXXXX
  owner: string; // sub::username, used to list this customer's orders
  isAdmin: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<AuthState, "refresh" | "signOut">>({
    status: "loading",
    phone: "",
    owner: "",
    isAdmin: false,
  });

  const refresh = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      const session = await fetchAuthSession();
      const claims = session.tokens?.idToken?.payload ?? {};
      const groups = (claims["cognito:groups"] as string[] | undefined) ?? [];
      const phone = String(claims.phone_number ?? "").replace(/^\+/, "");
      setState({ status: "signedIn", phone, owner: `${user.userId}::${user.username}`, isAdmin: groups.includes("ADMINS") });
    } catch {
      setState({ status: "signedOut", phone: "", owner: "", isAdmin: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
    return Hub.listen("auth", ({ payload }) => {
      if (["signedIn", "signedOut", "tokenRefresh", "tokenRefresh_failure"].includes(payload.event)) void refresh();
    });
  }, [refresh]);

  const signOut = useCallback(async () => {
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
