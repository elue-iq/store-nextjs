"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "./CartProvider";

export function AddToCartButton({ slug, label = "أضف للسلة" }: { slug: string; label?: string }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      className="btn btn--quiet"
      onClick={() => {
        add(slug, 1);
        setAdded(true);
        setTimeout(() => setAdded(false), 1600);
      }}
    >
      {added ? "انضافت للسلة" : label}
    </button>
  );
}

export function ProductBuyBox({ slug }: { slug: string }) {
  const { add } = useCart();
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  return (
    <div className="buy-box">
      <div className="stepper" role="group" aria-label="الكمية">
        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="قلل الكمية">
          −
        </button>
        <output aria-live="polite">{qty}</output>
        <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="زيد الكمية">
          +
        </button>
      </div>
      <button
        type="button"
        className="btn btn--quiet"
        onClick={() => {
          add(slug, qty);
          setAdded(true);
          setTimeout(() => setAdded(false), 1600);
        }}
      >
        {added ? "انضافت للسلة" : "أضف للسلة"}
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => {
          add(slug, qty);
          router.push("/order");
        }}
      >
        اطلب الآن
      </button>
    </div>
  );
}
