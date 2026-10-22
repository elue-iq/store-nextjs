"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "./CartProvider";
import { useToast } from "./Toast";
import { getProduct } from "@/lib/products";
import { useStock } from "./StockProvider";

// "علبة واحدة"، "علبتان"، "3 علب"، "11 علبة"
export function jarsLabel(n: number): string {
  if (n === 1) return "علبة واحدة";
  if (n === 2) return "علبتان";
  if (n <= 10) return `${n} علب`;
  return `${n} علبة`;
}

function useAddWithToast() {
  const { add } = useCart();
  const toast = useToast();
  return (slug: string, qty: number, withAction = true) => {
    add(slug, qty);
    const name = getProduct(slug)?.nameAr ?? "";
    toast({
      id: "cart",
      message: qty > 1 ? `أضفنا ${name} إلى السلة (${jarsLabel(qty)}).` : `أضفنا ${name} إلى السلة.`,
      action: withAction ? { label: "عرض السلة", href: "/order" } : undefined,
    });
  };
}

export function AddToCartButton({ slug, label = "أضف إلى السلة" }: { slug: string; label?: string }) {
  const addWithToast = useAddWithToast();
  const [added, setAdded] = useState(false);
  const { isAvailable } = useStock();
  if (!isAvailable(slug)) {
    return (
      <button type="button" className="btn btn--quiet btn--soldout" disabled>
        نفدت الكمية حاليًا
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn btn--quiet"
      onClick={() => {
        addWithToast(slug, 1);
        setAdded(true);
        setTimeout(() => setAdded(false), 1600);
      }}
    >
      {added ? "أُضيفت إلى السلة" : label}
    </button>
  );
}

export function ProductBuyBox({ slug }: { slug: string }) {
  const addWithToast = useAddWithToast();
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const { isAvailable } = useStock();

  if (!isAvailable(slug)) {
    return (
      <div className="buy-box">
        <p className="soldout-note">نفدت الكمية حاليًا. نعمل على توفيرها قريبًا، ويمكنك اختيار نكهة أخرى.</p>
      </div>
    );
  }

  return (
    <div className="buy-box">
      <div className="stepper" role="group" aria-label="الكمية">
        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="إنقاص الكمية">
          −
        </button>
        <output aria-live="polite">{qty}</output>
        <button type="button" onClick={() => setQty((q) => Math.min(20, q + 1))} aria-label="زيادة الكمية">
          +
        </button>
      </div>
      <button
        type="button"
        className="btn btn--quiet"
        onClick={() => {
          addWithToast(slug, qty);
          setAdded(true);
          setTimeout(() => setAdded(false), 1600);
        }}
      >
        {added ? "أُضيفت إلى السلة" : "أضف إلى السلة"}
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => {
          addWithToast(slug, qty, false);
          router.push("/order");
        }}
      >
        اطلب الآن
      </button>
    </div>
  );
}
