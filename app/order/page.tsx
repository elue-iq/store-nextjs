import type { Metadata } from "next";
import { OrderFlow } from "@/components/OrderFlow";

export const metadata: Metadata = {
  title: "السلة والطلب",
  robots: { index: false },
};

export default function OrderPage() {
  return (
    <section className="order">
      <h1>السلة والطلب</h1>
      <OrderFlow />
    </section>
  );
}
