"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { rememberPixelTest, startPixel, trackPixel } from "@/lib/pixel";

// Loads the Meta Pixel and reports each page view (inert until site.metaPixelId is set).
export function MetaPixel() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname.startsWith("/courier")) return; // staff screen, never reported
    rememberPixelTest();
    if (startPixel()) trackPixel("PageView");
  }, [pathname]);
  return null;
}

// «ViewContent» on a flavor's page.
export function PixelViewContent({ slug }: { slug: string }) {
  useEffect(() => {
    void import("@/lib/pixel").then((m) => m.pixelViewContent(slug));
  }, [slug]);
  return null;
}
