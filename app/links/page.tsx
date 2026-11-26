import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { products } from "@/lib/products";
import { site } from "@/lib/site";
import { IconBag, IconForward, IconInstagram, IconLeaf, IconLinkedIn, IconStar, IconTikTok, IconWhatsApp } from "@/components/LinkIcons";

// The links page: where the QR on the jar leads (elue-iq.com/q, see next.config) and the
// link for Instagram's bio. Every way to reach ÉLUE in one screen.
export const metadata: Metadata = {
  title: "روابط ÉLUE",
  description: "السعرات والمكونات لكل نكهة، الطلب من الموقع، تقييمات الزبائن، وحساباتنا.",
  alternates: { canonical: "/links" },
};

type Social = { href: string; label: string; detail: string; icon: React.ReactNode };

export default function LinksPage() {
  const flavors = products.filter((p) => p.nutrition && p.image);
  // Accounts shown in this order; one without a link in lib/site.ts is left out.
  const socials: Social[] = [
    { href: site.instagramUrl, label: "إنستغرام", detail: site.instagramHandle, icon: <IconInstagram /> },
    { href: `https://wa.me/${site.whatsappNumber}`, label: "واتساب", detail: site.whatsappDisplay, icon: <IconWhatsApp /> },
    { href: site.tiktokUrl, label: "تيك توك", detail: site.tiktokHandle, icon: <IconTikTok /> },
    { href: site.linkedinUrl, label: "لينكدإن", detail: "ÉLUE", icon: <IconLinkedIn /> },
  ].filter((s) => s.href);

  return (
    <div className="lk">
      <header className="lk__brand">
        <Link href="/" aria-label="ÉLUE — الصفحة الرئيسية">
          <span className="lk__wordmark" dir="ltr">
            ÉLUE
          </span>
          <span className="lk__tagline" dir="ltr">
            CHOCOLATE TRUFFLES
          </span>
        </Link>
        <p>سعرات قليلة ومتعة أكبر</p>
      </header>

      <nav className="lk__list" aria-label="روابط ÉLUE">
        <Link href="/nutrition" className="lk-card lk-card--feature">
          <span className="lk-card__row">
            <span className="lk-card__icon">
              <IconLeaf />
            </span>
            <span className="lk-card__text">
              <strong>السعرات والمكونات</strong>
              <span>لكل نكهة: السعرات، القيم الغذائية، والمكونات</span>
            </span>
            <IconForward />
          </span>
          <span className="lk-card__jars" aria-hidden="true">
            {flavors.map((p) => (
              <Image key={p.slug} src={p.image!} alt="" width={120} height={120} sizes="72px" />
            ))}
          </span>
        </Link>

        <Link href="/#flavors" className="lk-card lk-card--primary">
          <span className="lk-card__icon">
            <IconBag />
          </span>
          <span className="lk-card__text">
            <strong>اطلبوا الآن</strong>
            <span>التوصيل لكل محافظات العراق</span>
          </span>
          <IconForward />
        </Link>

        <Link href="/reviews" className="lk-card">
          <span className="lk-card__icon">
            <IconStar />
          </span>
          <span className="lk-card__text">
            <strong>تقييمات الزبائن</strong>
            <span>شوفوا شنو كالوا اللي جرّبوها</span>
          </span>
          <IconForward />
        </Link>

        {socials.map((s) => (
          <a key={s.label} href={s.href} className="lk-card" target="_blank" rel="noopener noreferrer">
            <span className="lk-card__icon">{s.icon}</span>
            <span className="lk-card__text">
              <strong>{s.label}</strong>
              {s.detail && <span dir="ltr">{s.detail}</span>}
            </span>
            <IconForward />
          </a>
        ))}
      </nav>

      <p className="lk__foot" dir="ltr">
        © {new Date().getFullYear()} ÉLUE · Baghdad
      </p>
    </div>
  );
}
