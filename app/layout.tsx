import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CartProvider } from "@/components/CartProvider";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: { default: "ÉLUE — Chocolate Truffles", template: "%s — ÉLUE" },
  description: "ترافلز شوكولاتة قليلة ومحسوبة السعرات، بدون سكر مضاف. أربع نكهات، وسعرات كل قطعة مكتوبة على العلبة.",
  openGraph: {
    title: "ÉLUE — Chocolate Truffles",
    description: "متعة الشوكولاتة، بحسابات أذكى",
    locale: "ar_IQ",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#F5EFE6",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..700;1,6..96,400..700&family=IBM+Plex+Sans+Arabic:wght@300;400;500;600&display=swap"
        />
      </head>
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
