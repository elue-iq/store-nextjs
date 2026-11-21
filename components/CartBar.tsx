"use client";

// The cart bar at the bottom of the shop (home, product pages, reviews) once something is in
// the cart, like delivery apps: how far the cart is from free delivery (one step per jar),
// then the jar count, «عرض السلة» and the total. Hidden on the cart page itself and in the
// team's screens.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "./CartProvider";
import { useStock } from "./StockProvider";
import { priceCart } from "@/lib/order-text";
import { formatIQD, freeDeliveryFor, site } from "@/lib/site";

const SHOP = (path: string) => path === "/" || path.startsWith("/products/") || path === "/reviews";

// «أضيفوا علبة وحدة» … the same wording as the cart page.
export function FreeDeliveryProgress({ jars }: { jars: number }) {
  const need = site.freeDeliveryMinJars;
  const left = need - jars;
  const done = freeDeliveryFor(jars);
  const n = left === 1 ? "علبة وحدة" : left === 2 ? "علبتين" : `${left} علب`;
  return (
    <div className={`free-progress${done ? " is-done" : ""}`} role="status" aria-live="polite">
      <p>
        {done ? (
          <>
            <span aria-hidden="true">✓ </span>التوصيل مجاني لطلبكم
          </>
        ) : (
          <>
            أضيفوا <strong>{n}</strong> ويصير التوصيل مجاني
          </>
        )}
      </p>
      <span className="free-progress__steps" aria-hidden="true">
        {Array.from({ length: need }, (_, i) => (
          <i key={i} className={i < jars ? "is-on" : undefined} />
        ))}
      </span>
    </div>
  );
}

export function CartBar() {
  const pathname = usePathname();
  const cart = useCart();
  const stock = useStock();
  if (!SHOP(pathname) || cart.count < 1) return null;
  const { total } = priceCart(cart.items, undefined, stock.priceOf);
  return (
    <>
      <div className="cart-bar-space" aria-hidden="true" />
      <div className="cart-bar">
        <FreeDeliveryProgress jars={cart.count} />
        <Link href="/order" className="cart-bar__go">
          <span className="cart-bar__count">{cart.count}</span>
          <span className="cart-bar__label">عرض السلة</span>
          <span className="cart-bar__total">{formatIQD(total)}</span>
        </Link>
      </div>
    </>
  );
}
