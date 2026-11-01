import type { Metadata } from "next";
import { ReviewView } from "@/components/ReviewView";

export const metadata: Metadata = {
  title: "قيّم طلبك",
  robots: { index: false },
};

export default function ReviewPage() {
  return (
    <section className="panel-page">
      <ReviewView />
    </section>
  );
}
