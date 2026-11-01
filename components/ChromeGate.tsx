"use client";

import { usePathname } from "next/navigation";

// The customer shell (cold-chain banner, footer…) is not shown inside the courier app.
export function ChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/courier" || pathname.startsWith("/courier/")) return null;
  return <>{children}</>;
}
