// A minimal PDF writer: one JPEG picture per page, page size in points.
// Enough for shipping labels (4×6 in = 288×432 pt) that print the same everywhere.

// A page picture: a JPEG, or a 1-bit black/white bitmap (0 = black, rows padded to bytes),
// zlib-compressed when `flate` is true. Width and height are in pixels.
export type PdfPage =
  | { kind: "jpeg"; data: Uint8Array; width: number; height: number }
  | { kind: "bits"; data: Uint8Array; flate: boolean; width: number; height: number };

const enc = (s: string) => new TextEncoder().encode(s);

export function makePdf(pages: PdfPage[], pageW: number, pageH: number): Blob {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === "string" ? enc(b) : b;
    chunks.push(bytes);
    pos += bytes.length;
  };
  const begin = (id: number) => {
    offsets[id] = pos;
    push(`${id} 0 obj\n`);
  };

  // Object ids: 1 catalog, 2 page tree, then per page: page, content, image.
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  begin(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  begin(2);
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((p, i) => {
    const pageId = 3 + i * 3;
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    begin(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`,
    );
    const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
    begin(contentId);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    begin(imageId);
    const image =
      p.kind === "jpeg"
        ? "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode"
        : `/ColorSpace /DeviceGray /BitsPerComponent 1${p.flate ? " /Filter /FlateDecode" : ""}`;
    push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} ${image} /Length ${p.data.length} >>\nstream\n`);
    push(p.data);
    push("\nendstream\nendobj\n");
  });

  const count = 3 + pages.length * 3;
  const xref = pos;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  // Copy into one buffer (a plain ArrayBuffer, which Blob accepts everywhere).
  const out = new Uint8Array(pos);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return new Blob([out], { type: "application/pdf" });
}
