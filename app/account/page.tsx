import type { Metadata } from "next";
import { AccountView } from "@/components/AccountView";

export const metadata: Metadata = {
  title: "حسابي",
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <section className="panel-page">
      <AccountView />
    </section>
  );
}
