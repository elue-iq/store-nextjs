"use client";

import { useEffect, useRef, useState } from "react";
import { dataClient } from "@/lib/data";
import { normalizeCode } from "@/lib/coupons";
import { formatIQD } from "@/lib/site";

// The server's price for a cart (query «quote»): coupon, credit, delivery. The checkout
// shows exactly what placeOrder will charge.
export type Quote = {
  subtotal: number;
  discount: number;
  creditUsed: number;
  total: number;
  freeDelivery: boolean;
  deliveryFee: number;
  pay: number;
  cashback: number;
  freeJars: number;
  jars: number;
  credit: number;
  coupon: { code: string; ok: boolean; label?: string; error?: string | null; hint?: string | null } | null;
  campaign: { slug: string } | null;
};

export function useQuote(o: {
  items: { slug: string; qty: number }[];
  couponCode: string;
  refCode: string;
  signedIn: boolean;
  phone?: string; // the team pricing an order for this customer
  enabled?: boolean;
}): { quote: Quote | null; loading: boolean } {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify([o.items, o.couponCode, o.refCode, o.signedIn, o.phone]);
  const seq = useRef(0);
  useEffect(() => {
    if (o.enabled === false || !o.items.length) {
      setQuote(null);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const t = setTimeout(() => {
      dataClient.queries
        .quote(
          { items: JSON.stringify(o.items), couponCode: o.couponCode || undefined, ref: o.refCode || undefined, phone: o.phone || undefined },
          { authMode: o.signedIn ? "userPool" : "apiKey" },
        )
        .then(({ data, errors }) => {
          if (mine !== seq.current) return;
          if (errors?.length || typeof data !== "string") {
            console.error("quote failed", errors);
            setQuote(null);
          } else setQuote(JSON.parse(data) as Quote);
        })
        .catch((err) => {
          if (mine === seq.current) {
            console.error("quote failed", err);
            setQuote(null);
          }
        })
        .finally(() => {
          if (mine === seq.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, o.enabled]);
  return { quote, loading };
}

// «عندكم كود خصم؟»: type a code, see it applied (or why not), remove it.
export function CouponBox({
  code,
  quote,
  loading,
  onApply,
  onRemove,
}: {
  code: string; // the code in use ("" = none)
  quote: Quote | null;
  loading: boolean;
  onApply: (code: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const c = quote?.coupon;
  if (code) {
    return (
      <div className={c && !c.ok ? "coupon-box is-bad" : "coupon-box is-on"}>
        <div className="coupon-box__chip">
          <span>
            <strong dir="ltr">{code}</strong>
            {c?.ok ? ` · ${c.label}` : loading ? " · نتحقق…" : ""}
          </span>
          <button type="button" className="link-button" onClick={onRemove} aria-label="إزالة الكود">
            إزالة
          </button>
        </div>
        {c && !c.ok && c.error && <p className="field-error">{c.error}</p>}
        {c?.hint && <p className="coupon-box__hint">{c.hint}</p>}
      </div>
    );
  }
  if (!open) {
    return (
      <button type="button" className="link-button coupon-box__open" onClick={() => setOpen(true)}>
        عندكم كود خصم؟
      </button>
    );
  }
  return (
    <form
      className="coupon-box coupon-box__form"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const n = normalizeCode(typed);
        if (n) onApply(n);
      }}
    >
      <label>
        <span className="visually-hidden">كود الخصم</span>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          dir="ltr"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="كود الخصم"
          maxLength={32}
          autoFocus
        />
      </label>
      <button type="submit" className="btn btn--small" disabled={!normalizeCode(typed)}>
        تطبيق
      </button>
    </form>
  );
}

// Subtotal, discount, credit and total lines (shown when there is a discount or credit).
export function PriceLines({ quote }: { quote: Quote | null }) {
  if (!quote || (!quote.discount && !quote.creditUsed && !quote.cashback)) return null;
  return (
    <dl className="price-lines">
      {(quote.discount > 0 || quote.creditUsed > 0) && (
        <div>
          <dt>قبل الخصم</dt>
          <dd>{formatIQD(quote.subtotal)}</dd>
        </div>
      )}
      {quote.discount > 0 && (
        <div className="is-off">
          <dt>{quote.coupon?.label ?? "الخصم"}</dt>
          <dd>−{formatIQD(quote.discount)}</dd>
        </div>
      )}
      {quote.creditUsed > 0 && (
        <div className="is-off">
          <dt>من رصيدكم</dt>
          <dd>−{formatIQD(quote.creditUsed)}</dd>
        </div>
      )}
      {quote.cashback > 0 && (
        <div className="is-off">
          <dt>تنضاف لرصيدكم بعد التسليم</dt>
          <dd>{formatIQD(quote.cashback)}</dd>
        </div>
      )}
    </dl>
  );
}
