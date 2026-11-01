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

// 4×6 in at 300 dpi.
const W = 1200;
const H = 1800;
const M = 64;
const C = {
  cream: "#F5EFE6",
  terracotta: "#A45A44",
  cocoa: "#5B3A2E",
  ink: "#222222",
  muted: "#5F4B40",
  rule: "#BFA98C",
};
const AR = '"Cairo Variable", "Cairo", "Segoe UI", Tahoma, sans-serif';

type TextOpts = { size: number; weight?: number; color?: string; align?: CanvasTextAlign; dir?: CanvasDirection };

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
    ctx.fillStyle = t.color ?? C.ink;
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
  const rule = (y: number, color = C.rule, h = 3) => {
    ctx.fillStyle = color;
    ctx.fillRect(M, y, W - 2 * M, h);
  };

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Header band with the wordmark, the courier on the left.
  const bandH = 190;
  ctx.fillStyle = C.terracotta;
  ctx.fillRect(0, 0, W, bandH);
  const logoW = 300;
  const scale = logoW / LOGO_VIEWBOX.width;
  ctx.save();
  ctx.translate(R - logoW - LOGO_VIEWBOX.x * scale, 44 - LOGO_VIEWBOX.y * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = C.cream;
  ctx.fill(new Path2D(LOGO_PATH), "evenodd");
  ctx.restore();
  text("توصيل محلي", M, 92, { size: 40, weight: 700, color: C.cream, align: "left" });
  text(courierName, M, 150, { size: 46, weight: 700, color: "#fff", align: "left" });

  // Order number, date and the QR code.
  const qrSize = 250;
  const qrX = R - qrSize;
  const qrY = bandH + 30;
  const qr = qrcode(0, "M");
  qr.addData(o.orderNumber);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.floor(qrSize / (n + 2));
  const qrPx = cell * (n + 2);
  ctx.fillStyle = "#fff";
  ctx.fillRect(qrX, qrY, qrPx, qrPx);
  ctx.fillStyle = "#000";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(qrX + (c + 1) * cell, qrY + (r + 1) * cell, cell, cell);
  text("رقم الطلب", qrX - 36, qrY + 60, { size: 34, color: C.muted });
  text(o.orderNumber, qrX - 36, qrY + 165, { size: 116, weight: 800, color: C.cocoa, dir: "ltr" });
  text(dateText(o.createdAt), qrX - 36, qrY + 225, { size: 38, color: C.muted, dir: "ltr" });

  let y = qrY + qrPx + 30;
  rule(y);

  // Recipient: name, phone, address.
  y += 58;
  text("المستلم", R, y, { size: 30, color: C.muted });
  y += 70;
  text(o.name, R, y, { size: 64, weight: 800 });
  y += 96;
  text(formatIraqiMobile(o.phone).replace(/ /g, ""), R, y, { size: 90, weight: 800, dir: "ltr" });
  y += 34;
  rule(y);
  y += 60;
  text("العنوان", R, y, { size: 32, color: C.muted });
  const addr = wrap(fullAddress(o), W - 2 * M, { size: 48, weight: 700 }).slice(0, 3);
  for (const line of addr) {
    y += 62;
    text(line, R, y, { size: 48, weight: 700 });
  }
  if (o.note) {
    const lines = wrap(`ملاحظة: ${o.note}`, W - 2 * M - 40, { size: 36, weight: 600 }).slice(0, 2);
    y += 22;
    const boxH = lines.length * 48 + 26;
    ctx.fillStyle = "#F1E6D6";
    ctx.fillRect(M, y, W - 2 * M, boxH);
    let ty = y + 46;
    for (const line of lines) {
      text(line, R - 20, ty, { size: 36, weight: 600 });
      ty += 48;
    }
    y += boxH;
  }

  // Bottom block is anchored to the page's bottom so it always prints in the same place.
  const collect = collectAmount(o);
  const delivery = deliveryPayOf(o);
  const jars = o.jars ?? (o.items ?? []).reduce((s, i) => s + (i?.qty ?? 0), 0);
  const footerTop = H - 500;

  // Items, between the address and the footer.
  const flavors = (o.items ?? [])
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .map((i) => `${i.nameAr} × ${i.qty}`)
    .join("  ·  ");
  const itemsY = Math.max(y + 80, footerTop - 175);
  rule(itemsY - 50);
  text(`${jarsWord(jars)} · مبرّد`, R, itemsY + 10, { size: 50, weight: 800, color: C.cocoa });
  const fl = wrap(flavors, W - 2 * M, { size: 38, weight: 500 }).slice(0, 2);
  fl.forEach((line, i) => text(line, R, itemsY + 70 + i * 50, { size: 38, color: C.muted }));

  // The amount the courier collects.
  ctx.fillStyle = collect > 0 ? C.terracotta : "#6B7F5C";
  ctx.fillRect(0, footerTop, W, 260);
  if (collect > 0) {
    text("المطلوب من الزبون", R, footerTop + 80, { size: 40, weight: 700, color: C.cream });
    text(formatIQD(collect), R, footerTop + 215, { size: 140, weight: 800, color: "#fff" });
    const parts = [
      o.paid ? "الطلب مدفوع" : `الطلب ${formatIQD(o.total)}`,
      delivery === "driver" ? `التوصيل ${formatIQD(site.deliveryFee)}` : delivery === "prepaid" ? "التوصيل مدفوع" : "التوصيل مجاني",
    ].join(" + ");
    text(parts, M, footerTop + 80, { size: 34, color: C.cream, align: "left" });
  } else {
    text("مدفوع بالكامل", R, footerTop + 110, { size: 38, weight: 700, color: C.cream });
    text("لا يُطلب أي مبلغ", R, footerTop + 215, { size: 100, weight: 800, color: "#fff" });
  }

  // Footer notes.
  let fy = footerTop + 260 + 62;
  if (o.province === site.baghdadWindow.province) {
    text(`موعد التوصيل في بغداد: ${site.baghdadWindow.short}`, R, fy, { size: 42, weight: 700, color: C.cocoa });
    fy += 58;
  }
  text(site.returnBoxNote, R, fy, { size: 44, weight: 800, color: C.terracotta });
  fy += 58;
  text(`للاستفسار: ${site.whatsappDisplay.replace(/ /g, "")}`, R, fy, { size: 40, color: C.muted });
  text("ÉLUE", M, fy, { size: 44, weight: 800, color: C.cocoa, align: "left", dir: "ltr" });
}

async function labelJpeg(o: LabelOrder, courierName: string): Promise<PdfPage> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  drawLabel(canvas.getContext("2d")!, o, courierName);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("label_failed"))), "image/jpeg", 0.95),
  );
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: W, height: H };
}

// 4×6 in in PDF points.
export async function buildLabelsPdf(orders: LabelOrder[]): Promise<Blob> {
  await loadFonts();
  const pages: PdfPage[] = [];
  for (const o of orders) pages.push(await labelJpeg(o, o.courierName ?? ""));
  return makePdf(pages, 288, 432);
}

// A preview picture of one label (for tests).
export async function buildLabelPng(o: LabelOrder): Promise<Blob> {
  await loadFonts();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  drawLabel(canvas.getContext("2d")!, o, o.courierName ?? "");
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("label_failed"))), "image/png"));
}

export function labelsFilename(orders: LabelOrder[]): string {
  return orders.length === 1 ? `ELUE-label-${orders[0].orderNumber}.pdf` : `ELUE-labels-${orders.length}-${dateText()}.pdf`;
}
