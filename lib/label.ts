// Shipping label for orders our own couriers deliver: 100×150 mm (4×6 in, the same
// as the Modon Express label), for thermal printers, so it is pure black on white.
//
// Laid out like the Modon label (two columns split by a thin line, small plain
// captions over bold values, lots of white space) in ÉLUE's own font, Cairo.
// Drawn on a canvas (correct Arabic) at 600 dpi and saved as a 1-bit PDF page, so
// every edge is sharp. One order gives a one-page PDF, several give one PDF with a
// page per order, ready to print at once.

import qrcode from "qrcode-generator";
import { LOGO_PATH, LOGO_VIEWBOX } from "./brand-mark";
import { collectAmount, type DispatchOrder } from "./dispatch";
import { formatIraqiMobile } from "./phone";
import { makePdf, type PdfPage } from "./pdf";
import { loadFonts } from "./receipt";
import { deliveryPayOf, formatIQD, site } from "./site";

export type LabelOrder = DispatchOrder & { createdAt?: string | null };

// Drawn in a 1200×1800 space, rendered at 2× (2400×3600 px = 600 dpi).
const W = 1200;
const H = 1800;
const SCALE = 2;
const M = 70;
const AR = '"Cairo Variable", "Cairo", "Segoe UI", Tahoma, sans-serif';
const BLACK = "#000";
const REGULAR = 400;
const BOLD = 700;

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
    ctx.font = `${t.weight ?? REGULAR} ${t.size}px ${AR}`;
    ctx.fillStyle = BLACK;
    ctx.direction = t.dir ?? "rtl";
    ctx.textAlign = t.align ?? "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y);
  };
  const wrap = (s: string, maxWidth: number, t: TextOpts): string[] => {
    ctx.font = `${t.weight ?? REGULAR} ${t.size}px ${AR}`;
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
  const line = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = BLACK;
    ctx.fillRect(x, y, w, h);
  };

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Header: the wordmark on the right, who delivers on the left.
  const logoW = 250;
  const scale = logoW / LOGO_VIEWBOX.width;
  ctx.save();
  ctx.translate(R - logoW - LOGO_VIEWBOX.x * scale, 62 - LOGO_VIEWBOX.y * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = BLACK;
  ctx.fill(new Path2D(LOGO_PATH), "evenodd");
  ctx.restore();
  text("توصيل محلي", M, 92, { size: 30, align: "left" });
  text(courierName, M, 142, { size: 42, weight: BOLD, align: "left" });
  line(M, 186, W - 2 * M, 3);

  // The two columns, split by a thin vertical line.
  const top = 189;
  const split = 436;
  const bottom = 1330;
  line(split, top, 2, bottom - top);

  // ---- Left column: QR, order number, notes.
  const cx = (M + split - 40) / 2 + 20; // centre of the left column
  const colW = split - M - 40;
  const qr = qrcode(0, "M");
  qr.addData(o.orderNumber);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.floor(300 / (n + 2));
  const qrPx = cell * (n + 2);
  const qx = Math.round(cx - qrPx / 2);
  const qy = 250;
  ctx.fillStyle = BLACK;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(qx + (c + 1) * cell, qy + (r + 1) * cell, cell, cell);
  // Corner brackets around the code, like the Modon label.
  const b = 14;
  const L = 46;
  const T = 5;
  for (const [bx, by, dx, dy] of [
    [qx - b, qy - b, 1, 1],
    [qx + qrPx + b, qy - b, -1, 1],
    [qx - b, qy + qrPx + b, 1, -1],
    [qx + qrPx + b, qy + qrPx + b, -1, -1],
  ] as const) {
    line(dx === 1 ? bx : bx - L, dy === 1 ? by : by - T, L, T);
    line(dx === 1 ? bx : bx - T, dy === 1 ? by : by - L, T, L);
  }
  let ly = qy + qrPx + 84;
  text("رقم الطلب", cx, ly, { size: 28, align: "center" });
  ly += 62;
  text(o.orderNumber, cx, ly, { size: 58, weight: BOLD, align: "center", dir: "ltr" });
  ly += 50;
  text(dateText(o.createdAt), cx, ly, { size: 30, align: "center", dir: "ltr" });
  ly += 96;
  text("ملاحظات الشركة", cx + colW / 2, ly, { size: 28, align: "right" });
  const leftNotes: [string, number, number][] = [[site.returnBoxNote, 32, BOLD]];
  if (o.province === site.baghdadWindow.province) leftNotes.push([`موعد التوصيل في بغداد ${site.baghdadWindow.short}`, 28, REGULAR]);
  leftNotes.push([`للاستفسار ${site.whatsappDisplay.replace(/ /g, "")}`, 28, REGULAR]);
  for (const [s, size, weight] of leftNotes) {
    ly += 24;
    for (const l of wrap(s, colW, { size, weight })) {
      ly += size + 14;
      text(l, cx + colW / 2, ly, { size, weight, align: "right" });
    }
  }

  // ---- Right column: a small caption over a bold value, one field after another.
  let y = 252;
  const field = (caption: string, value: string, size: number, opts: { dir?: CanvasDirection; maxLines?: number } = {}) => {
    text(caption, R, y, { size: 30 });
    const lines = wrap(value, R - split - 50, { size, weight: BOLD, dir: opts.dir }).slice(0, opts.maxLines ?? 1);
    for (const l of lines) {
      y += size + 18;
      text(l, R, y, { size, weight: BOLD, dir: opts.dir });
    }
    y += 62;
  };
  field("اسم الزبون", o.name, 48, { maxLines: 2 });
  field("هاتف الزبون", formatIraqiMobile(o.phone).replace(/ /g, ""), 58, { dir: "ltr" });
  field("المحافظة والمنطقة", [o.province, o.area].filter(Boolean).join("، ") || "—", 46, { maxLines: 2 });
  field("العنوان", o.address, 44, { maxLines: 4 });
  if (o.note) field("ملاحظة الزبون", o.note, 34, { maxLines: 3 });

  // ---- Bottom: the goods and the amount the courier collects.
  line(M, bottom, W - 2 * M, 3);
  const jars = o.jars ?? (o.items ?? []).reduce((s, i) => s + (i?.qty ?? 0), 0);
  const flavors = (o.items ?? [])
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .map((i) => `${i.nameAr} × ${i.qty}`)
    .join("  ·  ");
  text("نوع البضاعة", R, bottom + 54, { size: 28 });
  text(`ترافل شوكولاتة · ${jarsWord(jars)} · مبرّد`, R, bottom + 104, { size: 38, weight: BOLD });
  const fl = wrap(flavors, W - 2 * M, { size: 30 }).slice(0, 1);
  fl.forEach((l) => text(l, R, bottom + 150, { size: 30 }));

  const collect = collectAmount(o);
  const delivery = deliveryPayOf(o);
  const boxY = bottom + 184;
  const boxH = H - boxY - 46;
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 6;
  ctx.strokeRect(M, boxY, W - 2 * M, boxH);
  if (collect > 0) {
    text("المطلوب من الزبون", R - 30, boxY + 58, { size: 32, weight: BOLD });
    text(formatIQD(collect), R - 30, boxY + boxH - 34, { size: 90, weight: BOLD });
    const parts = [
      o.paid ? "الطلب مدفوع" : `الطلب ${formatIQD(o.total)}`,
      delivery === "driver" ? `التوصيل ${formatIQD(site.deliveryFee)}` : delivery === "prepaid" ? "التوصيل مدفوع" : "التوصيل مجاني",
    ].join(" + ");
    text(parts, M + 30, boxY + 58, { size: 28, align: "left" });
  } else {
    text("مدفوع بالكامل", R - 30, boxY + 58, { size: 32, weight: BOLD });
    text("لا يُطلب أي مبلغ", R - 30, boxY + boxH - 34, { size: 76, weight: BOLD });
  }
}

// Thermal printers have no greys: every pixel becomes black or white. At 600 dpi
// that still looks smooth, and the edges are sharp. Returns 1 bit per pixel
// (0 = black), rows padded to whole bytes.
function toBits(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8Array {
  const d = ctx.getImageData(0, 0, w, h).data;
  const rowBytes = Math.ceil(w / 8);
  const out = new Uint8Array(rowBytes * h).fill(0xff);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 150) out[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  return out;
}

// zlib-compress (PDF "FlateDecode"); without the browser feature the bits go in as they are.
async function deflate(data: Uint8Array): Promise<{ data: Uint8Array; flate: boolean }> {
  if (typeof CompressionStream === "undefined") return { data, flate: false };
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
    return { data: new Uint8Array(await new Response(stream).arrayBuffer()), flate: true };
  } catch {
    return { data, flate: false };
  }
}

function render(o: LabelOrder, courierName: string) {
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.scale(SCALE, SCALE);
  drawLabel(ctx, o, courierName);
  return { canvas, ctx };
}

async function labelPage(o: LabelOrder): Promise<PdfPage> {
  const { ctx } = render(o, o.courierName ?? "");
  const bits = toBits(ctx, W * SCALE, H * SCALE);
  const { data, flate } = await deflate(bits);
  return { kind: "bits", data, flate, width: W * SCALE, height: H * SCALE };
}

// 100×150 mm in PDF points (the same page size as the Modon label).
export async function buildLabelsPdf(orders: LabelOrder[]): Promise<Blob> {
  await loadFonts();
  const pages: PdfPage[] = [];
  for (const o of orders) pages.push(await labelPage(o));
  return makePdf(pages, 283.465, 425.197);
}

// A preview picture of one label (for tests).
export async function buildLabelPng(o: LabelOrder): Promise<Blob> {
  await loadFonts();
  const { canvas } = render(o, o.courierName ?? "");
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("label_failed"))), "image/png"));
}

export function labelsFilename(orders: LabelOrder[]): string {
  return orders.length === 1 ? `ELUE-label-${orders[0].orderNumber}.pdf` : `ELUE-labels-${orders.length}-${dateText()}.pdf`;
}
