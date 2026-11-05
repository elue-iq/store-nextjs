import type { Metadata } from "next";
import { PaidView } from "@/components/PaidView";

export const metadata: Metadata = {
  title: "تأكيد الدفع",
  robots: { index: false },
};

export default function PaidPage() {
  return (
    <section className="panel-page">
      <PaidView />
    </section>
  );
}
