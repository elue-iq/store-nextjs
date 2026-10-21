import type { Metadata } from "next";
import { AdminView } from "@/components/AdminView";

export const metadata: Metadata = {
  title: "لوحة الطلبات",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return (
    <section className="panel-page panel-page--wide">
      <AdminView />
    </section>
  );
}
