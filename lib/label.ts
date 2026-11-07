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
import { slotLines } from "./delivery-slot";
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
  // Three sizes only (like the Modon label): captions, values, and the two key numbers.
  const CAP = 30;
  const VAL = 44;
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
      let ln = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = ln ? `${ln} ${word}` : word;
        if (ln && ctx.measureText(test).width > maxWidth) {
          out.push(ln);
          ln = word;
        } else ln = test;
      }
      if (ln) out.push(ln);
    }
    return out;
  };
  const rect = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = BLACK;
    ctx.fillRect(x, y, w, h);
  };

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // ---- Header: the wordmark on the right, the kind of delivery on the left.
  const logoW = 270;
  const scale = logoW / LOGO_VIEWBOX.width;
  ctx.save();
  ctx.translate(R - logoW - LOGO_VIEWBOX.x * scale, 70 - LOGO_VIEWBOX.y * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = BLACK;
  ctx.fill(new Path2D(LOGO_PATH), "evenodd");
  ctx.restore();
  text("توصيل محلي", M, 92, { size: CAP, align: "left" });
  text(courierName, M, 150, { size: 52, weight: BOLD, align: "left" });
  rect(M, 214, W - 2 * M, 3);

  // ---- The two columns, split by a thin vertical line.
  const top = 217;
  const split = 450;
  const bottom = 1310;
  rect(split, top, 2, bottom - top);

  // Left column: QR, order number, delivery company, notes.
  const lx = M; // left edge
  const lr = split - 44; // right edge
  const lw = lr - lx;
  const cx = lx + lw / 2;
  const qr = qrcode(0, "M");
  qr.addData(o.orderNumber);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.floor(lw / (n + 2));
  const qrPx = cell * (n + 2);
  const qx = Math.round(cx - qrPx / 2);
  const qy = 290;
  ctx.fillStyle = BLACK;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(qx + (c + 1) * cell, qy + (r + 1) * cell, cell, cell);
  // Corner brackets around the code, like the Modon label.
  const gap = 16;
  const arm = 52;
  const th = 5;
  const x0 = qx - gap;
  const x1 = qx + qrPx + gap;
  const y0 = qy - gap;
  const y1 = qy + qrPx + gap;
  for (const [x, y, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    rect(dx === 1 ? x : x - arm, dy === 1 ? y : y - th, arm, th);
    rect(dx === 1 ? x : x - th, dy === 1 ? y : y - arm, th, arm);
  }

  let ly = y1 + 80;
  text("رقم الطلب", lr, ly, { size: CAP });
  text(o.orderNumber, lr, ly + 62, { size: VAL + 6, weight: BOLD, dir: "ltr" });
  text(dateText(o.createdAt), lr, ly + 62 + 50, { size: CAP, dir: "ltr" });
  ly += 62 + 50 + 70;

  // Baghdad: the delivery day and period the customer picked, in bold.
  const slot = slotLines(o);
  if (slot.length) {
    text("موعد التوصيل :", lr, ly, { size: CAP });
    for (const l of slot) {
      for (const part of wrap(l, lw, { size: 36, weight: BOLD })) {
        ly += 46;
        text(part, lr, ly, { size: 36, weight: BOLD });
      }
    }
    ly += 64;
  }

  // Notes, numbered like the Modon label.
  text("ملاحظات الشركة :", lr, ly, { size: CAP });
  const notes = [`للاستفسار ${site.whatsappDisplay.replace(/ /g, "")}`];
  notes.forEach((note, i) => {
    ly += 26;
    for (const l of wrap(`0${i + 1}  ${note}`, lw, { size: CAP })) {
      ly += 40;
      text(l, lr, ly, { size: CAP });
    }
  });

  // Right column: a small caption over a bold value, one field after another.
  const rr = R;
  const rw = R - split - 48;
  let y = 290;
  // Longer values step down in size so nothing is ever cut off.
  const field = (caption: string, value: string, opts: { dir?: CanvasDirection; sizes?: number[]; weight?: number } = {}) => {
    text(caption, rr, y, { size: CAP });
    const sizes = opts.sizes ?? [VAL, 40, 36, 32];
    let size = sizes[0];
    let lines = wrap(value, rw, { size, weight: opts.weight ?? BOLD, dir: opts.dir });
    for (const sz of sizes) {
      size = sz;
      lines = wrap(value, rw, { size, weight: opts.weight ?? BOLD, dir: opts.dir });
      if (lines.length <= (sz === sizes[sizes.length - 1] ? 99 : 3)) break;
    }
    lines.forEach((l, i) => text(l, rr, y + 62 + i * (size + 14), { size, weight: opts.weight ?? BOLD, dir: opts.dir }));
    y += 62 + (lines.length - 1) * (size + 14) + 62;
  };
  field("اسم التاجر", "ÉLUE", { dir: "ltr", weight: REGULAR });
  rect(split + 48, y - 32, R - split - 48, 3);
  y += 38;
  field("اسم الزبون", o.name);
  field("هاتف الزبون", formatIraqiMobile(o.phone).replace(/ /g, ""), { dir: "ltr" });
  field("المحافظة والمنطقة", [o.province, o.area].filter(Boolean).join("، ") || "—");
  field("العنوان", o.address, { sizes: [VAL, 40, 36] });
  if (o.note) field("ملاحظة الزبون", o.note, { sizes: [38, 34, 30], weight: 500 });

  // ---- Bottom: the goods, and the amount the courier collects.
  rect(M, bottom, W - 2 * M, 3);
  const jars = o.jars ?? (o.items ?? []).reduce((s, i) => s + (i?.qty ?? 0), 0);
  text("نوع البضاعة", R, bottom + 62, { size: CAP });
  text("ترافل شوكولاتة ÉLUE", R, bottom + 62 + 58, { size: VAL, weight: BOLD });
  text("عدد العلب", M + 260, bottom + 62, { size: CAP });
  text(String(jars), M + 260, bottom + 62 + 58, { size: VAL, weight: BOLD, dir: "ltr" });

  const collect = collectAmount(o);
  const delivery = deliveryPayOf(o);
  const boxY = bottom + 168;
  const boxH = H - boxY - 52;
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(M, boxY, W - 2 * M, boxH, 28);
  ctx.stroke();
  if (collect > 0) {
    text("المطلوب من الزبون", R - 36, boxY + 70, { size: CAP });
    text(formatIQD(collect), R - 36, boxY + boxH - 50, { size: 84, weight: BOLD });
    const parts = [
      o.paid ? "الطلب مدفوع" : `الطلب ${formatIQD(o.total)}`,
      delivery === "driver" ? `التوصيل ${formatIQD(site.deliveryFee)}` : delivery === "prepaid" ? "التوصيل مدفوع" : "التوصيل مجاني",
    ].join(" + ");
    text(parts, M + 36, boxY + 70, { size: CAP, align: "left" });
  } else {
    text("المطلوب من الزبون", R - 36, boxY + 70, { size: CAP });
    text("لا شيء، مدفوع بالكامل", R - 36, boxY + boxH - 50, { size: 64, weight: BOLD });
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
