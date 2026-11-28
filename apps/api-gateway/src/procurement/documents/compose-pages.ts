import { PDFDocument } from "pdf-lib";

/**
 * ONE PAPER, MANY PAGES (r108 g13).
 *
 * A two-page invoice photographed twice used to become two papers: page 1 held
 * the header and the total, page 2 held lines and no total, and neither tied
 * out. The pages are now composed into ONE PDF here, in the gateway, and the
 * extractor reads that PDF unchanged.
 *
 * The same pages in the same order give the same bytes, so the same sha256 and
 * the restaurant's uq_pd_restaurant_sha256 dedup still holds. That is why the
 * dates, producer and creator are fixed and object streams are off: nothing in
 * the file may depend on the clock or on the library's own version stamp.
 */

export const MIN_PAGES = 2;
export const MAX_PAGES = 10;
/** A page is drawn no larger than this on its long side, in points. */
const MAX_SIDE_PT = 1600;
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

export class ComposePagesError extends Error {}

/** "15mb" / "512kb" / "1000000" as bytes, the way body-parser reads main.ts's limit. */
export function bodyLimitBytes(
  raw: string | undefined = process.env.MAX_REQUEST_BODY_SIZE,
): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(raw || "15mb");
  if (!m) return 15 * 1024 * 1024;
  const unit = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }[
    (m[2] || "b").toLowerCase() as "b" | "kb" | "mb" | "gb"
  ];
  return Math.floor(Number(m[1]) * unit);
}

type Kind = "jpeg" | "png" | "webp" | "other";

function kindOf(b: Buffer): Kind {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "jpeg";
  if (
    b.length > 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "png";
  if (
    b.length > 12 &&
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp";
  return "other";
}

/**
 * Compose the pages, in the order sent, into one PDF.
 * Every refusal is a sentence a person can act on, never a bare code.
 */
export async function composePages(
  pages: Buffer[],
  limitBytes: number = bodyLimitBytes(),
): Promise<Buffer> {
  if (pages.length < MIN_PAGES)
    throw new ComposePagesError(
      `A paper made of pages needs at least ${MIN_PAGES} pages. For one page, send it as a single photo.`,
    );
  if (pages.length > MAX_PAGES)
    throw new ComposePagesError(
      `A paper can have at most ${MAX_PAGES} pages, and ${pages.length} were sent. Send the first ${MAX_PAGES} as one paper, and the rest as another.`,
    );
  const kinds = pages.map(kindOf);
  kinds.forEach((k, i) => {
    if (k === "webp")
      throw new ComposePagesError(
        `Page ${i + 1} is a WebP image, which cannot be put on a paper. Send it as a JPEG or PNG.`,
      );
    if (k === "other")
      throw new ComposePagesError(
        `Page ${i + 1} is not a JPEG or PNG image. Send each page as a JPEG or PNG photo.`,
      );
  });
  const total = pages.reduce((n, p) => n + p.length, 0);
  if (total > limitBytes)
    throw new ComposePagesError(
      `The ${pages.length} pages together are ${Math.ceil(total / 1024 / 1024)} MB, more than the ${Math.floor(limitBytes / 1024 / 1024)} MB one upload can carry. Send fewer pages, or smaller photos.`,
    );

  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setProducer("Mudavym");
  pdf.setCreator("Mudavym");
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  for (let i = 0; i < pages.length; i++) {
    let img;
    try {
      // A plain copy: pdf-lib's JPEG reader opens a DataView over `.buffer`,
      // and a small Node Buffer is a slice of a shared 8 KB pool, so handing it
      // the Buffer itself reads the pool's first bytes and not the image.
      const bytes = new Uint8Array(pages[i]);
      img =
        kinds[i] === "jpeg"
          ? await pdf.embedJpg(bytes)
          : await pdf.embedPng(bytes);
    } catch {
      throw new ComposePagesError(
        `Page ${i + 1} could not be read as an image. Take the photo again and send it as a JPEG or PNG.`,
      );
    }
    const scale = Math.min(1, MAX_SIDE_PT / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const page = pdf.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  const out = Buffer.from(await pdf.save({ useObjectStreams: false }));
  if (out.length > limitBytes)
    throw new ComposePagesError(
      `The pages make a ${Math.ceil(out.length / 1024 / 1024)} MB paper, more than the ${Math.floor(limitBytes / 1024 / 1024)} MB one upload can carry. Send fewer pages, or smaller photos.`,
    );
  return out;
}
