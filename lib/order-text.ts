// Builds the order summary. Shared by the API route (Telegram message)
// and the browser (WhatsApp fallback text), so both always match.

import { getProduct, type Product } from "./products";
import { formatIQD } from "./site";

export type CartItem = { slug: string; qty: number };

export type OrderLine = { product: Product; qty: number; price: number; subtotal: number }; // price: one jar, as sold

export const MAX_QTY_PER_LINE = 20;
export const MAX_WHOLESALE_QTY = 500; // per flavor on a wholesale (B2B) order

// priceOf: the jar price to use (default the site price; the shop and server pass the
// discounted one, see lib/product-settings.ts).
export function priceCart(
  items: CartItem[],
  maxQty: number = MAX_QTY_PER_LINE,
  priceOf: (p: Product) => number = (p) => p.price,
): { lines: OrderLine[]; total: number } {
  const lines: OrderLine[] = [];
  for (const item of items) {
    const product = getProduct(item.slug);
    const qty = Math.floor(Number(item.qty));
    if (!product || !Number.isFinite(qty) || qty < 1 || qty > maxQty) continue;
    const price = priceOf(product);
    lines.push({ product, qty, price, subtotal: price * qty });
  }
  const total = lines.reduce((sum, l) => sum + l.subtotal, 0);
  return { lines, total };
}

export type OrderDetails = {
  name: string;
  phoneDisplay: string;
  address: string;
  note?: string;
};

// Plain text for WhatsApp. With an order number it's the "follow your order"
// message sent after ordering; without one it's the fallback order message.
export function buildWhatsAppText(details: OrderDetails, items: CartItem[], orderId?: string, gifts: CartItem[] = []): string {
  const { lines, total } = priceCart(items);
  const rows = [
    ...lines.map((l) => `${l.qty} × ${l.product.nameEn} (${l.product.nameAr})`),
    // Gift jars: 0 IQD, never part of the total.
    ...priceCart(gifts).lines.map((l) => `${l.qty} × ${l.product.nameEn} (${l.product.nameAr}) — هدية`),
  ];
  const text = [
    orderId ? `مرحبًا ÉLUE، هذا طلبي رقم ${orderId}:` : "مرحبًا ÉLUE، أودّ أن أطلب:",
    ...rows,
    `المجموع: ${formatIQD(total)}`,
    "",
    `الاسم: ${details.name}`,
    `الرقم: ${details.phoneDisplay}`,
    `العنوان: ${details.address}`,
  ];
  if (details.note) text.push(`ملاحظة: ${details.note}`);
  return text.join("\n");
}
