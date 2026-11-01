import type { Metadata } from "next";
import { CourierView } from "@/components/CourierView";

export const metadata: Metadata = {
  title: "تطبيق المندوب",
  robots: { index: false },
};

export default function CourierPage() {
  return (
    <section className="panel-page">
      <CourierView />
    </section>
  );
}
