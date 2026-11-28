import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AdminView } from "@/components/AdminView";
import { AdminInstall } from "@/components/AdminInstall";
import { AdminInbox } from "@/components/AdminInbox";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = {
  title: "لوحة الطلبات",
  robots: { index: false, follow: false },
  // Installable as its own app ("طلبات ÉLUE") from this page only.
  manifest: "/admin-app/manifest.webmanifest",
  appleWebApp: { capable: true, title: "طلبات ÉLUE", statusBarStyle: "default" },
  icons: { apple: "/admin-app/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#F5EFE6",
  viewportFit: "cover",
};

export default function AdminPage() {
  return (
    <div className="admin-app">
      <header className="admin-bar">
        <Link href="/admin" className="admin-bar__brand" aria-label="لوحة الطلبات">
          <Logo className="admin-bar__logo" />
        </Link>
        <div className="admin-bar__tools">
          <AdminInstall />
          <AdminInbox />
        </div>
      </header>
      <section className="panel-page panel-page--wide admin-page">
        <AdminView />
      </section>
    </div>
  );
}
