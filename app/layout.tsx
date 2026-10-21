import type { Metadata, Viewport } from "next";
// Fonts are self-hosted (no request to Google): Cairo for Arabic, Bodoni Moda for English display.
import "@fontsource-variable/cairo/wght.css";
import "@fontsource-variable/bodoni-moda/opsz.css";
import "@fontsource-variable/bodoni-moda/opsz-italic.css";
import "./globals.css";
import { CartProvider } from "@/components/CartProvider";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { siteUrl } from "@/lib/site";

const description =
  "ترافلز شوكولاتة قليلة ومحسوبة السعرات، بدون سكر مضاف. أربع نكهات، وسعرات كل قطعة مكتوبة على العلبة. التوصيل داخل بغداد.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "ÉLUE — Chocolate Truffles", template: "%s — ÉLUE" },
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: "ÉLUE — Chocolate Truffles",
    description: "متعة الشوكولاتة، بحسابات أذكى",
    locale: "ar_IQ",
    type: "website",
    siteName: "ÉLUE",
    images: [{ url: "/hero/og.jpg", width: 1200, height: 630, alt: "ÉLUE chocolate truffle" }],
  },
  twitter: { card: "summary_large_image", images: ["/hero/og.jpg"] },
};

export const viewport: Viewport = {
  themeColor: "#F5EFE6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <CartProvider>
          <Header />
          <main>{children}</main>
          <Footer />
        </CartProvider>
      </body>
    </html>
  );
}
