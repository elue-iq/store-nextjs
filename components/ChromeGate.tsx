"use client";

import { usePathname } from "next/navigation";
import { isChromeless } from "@/lib/chromeless";

// The customer shell (cold-chain banner, footer…) is not shown inside the courier app, nor on
// the links and nutrition pages (see lib/chromeless).
export function ChromeGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isChromeless(pathname)) return null;
  return <>{children}</>;
}
