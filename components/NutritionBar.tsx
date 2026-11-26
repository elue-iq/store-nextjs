"use client";

import Link from "next/link";
import { useCart } from "./CartProvider";
import { useStock } from "./StockProvider";
import { jarsLabel, useAddWithToast } from "./AddToCart";
import { getProduct } from "@/lib/products";
import { formatIQD, site } from "@/lib/site";
import { IconBag, IconCheck, IconInstagram, IconWhatsApp } from "./LinkIcons";

// The bar floating at the bottom of the nutrition pages: one main button that follows the
// cart (order / add this flavor / finish the order), with Instagram and WhatsApp beside it.
export function NutritionBar({ slug }: { slug?: string }) {
  const cart = useCart();
  const stock = useStock();
  const addWithToast = useAddWithToast();
  const product = slug ? getProduct(slug) : undefined;
  const jars = cart.ready ? cart.count : 0;
  const here = product && cart.ready ? (cart.items.find((i) => i.slug === product.slug)?.qty ?? 0) : 0;

  let main: React.ReactNode;
  if (product && !here) {
    main = stock.isAvailable(product.slug) ? (
      <button type="button" className="lk-bar__main" onClick={() => addWithToast(product.slug, 1, false)}>
        <IconBag />
        أضيفوا للسلة · {formatIQD(stock.priceOf(product))}
      </button>
    ) : (
      <button type="button" className="lk-bar__main" disabled>
        {stock.isHidden(product.slug) ? "غير متوفرة حاليًا" : "نفدت الكمية حاليًا"}
      </button>
    );
  } else if (jars) {
    main = (
      <Link href="/order" className={`lk-bar__main${here ? " lk-bar__main--done" : ""}`}>
        {here ? <IconCheck /> : <IconBag />}
        أكملوا الطلب · {jarsLabel(jars)}
      </Link>
    );
  } else {
    main = (
      <Link href="/#flavors" className="lk-bar__main">
        <IconBag />
        اطلبوا من الموقع
      </Link>
    );
  }

  return (
    <>
      <div className="lk-bar-space" aria-hidden="true" />
      <div className="lk-bar">
        {main}
        <a className="lk-bar__icon" href={site.instagramUrl} target="_blank" rel="noopener noreferrer" aria-label="إنستغرام ÉLUE">
          <IconInstagram />
        </a>
        <a
          className="lk-bar__icon"
          href={`https://wa.me/${site.whatsappNumber}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="واتساب ÉLUE"
        >
          <IconWhatsApp />
        </a>
      </div>
    </>
  );
}
