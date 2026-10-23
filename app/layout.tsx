import type { Metadata, Viewport } from "next";
// Fonts are self-hosted (no request to Google): Cairo for Arabic, Bodoni Moda for English display.
import "@fontsource-variable/cairo/wght.css";
import "@fontsource-variable/bodoni-moda/opsz.css";
import "@fontsource-variable/bodoni-moda/opsz-italic.css";
import "./globals.css";
import { CartProvider } from "@/components/CartProvider";
import { ToastProvider } from "@/components/Toast";
import { AuthProvider } from "@/components/AuthProvider";
import { StockProvider } from "@/components/StockProvider";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { siteUrl } from "@/lib/site";

const description =
  "ترافل شوكولاتة قليل السعرات ومحسوبها، بلا سكر مضاف. أربع نكهات، وسعرات كل قطعة مدوّنة على العلبة. التوصيل داخل بغداد.";

// Anything that isn't the live site (the dev copy, a local build) is marked and hidden from search.
const TEST_COPY = process.env.NEXT_PUBLIC_STAGE !== "amplify";

export const metadata: Metadata = {
  ...(TEST_COPY ? { robots: { index: false, follow: false } } : {}),
  metadataBase: new URL(siteUrl()),
  title: { default: "ÉLUE — Chocolate Truffles", template: "%s — ÉLUE" },
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: "ÉLUE — Chocolate Truffles",
    description: "سعرات قليلة ومتعة أكبر",
    url: "/",
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
        {TEST_COPY && (
          <div className="stage-banner" role="note">
            نسخة التطوير — للتجربة فقط. الطلبات هنا لا تصل إلى الفريق ولا إلى مدن.
          </div>
        )}
        <ToastProvider>
          <AuthProvider>
            <StockProvider>
              <CartProvider>
                <Header />
                <main>{children}</main>
                <Footer />
              </CartProvider>
            </StockProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
