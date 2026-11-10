// Where a visitor came from (ad, creator link, page...), remembered in the browser for
// 30 days and saved with the order. Also the Meta cookies (_fbp, _fbc) the server needs
// to match an order with the ad click. Nothing here is personal data.

export type Attribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  ref?: string;
  referrer?: string; // another site's address (no query), "" = direct
  landing?: string; // the page of this touch: path and the campaign parameters only
  at: number;
  first?: Omit<Attribution, "first">; // the very first touch in the 30 days; never replaced
};

const KEY = "elue-attr-v1";
const DAYS = 30;
const PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "ref"] as const;

function read(): Attribution | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Attribution;
    return a && typeof a.at === "number" && Date.now() - a.at < DAYS * 86_400_000 ? a : null;
  } catch {
    return null;
  }
}

// Call once per page load. A visit with campaign parameters replaces what was saved; a plain
// visit keeps the first landing (for 30 days).
export function captureAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const found: Partial<Record<(typeof PARAMS)[number], string>> = {};
    for (const k of PARAMS) {
      const v = (params.get(k) ?? "").trim().slice(0, k === "fbclid" ? 300 : 80);
      if (v) found[k] = v;
    }
    const saved = read();
    const hasCampaign = Object.keys(found).length > 0;
    if (saved && !hasCampaign) return saved;

    let referrer = "";
    try {
      const r = new URL(document.referrer);
      if (r.host && r.host !== window.location.host) referrer = `${r.origin}${r.pathname}`.slice(0, 200);
    } catch {}
    const keep = new URLSearchParams();
    for (const [k, v] of Object.entries(found)) keep.set(k, v);
    const landing = `${window.location.pathname}${keep.size ? `?${keep}` : ""}`.slice(0, 300);
    const touch = { ...found, referrer, landing, at: Date.now() };
    // First touch: kept from the first visit (a saved record without it is itself that first touch).
    const first = saved?.first ?? (saved ? { ...saved, first: undefined } : touch);
    delete (first as { first?: unknown }).first;
    const next: Attribution = { ...touch, first };
    localStorage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

export const readAttribution = (): Attribution | null => (typeof window === "undefined" ? null : read());

function cookie(name: string): string {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

// What the server needs for the Conversions API: Meta's cookies, the page, the browser.
// ?testcode=TEST12345 (from Events Manager > Test events) in this tab: the server copy of the
// purchase then shows in that Test events tab. Only the test copy of the site honors it.
function testCode(): string | undefined {
  try {
    const q = new URLSearchParams(window.location.search).get("testcode");
    if (q && /^TEST\d{3,10}$/.test(q)) sessionStorage.setItem("elue-capitest", q);
    return sessionStorage.getItem("elue-capitest") ?? undefined;
  } catch {
    return undefined;
  }
}

export function trackingNow(): { fbp?: string; fbc?: string; url: string; ua: string; testCode?: string } {
  const a = readAttribution();
  let fbc = cookie("_fbc");
  if (!fbc && a?.fbclid) fbc = `fb.1.${a.at}.${a.fbclid}`; // Meta's documented format
  return { fbp: cookie("_fbp") || undefined, fbc: fbc || undefined, url: window.location.origin + window.location.pathname, ua: navigator.userAgent.slice(0, 300), testCode: testCode() };
}

// «How did you hear about us?» (optional on the checkout).
export const HEARD_OPTIONS = [
  { key: "ig_ad", label: "إعلان على إنستغرام" },
  { key: "ig_page", label: "صفحة ÉLUE على إنستغرام" },
  { key: "creator", label: "مؤثر أو صانع محتوى" },
  { key: "friend", label: "صديق أو قريب" },
  { key: "whatsapp", label: "واتساب" },
  { key: "other", label: "غير ذلك" },
] as const;
export type HeardKey = (typeof HEARD_OPTIONS)[number]["key"];
export const heardLabel = (k?: string | null) => HEARD_OPTIONS.find((o) => o.key === k)?.label ?? "";
