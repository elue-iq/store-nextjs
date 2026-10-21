import { Logo } from "./Logo";
import { site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <Logo className="site-footer__logo" />
        <p className="site-footer__line">ÉLUE — اللذّة اللي تختارونها، بحساب</p>
        <ul className="site-footer__links">
          <li>
            <a href={site.instagramUrl} target="_blank" rel="noopener noreferrer">
              إنستغرام <span dir="ltr">{site.instagramHandle}</span>
            </a>
          </li>
          <li>
            <a href={`https://wa.me/${site.whatsappNumber}`} target="_blank" rel="noopener noreferrer">
              واتساب <span dir="ltr">{site.whatsappDisplay}</span>
            </a>
          </li>
        </ul>
        <p className="site-footer__legal" dir="ltr">© {new Date().getFullYear()} ÉLUE</p>
      </div>
    </footer>
  );
}
