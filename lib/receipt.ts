// Order summary picture (PNG), made in the browser: easy to share on WhatsApp
// and to keep in the phone's photos.
//
// The summary is drawn on a <canvas> (the browser shapes the Arabic text
// correctly) and saved as a PNG.
//
// This is an order summary for the customer's records, not a tax invoice.

import { LOGO_PATH, LOGO_VIEWBOX } from "./brand-mark";
import { deliveryPayOf, formatIQD, site } from "./site";
import { fullAddress } from "./iraq";
import { getProduct } from "./products";
import { modonCollect } from "./modon";

export type ReceiptLine = { nameAr: string; nameEn: string; qty: number; price: number; subtotal: number };

export type ReceiptData = {
  orderId: string;
  time: string;
  lines: ReceiptLine[];
  total: number;
  name: string;
  phoneDisplay: string;
  address: string;
  note?: string;
  paid?: boolean; // customer already paid for the jars
  freeDelivery?: boolean; // ÉLUE covers the delivery fee (gift)
  deliveryPaid?: boolean; // customer already paid the delivery fee
};

const W = 1240;
const M = 96;
const C = {
  cream: "#F5EFE6",
  paper: "#FBF8F3",
  terracotta: "#A45A44",
  cocoa: "#5B3A2E",
  ink: "#3B2A23",
  muted: "#6E584C",
  rule: "#D9C4A8",
};
const AR = '"Cairo Variable", "Cairo", "Segoe UI", Tahoma, sans-serif';

type TextOpts = { size: number; weight?: number; color?: string; align?: CanvasTextAlign; dir?: CanvasDirection };

function draw(ctx: CanvasRenderingContext2D, d: ReceiptData): number {
  const text = (s: string, x: number, y: number, o: TextOpts) => {
    ctx.font = `${o.weight ?? 400} ${o.size}px ${AR}`;
    ctx.fillStyle = o.color ?? C.ink;
    ctx.direction = o.dir ?? "rtl";
    ctx.textAlign = o.align ?? "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(s, x, y);
  };
  const wrap = (s: string, maxWidth: number, o: TextOpts): string[] => {
    ctx.font = `${o.weight ?? 400} ${o.size}px ${AR}`;
    ctx.direction = o.dir ?? "rtl";
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
  const rule = (y: number) => {
    ctx.fillStyle = C.rule;
    ctx.fillRect(M, y, W - 2 * M, 2);
  };
  const R = W - M;

  // Header band with the wordmark.
  const bandH = 250;
  ctx.fillStyle = C.terracotta;
  ctx.fillRect(0, 0, W, bandH);
  const logoW = 330;
  const scale = logoW / LOGO_VIEWBOX.width;
  ctx.save();
  ctx.translate((W - logoW) / 2 - LOGO_VIEWBOX.x * scale, 56 - LOGO_VIEWBOX.y * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = C.cream;
  ctx.fill(new Path2D(LOGO_PATH), "evenodd");
  ctx.restore();
  ctx.save();
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "8px";
  } catch {}
  text("CHOCOLATE TRUFFLES", W / 2, 222, { size: 20, color: C.cream, align: "center", dir: "ltr" });
  ctx.restore();

  // Title, order number, time.
  let y = bandH + 104;
  text("ملخص طلبك", R, y, { size: 54, weight: 700, color: C.cocoa });
  text(d.orderId, M, y, { size: 42, weight: 700, color: C.terracotta, align: "left", dir: "ltr" });
  y += 54;
  text("شكراً لاختيارك ÉLUE", R, y, { size: 27, color: C.muted });
  text(d.time, M, y, { size: 27, color: C.muted, align: "left", dir: "ltr" });
  y += 46;
  rule(y);

  // Items.
  y += 70;
  for (const l of d.lines) {
    text(l.nameAr, R, y, { size: 34, weight: 600 });
    text(formatIQD(l.subtotal), M, y, { size: 34, weight: 600, align: "left" });
    y += 44;
    text(`${l.nameEn}  ·  الكمية: ${l.qty}  ·  سعر العلبة: ${formatIQD(l.price)}`, R, y, { size: 24, color: C.muted });
    y += 62;
  }
  y -= 20;
  rule(y);

  // Total, and what the driver collects.
  const paid = Boolean(d.paid);
  const delivery = deliveryPayOf(d);
  const collect = modonCollect(d.total, paid, delivery);
  y += 76;
  const jars = d.lines.reduce((n, l) => n + l.qty, 0);
  const jarsText = jars === 1 ? "علبة واحدة" : jars === 2 ? "علبتان" : jars <= 10 ? `${jars} علب` : `${jars} علبة`;
  text(`المجموع · ${jarsText}`, R, y, { size: 38, weight: 700, color: C.cocoa });
  text(formatIQD(d.total), M, y, { size: 44, weight: 700, color: C.terracotta, align: "left" });
  y += 52;
  text("ثمن العلب", R, y, { size: 27, color: C.muted });
  text(paid ? "مدفوع مسبقاً" : "عند الاستلام", M, y, { size: 27, weight: 600, align: "left" });
  y += 44;
  text("أجور التوصيل", R, y, { size: 27, color: C.muted });
  text(delivery === "gift" ? "مجاني" : delivery === "prepaid" ? "مدفوعة مسبقاً" : formatIQD(site.deliveryFee), M, y, {
    size: 27,
    weight: 600,
    align: "left",
  });
  y += 56;
  text("المبلغ المستحق عند الاستلام", R, y, { size: 31, weight: 700, color: C.cocoa });
  text(collect > 0 ? formatIQD(collect) : "لا شيء", M, y, { size: 36, weight: 700, color: C.terracotta, align: "left" });
  y += 42;
  text(collect > 0 ? site.paymentNote : "لا يُطلب منك أي مبلغ عند الاستلام", R, y, { size: 26, color: C.muted });
  y += 44;
  rule(y);

  // Delivery details.
  y += 72;
  text("معلومات التوصيل", R, y, { size: 32, weight: 700, color: C.cocoa });
  y += 22;
  const field = (label: string, value: string, dir: CanvasDirection = "rtl") => {
    y += 46;
    text(label, R, y, { size: 24, color: C.muted });
    const lines = wrap(value, W - 2 * M, { size: 31, dir });
    for (const line of lines) {
      y += 44;
      text(line, R, y, { size: 31, dir });
    }
    y += 10;
  };
  field("الاسم الكامل", d.name);
  field("رقم الواتساب", d.phoneDisplay, "ltr");
  field("العنوان", d.address);
  if (d.note) field("ملاحظة", d.note);
  y += 36;
  rule(y);

  // Footer.
  y += 66;
  text("لمتابعة طلبك، راسلنا عبر واتساب", W / 2, y, { size: 27, color: C.ink, align: "center" });
  y += 44;
  text(`${site.whatsappDisplay}   ·   ${site.instagramHandle}`, W / 2, y, {
    size: 27,
    weight: 600,
    color: C.terracotta,
    align: "center",
    dir: "ltr",
  });
  return y + 84;
}

export async function loadFonts() {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`700 40px ${AR}`, "ملخص طلبك EL-0"),
      document.fonts.load(`400 30px ${AR}`, "العنوان 0771"),
      document.fonts.load(`600 30px ${AR}`, "دارك 15,000"),
    ]);
  } catch {
    // Fall back to the system font; the summary is still readable.
  }
}

export async function buildReceiptImage(data: ReceiptData): Promise<Blob> {
  await loadFonts();

  // First pass measures the height, second pass draws.
  const probe = document.createElement("canvas");
  probe.width = W;
  probe.height = 4000;
  const height = Math.ceil(draw(probe.getContext("2d")!, data));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = C.cream;
  ctx.fillRect(0, 0, W, height);
  draw(ctx, data);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("image_failed"))), "image/png"),
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function receiptFilename(orderId: string) {
  return `ELUE-${orderId}.png`;
}

// iPhone / iPad (iPadOS reports itself as a Mac with touch).
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Phones: the share sheet («حفظ الصورة» to Photos, WhatsApp…). Elsewhere: a download.
// Must be called from a tap. Resolves false when the person closed the share sheet.
export async function saveImage(blob: Blob, filename: string): Promise<boolean> {
  const file = new File([blob], filename, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return false;
      // Share not allowed here (e.g. no recent tap): fall back to a download.
    }
  }
  downloadBlob(blob, filename);
  return true;
}

// Builds the summary data from a saved order (checkout success, "طلباتي", admin).
export function receiptFromOrder(o: {
  orderNumber: string;
  createdAt: string;
  items: ({ slug?: string; nameAr: string; nameEn: string; qty: number; price: number } | null)[];
  total: number;
  name: string;
  phone: string; // 9647XXXXXXXXX
  province?: string | null;
  area?: string | null;
  address: string;
  note?: string | null;
  paid?: boolean | null;
  freeDelivery?: boolean | null;
  deliveryPaid?: boolean | null;
}): ReceiptData {
  const time = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Baghdad", dateStyle: "short", timeStyle: "short" }).format(
    new Date(o.createdAt),
  );
  const local = `0${o.phone.slice(3)}`;
  return {
    orderId: o.orderNumber,
    time,
    lines: o.items
      .filter((i): i is NonNullable<typeof i> => Boolean(i))
      .map((i) => ({
        nameAr: getProduct(i.slug ?? "")?.nameAr ?? i.nameAr,
        nameEn: i.nameEn,
        qty: i.qty,
        price: i.price,
        subtotal: i.qty * i.price,
      })),
    total: o.total,
    name: o.name,
    phoneDisplay: `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`,
    address: fullAddress(o),
    note: o.note || undefined,
    paid: Boolean(o.paid),
    freeDelivery: Boolean(o.freeDelivery),
    deliveryPaid: Boolean(o.deliveryPaid),
  };
}

export function orderImage(o: Parameters<typeof receiptFromOrder>[0]): Promise<Blob> {
  return buildReceiptImage(receiptFromOrder(o));
}

// share = true: share sheet on phones (from a tap); false: a plain download.
export async function saveOrderImage(o: Parameters<typeof receiptFromOrder>[0], share = true): Promise<boolean> {
  const blob = await orderImage(o);
  if (!share) {
    downloadBlob(blob, receiptFilename(o.orderNumber));
    return true;
  }
  return saveImage(blob, receiptFilename(o.orderNumber));
}
