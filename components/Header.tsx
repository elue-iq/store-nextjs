"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import { useCart } from "./CartProvider";
import { useAuth } from "./AuthProvider";

export function Header() {
  const { count, ready } = useCart();
  const auth = useAuth();
  const signedIn = auth.status === "signedIn";
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-header__logo" aria-label="ÉLUE — الصفحة الرئيسية">
          <Logo />
        </Link>
        <nav className="site-header__nav" aria-label="القائمة">
          <Link href="/#flavors" className="site-header__flavors">
            النكهات
          </Link>
          <Link href="/account" className="account-link">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="account-link__icon">
              <circle cx="12" cy="8.5" r="3.6" />
              <path d="M4.8 19.5c1.2-3.3 4-5 7.2-5s6 1.7 7.2 5" />
            </svg>
            {signedIn ? "حسابي" : "تسجيل الدخول"}
          </Link>
          <Link href="/order" className="cart-link">
            السلة
            <span className="cart-link__count" aria-label={`${count} في السلة`}>
              {ready ? count : 0}
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
