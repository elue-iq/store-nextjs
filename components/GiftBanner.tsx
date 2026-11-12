"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { dataClient } from "@/lib/data";
import type { GiftOffer } from "@/lib/gifts";

// The live gift campaign (query «giftOffer»): null when there is none, it is over, or its
// jars are used up. Asked once per visit and shared by everything that shows it.
let pending: Promise<GiftOffer | null> | null = null;

function parse(data: unknown): GiftOffer | null {
  let v: unknown = data;
  try {
    for (let i = 0; i < 3 && typeof v === "string"; i++) v = JSON.parse(v);
  } catch {
    return null;
  }
  const o = v as GiftOffer | null;
  return o && typeof o === "object" && typeof o.id === "string" && Array.isArray(o.products) ? o : null;
}

export function loadGiftOffer(fresh = false): Promise<GiftOffer | null> {
  if (!pending || fresh) {
    pending = dataClient.queries
      .giftOffer({ authMode: "apiKey" })
      .then(({ data, errors }) => {
        if (errors?.length) console.error("gift offer failed", errors);
        return parse(data);
      })
      .catch((err) => {
        console.error("gift offer failed", err);
        return null;
      });
  }
  return pending;
}

export function useGiftOffer(): GiftOffer | null {
  const [offer, setOffer] = useState<GiftOffer | null>(null);
  useEffect(() => {
    let alive = true;
    void loadGiftOffer().then((o) => alive && setOffer(o));
    return () => {
      alive = false;
    };
  }, []);
  return offer;
}

// Across the site while a gift campaign is live: its own line, set by the team on /admin.
export function GiftBanner() {
  const offer = useGiftOffer();
  if (!offer?.banner) return null;
  return (
    <aside className="gift-banner" aria-label="عرض الهدية">
      <Link href="/#flavors" className="gift-banner__inner">
        {offer.banner}
      </Link>
    </aside>
  );
}
