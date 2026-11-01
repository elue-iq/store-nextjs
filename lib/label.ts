// Shipping label for orders our own couriers deliver: 4×6 in (like the Modon Express
// label), drawn on a canvas (correct Arabic) and saved as a PDF. One order gives a
// one-page PDF; several give one PDF with a page per order, ready to print at once.

import qrcode from "qrcode-generator";
import { LOGO_PATH, LOGO_VIEWBOX } from "./brand-mark";
import { collectAmount, type DispatchOrder } from "./dispatch";
import { fullAddress } from "./iraq";
import { formatIraqiMobile } from "./phone";
import { makePdf, type PdfPage } from "./pdf";
import { loadFonts } from "./receipt";
import { deliveryPayOf, formatIQD, site } from "./site";

export type LabelOrder = DispatchOrder & { createdAt?: string | null };

// 100×150 mm (4×6 in, the Modon Express size) at 300 dpi. Thermal printers print
// black only, so the label is pure black on white: no colours, greys or tinted boxes.
const W = 1200;
const H = 1800;
const M = 64;
const AR = '"Cairo Variable", "Cairo", "Segoe UI", Tahoma, sans-serif';
const BLACK = "#000";

type TextOpts = { size: number; weight?: number; align?: CanvasTextAlign; dir?: CanvasDirection };

function jarsWord(n: number): string {
  if (n === 1) return "علبة واحدة";
  if (n === 2) return "علبتان";
  if (n <= 10) return `${n} علب`;
  return `${n} علبة`;
}

function dateText(iso?: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short" }).format(d);
}

function drawLabel(ctx: CanvasRenderingContext2D, o: LabelOrder, courierName: string) {
  const R = W - M;
  const text = (s: string, x: number, y: number, t: TextOpts) => {
    ctx.font = `${t.weight ?? 500} ${t.size}px ${AR}`;
    ctx.fillStyle = BLACK;
    ctx.direction = t.dir ?? "rtl";
    ctx.textAlign = t.align ?? "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y);
  };
  const wrap = (s: string, maxWidth: number, t: TextOpts): string[] => {
    ctx.font = `${t.weight ?? 500} ${t.size}px ${AR}`;
    ctx.direction = t.dir ?? "rtl";
    const out: string[] = [];
    for (const para of s.split(/\n+/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(test).width > maxWidth) {
          out.push(line);
          line = word;
        } else line = test;
      }
      if (line) out.push(line);
    }
    return out;
  };
  const rule = (y: number, h = 4) => {
    ctx.fillStyle = BLACK;
    ctx.fillRect(M, y, W - 2 * M, h);
  };
  // A small label above a bold value (like the Modon label).
  const field = (label: string, value: string, y: number, size = 54): number => {
    text(label, R, y, { size: 32, weight: 400 });
    text(value, R, y + size + 14, { size, weight: 800 });
    return y + size + 14;
  };

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Header: wordmark on the right, who delivers on the left.
  const logoW = 280;
  const scale = logoW / LOGO_VIEWBOX.width;
  ctx.save();
  ctx.translate(R - logoW - LOGO_VIEWBOX.x * scale, 50 - LOGO_VIEWBOX.y * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = BLACK;
  ctx.fill(new Path2D(LOGO_PATH), "evenodd");
  ctx.restore();
  text("توصيل محلي", M, 84, { size: 38, weight: 400, align: "left" });
  text(courierName, M, 142, { size: 48, weight: 800, align: "left" });
  rule(196, 6);

  // QR code (left), order number and date (right).
  const qrSize = 270;
  const qrX = M;
  const qrY = 236;
  const qr = qrcode(0, "M");
  qr.addData(o.orderNumber);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.floor(qrSize / (n + 2));
  const qrPx = cell * (n + 2);
  ctx.fillStyle = "#fff";
  ctx.fillRect(qrX, qrY, qrPx, qrPx);
  ctx.fillStyle = BLACK;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(qrX + (c + 1) * cell, qrY + (r + 1) * cell, cell, cell);
  text("رقم الطلب", R, qrY + 56, { size: 34, weight: 400 });
  text(o.orderNumber, R, qrY + 170, { size: 120, weight: 800, dir: "ltr" });
  text(dateText(o.createdAt), R, qrY + 232, { size: 40, weight: 500, dir: "ltr" });

  let y = qrY + qrPx + 30;
  rule(y);

  // Recipient.
  y += 52;
  y = field("اسم الزبون", o.name, y, 62);
  y += 70;
  text("هاتف الزبون", R, y, { size: 32, weight: 400 });
  y += 96;
  text(formatIraqiMobile(o.phone).replace(/ /g, ""), R, y, { size: 100, weight: 800, dir: "ltr" });
  y += 30;
  rule(y, 3);
  y += 56;
  text("العنوان", R, y, { size: 32, weight: 400 });
  for (const line of wrap(fullAddress(o), W - 2 * M, { size: 48, weight: 800 }).slice(0, 3)) {
    y += 62;
    text(line, R, y, { size: 48, weight: 800 });
  }
  if (o.note) {
    y += 52;
    text("ملاحظة الزبون", R, y, { size: 32, weight: 400 });
    for (const line of wrap(o.note, W - 2 * M, { size: 38, weight: 600 }).slice(0, 2)) {
      y += 50;
      text(line, R, y, { size: 38, weight: 600 });
    }
  }

  // Bottom block is anchored to the page's bottom so it always prints in the same place.
  const collect = collectAmount(o);
  const delivery = deliveryPayOf(o);
  const jars = o.jars ?? (o.items ?? []).reduce((s, i) => s + (i?.qty ?? 0), 0);
  const footerTop = H - 500;

  // Goods, between the address and the amount box.
  const flavors = (o.items ?? [])
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .map((i) => `${i.nameAr} × ${i.qty}`)
    .join("  ·  ");
  const itemsY = Math.max(y + 86, footerTop - 170);
  rule(itemsY - 52, 3);
  text(`ترافل شوكولاتة · ${jarsWord(jars)} · مبرّد`, R, itemsY + 6, { size: 44, weight: 800 });
  wrap(flavors, W - 2 * M, { size: 38, weight: 500 })
    .slice(0, 2)
    .forEach((line, i) => text(line, R, itemsY + 62 + i * 48, { size: 38, weight: 500 }));

  // The amount the courier collects, in a thick frame.
  const boxH = 250;
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 8;
  ctx.strokeRect(M, footerTop, W - 2 * M, boxH);
  if (collect > 0) {
    text("المطلوب من الزبون", R - 28, footerTop + 70, { size: 40, weight: 800 });
    text(formatIQD(collect), R - 28, footerTop + 206, { size: 140, weight: 800 });
    const parts = [
      o.paid ? "الطلب مدفوع" : `الطلب ${formatIQD(o.total)}`,
      delivery === "driver" ? `التوصيل ${formatIQD(site.deliveryFee)}` : delivery === "prepaid" ? "التوصيل مدفوع" : "التوصيل مجاني",
    ].join(" + ");
    text(parts, M + 28, footerTop + 70, { size: 32, weight: 500, align: "left" });
  } else {
    text("مدفوع بالكامل", R - 28, footerTop + 76, { size: 40, weight: 800 });
    text("لا يُطلب أي مبلغ", R - 28, footerTop + 200, { size: 96, weight: 800 });
  }

  // Footer notes.
  let fy = footerTop + boxH + 66;
  if (o.province === site.baghdadWindow.province) {
    text(`موعد التوصيل في بغداد: ${site.baghdadWindow.short}`, R, fy, { size: 42, weight: 800 });
    fy += 60;
  }
  text(site.returnBoxNote, R, fy, { size: 46, weight: 800 });
  fy += 58;
  text(`للاستفسار: ${site.whatsappDisplay.replace(/ /g, "")}`, R, fy, { size: 38, weight: 500 });
  text("ÉLUE", M, fy, { size: 44, weight: 800, align: "left", dir: "ltr" });
}

// Thermal printers have no greys: every pixel becomes black or white, so edges stay sharp.
function toBlackAndWhite(ctx: CanvasRenderingContext2D) {
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 150 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

async function labelJpeg(o: LabelOrder, courierName: string): Promise<PdfPage> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  drawLabel(ctx, o, courierName);
  toBlackAndWhite(ctx);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("label_failed"))), "image/jpeg", 0.98),
  );
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: W, height: H };
}

// 100×150 mm in PDF points (the same page size as the Modon label).
export async function buildLabelsPdf(orders: LabelOrder[]): Promise<Blob> {
  await loadFonts();
  const pages: PdfPage[] = [];
  for (const o of orders) pages.push(await labelJpeg(o, o.courierName ?? ""));
  return makePdf(pages, 283.465, 425.197);
}

// A preview picture of one label (for tests).
export async function buildLabelPng(o: LabelOrder): Promise<Blob> {
  await loadFonts();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  drawLabel(ctx, o, o.courierName ?? "");
  toBlackAndWhite(ctx);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("label_failed"))), "image/png"));
}

export function labelsFilename(orders: LabelOrder[]): string {
  return orders.length === 1 ? `ELUE-label-${orders[0].orderNumber}.pdf` : `ELUE-labels-${orders.length}-${dateText()}.pdf`;
}
