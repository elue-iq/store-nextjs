"use client";

import Link from "next/link";
import { Logo } from "./Logo";
import { useCart } from "./CartProvider";
import { useAuth } from "./AuthProvider";

export function Header() {
  const { count, ready } = useCart();
  const auth = useAuth();
  const signedIn = auth.status === "signedIn";
  const items = ready ? count : 0;
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
          <Link
            href="/account"
            className={signedIn ? "icon-link icon-link--signed-in" : "icon-link"}
            aria-label={signedIn ? "حسابي" : "تسجيل الدخول"}
            title={signedIn ? "حسابي" : "تسجيل الدخول"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="icon-link__svg">
              <circle cx="12" cy="8.3" r="3.7" />
              <path d="M4.6 20c1.2-3.6 4.1-5.5 7.4-5.5s6.2 1.9 7.4 5.5" />
            </svg>
            {signedIn && <span className="icon-link__dot" aria-hidden="true" />}
          </Link>
          <Link href="/order" className="icon-link" aria-label={`السلة: ${items}`} title="السلة">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="icon-link__svg">
              <path d="M5.2 8.5h13.6l-1.1 10.6a1.6 1.6 0 0 1-1.6 1.4H7.9a1.6 1.6 0 0 1-1.6-1.4L5.2 8.5Z" />
              <path d="M8.8 8.5V7a3.2 3.2 0 0 1 6.4 0v1.5" />
            </svg>
            {items > 0 && (
              <span className="icon-link__count" aria-hidden="true">
                {items}
              </span>
            )}
          </Link>
        </nav>
      </div>
    </header>
  );
}
