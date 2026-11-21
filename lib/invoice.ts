// Invoice (فاتورة) for any order, as an A4 PDF, made in the browser. The order is the invoice:
// its number is the invoice number. Used most for wholesale (B2B) orders, whose business name
// heads the «إلى» block. Drawn on a canvas (correct Arabic) and saved as one JPEG page.

import { LOGO_PATH, LOGO_VIEWBOX } from "./brand-mark";
import { getProduct } from "./products";
import { fullAddress } from "./iraq";
import { formatIraqiMobile } from "./phone";
import { makePdf } from "./pdf";
import { loadFonts } from "./receipt";
import { orderTime } from "./order-time";
import { deliveryPayOf, formatIQD, site } from "./site";
import { isWholesale } from "./wholesale";

export type InvoiceOrder = {
  orderNumber: string;
  createdAt: string;
  orderedAt?: string | null;
  items: ({ slug?: string; nameAr: string; nameEn: string; qty: number; price: number; gift?: boolean | null } | null)[];
  total: number;
  subtotal?: number | null;
  discount?: number | null;
  creditUsed?: number | null;
  couponLabel?: string | null;
  couponCode?: string | null;
  name: string;
  phone: string;
  phone2?: string | null;
  province?: string | null;
  area?: string | null;
  address: string;
  note?: string | null;
  paid?: boolean | null;
  freeDelivery?: boolean | null;
  deliveryPaid?: boolean | null;
  saleType?: string | null;
  businessName?: string | null;
};

const W = 1240; // A4 at 150 dpi, drawn at 2× (300 dpi)
const H = 1754;
const SCALE = 2;
const M = 90;
const R = W - M;
const AR = '"Cairo Variable", "Cairo", "Segoe UI", Tahoma, sans-serif';
const C = {
  cream: "#F5EFE6",
  sand: "#EFE4D4",
  terracotta: "#A45A44",
  cocoa: "#5B3A2E",
  ink: "#3B2A23",
  muted: "#6E584C",
  rule: "#D9C4A8",
};

type TextOpts = { size: number; weight?: number; color?: string; align?: CanvasTextAlign; dir?: CanvasDirection };

const day = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short" }).format(new Date(iso));

function draw(ctx: CanvasRenderingContext2D, o: InvoiceOrder) {
  const text = (s: string, x: number, y: number, t: TextOpts) => {
    ctx.font = `${t.weight ?? 400} ${t.size}px ${AR}`;
    ctx.fillStyle = t.color ?? C.ink;
    ctx.direction = t.dir ?? "rtl";
    ctx.textAlign = t.align ?? "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y);
  };
  const wrap = (s: string, maxWidth: number, t: TextOpts): string[] => {
    ctx.font = `${t.weight ?? 400} ${t.size}px ${AR}`;
    ctx.direction = "rtl";
    const out: string[] = [];
    let line = "";
    for (const word of s.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = word;
      } else line = test;
    }
    if (line) out.push(line);
    return out;
  };
  const rule = (y: number, color = C.rule, h = 2) => {
    ctx.fillStyle = color;
    ctx.fillRect(M, y, W - 2 * M, h);
  };

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Header band with the wordmark.
  const bandH = 170;
  ctx.fillStyle = C.terracotta;
  ctx.fillRect(0, 0, W, bandH);
  const logoW = 250;
  const k = logoW / LOGO_VIEWBOX.width;
  ctx.save();
  ctx.translate(M - LOGO_VIEWBOX.x * k, (bandH - LOGO_VIEWBOX.height * k) / 2 - LOGO_VIEWBOX.y * k);
  ctx.scale(k, k);
  ctx.fillStyle = C.cream;
  ctx.fill(new Path2D(LOGO_PATH), "evenodd");
  ctx.restore();
  text("فاتورة", R, 112, { size: 62, weight: 700, color: C.cream });

  // Number, date, kind, payment.
  const wholesale = isWholesale(o);
  let y = bandH + 80;
  const meta: [string, string, CanvasDirection][] = [
    ["رقم الفاتورة", o.orderNumber, "ltr"],
    ["التاريخ", day(orderTime(o)), "ltr"],
    ["نوع البيع", wholesale ? "جملة" : "مفرد", "rtl"],
    ["الدفع", o.paid ? "مدفوعة" : "غير مدفوعة", "rtl"],
  ];
  const colW = (W - 2 * M) / meta.length;
  meta.forEach(([label, value, dir], i) => {
    const x = R - i * colW;
    text(label, x, y, { size: 22, color: C.muted });
    text(value, x, y + 44, { size: 30, weight: 700, color: i === 0 ? C.terracotta : C.ink, align: "right", dir });
  });
  y += 84;
  rule(y);

  // To.
  y += 64;
  text("إلى", R, y, { size: 22, color: C.muted });
  y += 48;
  const business = wholesale && o.businessName ? o.businessName : null;
  text(business ?? o.name, R, y, { size: 38, weight: 700, color: C.cocoa });
  const phones = [o.phone, o.phone2].filter(Boolean).map((p) => formatIraqiMobile(String(p))).join("  ·  ");
  const who = business ? `${o.name}  ·  ` : "";
  y += 46;
  ctx.font = `400 26px ${AR}`;
  text(who, R, y, { size: 26 });
  const whoW = who ? ctx.measureText(who).width : 0;
  text(phones, R - whoW, y, { size: 26, dir: "ltr", align: "right" });
  for (const line of wrap(fullAddress(o), W - 2 * M, { size: 26 })) {
    y += 40;
    text(line, R, y, { size: 26, color: C.muted });
  }

  // Lines.
  y += 60;
  const cols = { qty: M + 560, price: M + 330, sum: M + 24 };
  ctx.fillStyle = C.sand;
  ctx.fillRect(M, y, W - 2 * M, 64);
  const headY = y + 42;
  text("الصنف", R - 24, headY, { size: 24, weight: 700, color: C.cocoa });
  text("العدد", cols.qty, headY, { size: 24, weight: 700, color: C.cocoa, align: "center" });
  text("سعر العلبة", cols.price, headY, { size: 24, weight: 700, color: C.cocoa, align: "center" });
  text("المجموع", cols.sum, headY, { size: 24, weight: 700, color: C.cocoa, align: "left" });
  y += 64;
  const lines = o.items.filter((i): i is NonNullable<typeof i> => Boolean(i && i.qty > 0));
  let goods = 0;
  for (const l of lines) {
    const gift = Boolean(l.gift);
    const sum = gift ? 0 : l.price * l.qty;
    goods += sum;
    y += 52;
    text(getProduct(l.slug ?? "")?.nameAr ?? l.nameAr, R - 24, y, { size: 29, weight: 600 });
    text(String(l.qty), cols.qty, y, { size: 29, align: "center", dir: "ltr" });
    text(gift ? "هدية" : formatIQD(l.price), cols.price, y, { size: 27, align: "center", color: gift ? C.terracotta : C.ink });
    text(gift ? "0" : formatIQD(sum), cols.sum, y, { size: 29, weight: 600, align: "left" });
    y += 34;
    text(l.nameEn, R - 24, y, { size: 20, color: C.muted, dir: "ltr" });
    y += 24;
    rule(y, C.sand);
  }

  // Totals, on the left half.
  const delivery = deliveryPayOf(o);
  const fee = delivery === "gift" ? 0 : site.deliveryFee;
  const rows: [string, string, string?][] = [["مجموع الأصناف", formatIQD(o.subtotal ?? goods)]];
  if (o.discount) rows.push([`${o.couponLabel ?? "خصم"}${o.couponCode ? ` · ${o.couponCode}` : ""}`, `− ${formatIQD(o.discount)}`, C.terracotta]);
  if (o.creditUsed) rows.push(["من الرصيد", `− ${formatIQD(o.creditUsed)}`, C.terracotta]);
  rows.push(["أجور التوصيل", delivery === "gift" ? "مجاناً" : `${formatIQD(fee)}${delivery === "prepaid" ? " (مدفوعة)" : ""}`]);
  const grand = o.total + fee;
  const due = (o.paid ? 0 : o.total) + (delivery === "driver" ? fee : 0);
  const left = M;
  const mid = W / 2 - 20;
  y += 56;
  for (const [label, value, color] of rows) {
    text(label, mid, y, { size: 26, color: C.muted });
    text(value, left + 24, y, { size: 26, weight: 600, align: "left", color });
    y += 46;
  }
  y += 4;
  ctx.fillStyle = C.cocoa;
  ctx.fillRect(left, y - 30, mid - left + 10, 2);
  y += 26;
  text("الإجمالي", mid, y, { size: 32, weight: 700, color: C.cocoa });
  text(formatIQD(grand), left + 24, y, { size: 34, weight: 700, align: "left", color: C.cocoa });
  y += 54;
  text(due ? "المطلوب عند الاستلام" : "الحالة", mid, y, { size: 26, color: C.muted });
  text(due ? formatIQD(due) : "مدفوعة بالكامل", left + 24, y, { size: 28, weight: 700, align: "left", color: C.terracotta });

  if (o.note) {
    y += 80;
    for (const line of wrap(`ملاحظة: ${o.note}`, W - 2 * M, { size: 24 }).slice(0, 3)) {
      text(line, R, y, { size: 24, color: C.muted });
      y += 36;
    }
  }

  // Footer.
  rule(H - 150);
  text("شكراً لاختياركم ÉLUE", R, H - 92, { size: 28, weight: 700, color: C.cocoa });
  text(`elue-iq.com  ·  ${site.instagramHandle}`, M, H - 92, { size: 24, color: C.muted, align: "left", dir: "ltr" });
}

export async function buildInvoicePdf(o: InvoiceOrder): Promise<Blob> {
  await loadFonts();
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  draw(ctx, o);
  const jpeg = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("invoice_failed"))), "image/jpeg", 0.92),
  );
  const data = new Uint8Array(await jpeg.arrayBuffer());
  return makePdf([{ kind: "jpeg", data, width: W * SCALE, height: H * SCALE }], 595.28, 841.89);
}

export const invoiceFilename = (orderNumber: string) => `ELUE-invoice-${orderNumber}.pdf`;
