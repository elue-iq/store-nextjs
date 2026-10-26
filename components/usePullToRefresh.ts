"use client";

import { useEffect, useState } from "react";

// «اسحب للتحديث» for the installed (PWA) admin app, which has no browser reload
// button. Pull down from the top of a screen, release past the threshold, and the
// app reloads (which also picks up a new version of the app).
// Not active on forms, so a half-filled order is never lost.
const THRESHOLD = 80;

export function usePullToRefresh(enabled: boolean): { pull: number; refreshing: boolean } {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let startY = 0;
    let active = false;
    let dist = 0;

    const onStart = (e: TouchEvent) => {
      active = false;
      dist = 0;
      if (window.scrollY > 0 || e.touches.length !== 1) return;
      if (document.querySelector(".admin-order-form, .admin-drawer.is-open")) return;
      startY = e.touches[0].clientY;
      active = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || window.scrollY > 0) {
        dist = 0;
        setPull(0);
        return;
      }
      dist = Math.min(dy * 0.5, 120); // resistance, like a native pull
      setPull(dist);
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      if (dist >= THRESHOLD / 2) {
        setRefreshing(true);
        setPull(THRESHOLD / 2);
        window.setTimeout(() => window.location.reload(), 250);
      } else {
        setPull(0);
      }
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  return { pull, refreshing };
}
