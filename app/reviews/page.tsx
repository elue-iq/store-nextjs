import type { Metadata } from "next";
import { ReviewsView } from "@/components/ReviewsView";

export const metadata: Metadata = {
  title: "تقييمات الزبائن",
  description: "كل تقييمات زبائن ÉLUE كما كتبوها، بلا تعديل ولا حذف.",
  alternates: { canonical: "/reviews" },
};

export default function ReviewsPage() {
  return (
    <section className="panel-page">
      <ReviewsView />
    </section>
  );
}
