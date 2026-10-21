// Builds the order summary. Shared by the API route (Telegram message)
// and the browser (WhatsApp fallback text), so both always match.

import { getProduct, type Product } from "./products";
import { formatIQD } from "./site";

export type CartItem = { slug: string; qty: number };

export type OrderLine = { product: Product; qty: number; subtotal: number };

export const MAX_QTY_PER_LINE = 20;

export function priceCart(items: CartItem[]): { lines: OrderLine[]; total: number } {
  const lines: OrderLine[] = [];
  for (const item of items) {
    const product = getProduct(item.slug);
    const qty = Math.floor(Number(item.qty));
    if (!product || !Number.isFinite(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) continue;
    lines.push({ product, qty, subtotal: product.price * qty });
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

// Plain text, used for the WhatsApp fallback message.
export function buildWhatsAppText(details: OrderDetails, items: CartItem[]): string {
  const { lines, total } = priceCart(items);
  const rows = lines.map((l) => `${l.qty} × ${l.product.nameEn} (${l.product.nameAr})`);
  const text = [
    "مرحباً ÉLUE، أريد أطلب:",
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
