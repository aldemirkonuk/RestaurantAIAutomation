import { UnprocessableEntityException } from "@nestjs/common";

/**
 * Several photos of one menu, sent together, are one menu (founder,
 * 2026-11-07: "One upload = one version"). They are joined here into one PDF,
 * one photo per page and in the order sent, so the read, the kept source file
 * and the page numbers in a read's warnings all speak of the same pages:
 * "Page 3 could not be read" is the third photo.
 *
 * Only JPEG and PNG can be joined (what pdf-lib embeds). The web sends every
 * page as a JPEG it has already shrunk on the device; anything else is refused
 * in words, naming the page, before any read is paid for.
 */

/** The most photos one upload may carry. Above it the person is told to split. */
export const MAX_MENU_PAGES = 20;

/** Strips a `data:...;base64,` prefix a browser may leave on a file it read. */
export function bareBase64(input: string): string {
  return input.trim().replace(/^data:[^,]*,/, "");
}

function kindOf(bytes: Buffer): "jpeg" | "png" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes.subarray(1, 4).toString("latin1") === "PNG") return "png";
  return null;
}

/**
 * The pages of one upload as the base64 of one PDF. One page is returned as
 * the gateway got it (no PDF made). The web redraws every photo before it
 * sends it (apps/web/src/lib/menuPhotos.ts), so a single photo is not the
 * phone's original bytes either way.
 *
 * The joined PDF is byte-stable: the same pages in the same order give the
 * same bytes, so the same photos sent again hash the same and reopen the read
 * they made (MenusService.sameFileRead) instead of being read and billed
 * twice. pdf-lib stamps the current time as CreationDate and ModDate unless
 * told not to (`updateMetadata: false`); with the stamp, two joins of the
 * same photos a second apart differed (batch review of #1062, 2026-11-11).
 */
export async function pagesToOneFile(pages: unknown): Promise<string> {
  if (!Array.isArray(pages) || pages.length === 0 || pages.some((p) => typeof p !== "string" || p.trim() === "")) {
    throw new UnprocessableEntityException(
      "The upload named its pages but sent none that could be read. Nothing was kept.",
    );
  }
  if (pages.length > MAX_MENU_PAGES) {
    throw new UnprocessableEntityException(
      `One upload holds at most ${MAX_MENU_PAGES} pages; this one has ${pages.length}. Send the rest as a second upload. Nothing was kept.`,
    );
  }
  const bare = (pages as string[]).map(bareBase64);
  if (bare.length === 1) return bare[0];

  const { PDFDocument } = await import("pdf-lib");
  // No time stamp, no producer: nothing in the file but the pages.
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (let i = 0; i < bare.length; i++) {
    const bytes = Buffer.from(bare[i], "base64");
    const kind = kindOf(bytes);
    if (!kind) {
      throw new UnprocessableEntityException(
        `Page ${i + 1} is not a JPEG or PNG photo, so the pages could not be joined into one menu. Send that page as a JPEG or on its own. Nothing was kept.`,
      );
    }
    const image = kind === "jpeg" ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  return Buffer.from(await doc.save()).toString("base64");
}
