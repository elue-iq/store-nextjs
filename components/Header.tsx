"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import { useCart } from "./CartProvider";

export function Header() {
  const { count, ready } = useCart();
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-header__logo" aria-label="ÉLUE — الصفحة الرئيسية">
          <Logo />
        </Link>
        <nav className="site-header__nav" aria-label="القائمة">
          <Link href="/#flavors">النكهات</Link>
          <Link href="/account">طلباتي</Link>
          <Link href="/order" className="cart-link">
            السلة
            <span className="cart-link__count" aria-label={`${count} قطع في السلة`}>
              {ready ? count : 0}
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
