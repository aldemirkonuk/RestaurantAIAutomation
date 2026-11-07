import { UnsupportedMediaTypeException } from "@nestjs/common";

/**
 * One reading of an uploaded menu file, shared by the scan parser and the
 * kept source (menus.service.ts `importMenu`, `previewArrivalMenu`), so the
 * model and the kept file are given the same bytes.
 *
 * A browser's FileReader.readAsDataURL hands back `data:<type>;base64,<payload>`.
 * Node's base64 decoder does not refuse the prefix: it decodes the letters of
 * `data:image/png;base64,` as payload, so the bytes come out shifted and the
 * type sniff no longer matches anything (gap M6).
 */
const DATA_URL_PREFIX = /^data:[^,]*;base64,/i;

/** The upload with a leading base64 data-URL prefix removed; any other string is returned unchanged. */
export function stripDataUrlPrefix(input: string): string {
  return input.replace(DATA_URL_PREFIX, "");
}

/** The bare base64 of an upload and the bytes it decodes to. */
export function decodeUploadBase64(input: string): {
  base64: string;
  bytes: Buffer;
} {
  const base64 = stripDataUrlPrefix(input);
  return { base64, bytes: Buffer.from(base64, "base64") };
}

export type ReadableMenuMedia =
  | "application/pdf"
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export type SniffedMedia =
  | { readable: true; mime: ReadableMenuMedia; ext: string }
  | { readable: false; mime: string; ext: string; label: string };

const latin1 = (b: Uint8Array, from: number, to: number) =>
  Buffer.from(b.subarray(from, to)).toString("latin1");

/** ISO-BMFF brands (the `ftyp` box) that mark a HEIF-family still image. */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const HEIF_BRANDS = new Set(["mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

function sniffFtyp(b: Uint8Array): SniffedMedia | null {
  if (b.length < 12 || latin1(b, 4, 8) !== "ftyp") return null;
  const size = Buffer.from(b.subarray(0, 4)).readUInt32BE(0);
  const brands = [latin1(b, 8, 12)];
  for (let i = 16; i + 4 <= Math.min(size, b.length); i += 4)
    brands.push(latin1(b, i, i + 4));
  if (brands.some((x) => AVIF_BRANDS.has(x)))
    return { readable: false, mime: "image/avif", ext: "avif", label: "AVIF" };
  if (brands.some((x) => HEIC_BRANDS.has(x)))
    return { readable: false, mime: "image/heic", ext: "heic", label: "HEIC" };
  if (brands.some((x) => HEIF_BRANDS.has(x)))
    return { readable: false, mime: "image/heif", ext: "heif", label: "HEIF" };
  return null;
}

/** BITMAPINFOHEADER family sizes: core (12), OS/2 v2 (16, 64), v1-v5 (40-124). */
const BMP_DIB_HEADER_SIZES = new Set([12, 16, 40, 52, 56, 64, 108, 124]);

/**
 * "BM", four zero reserved bytes at 6-9, and a known DIB header size at 14-17,
 * so a file that merely starts with the letters "BM" is not taken for a bitmap.
 */
function isBmpHeader(b: Uint8Array): boolean {
  if (b.length < 18 || latin1(b, 0, 2) !== "BM") return false;
  if (b[6] || b[7] || b[8] || b[9]) return false;
  const dib = b[14] | (b[15] << 8) | (b[16] << 16) | (b[17] << 24);
  return BMP_DIB_HEADER_SIZES.has(dib);
}

/**
 * The file's kind from its leading bytes, never from a name or a declared type.
 * `null` when the bytes match none of the kinds below.
 */
export function sniffUploadMedia(b: Uint8Array): SniffedMedia | null {
  if (latin1(b, 0, 4) === "%PDF")
    return { readable: true, mime: "application/pdf", ext: "pdf" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { readable: true, mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && latin1(b, 1, 4) === "PNG")
    return { readable: true, mime: "image/png", ext: "png" };
  if (latin1(b, 0, 4) === "RIFF" && latin1(b, 8, 12) === "WEBP")
    return { readable: true, mime: "image/webp", ext: "webp" };
  if (latin1(b, 0, 6) === "GIF87a" || latin1(b, 0, 6) === "GIF89a")
    return { readable: true, mime: "image/gif", ext: "gif" };
  const ftyp = sniffFtyp(b);
  if (ftyp) return ftyp;
  if (latin1(b, 0, 4) === "II*\0" || latin1(b, 0, 4) === "MM\0*")
    return { readable: false, mime: "image/tiff", ext: "tif", label: "TIFF" };
  if (isBmpHeader(b))
    return { readable: false, mime: "image/bmp", ext: "bmp", label: "BMP" };
  return null;
}

/**
 * The media type the menu reader is sent for these leading bytes. A kind it
 * cannot open (HEIC, HEIF, AVIF, TIFF, BMP) is refused with a 415 in words;
 * the scan parser asks this before its model call. `null` means the bytes
 * matched no known kind.
 */
export function readableMenuMediaOrRefuse(
  b: Uint8Array,
): ReadableMenuMedia | null {
  const sniffed = sniffUploadMedia(b);
  if (!sniffed) return null;
  if (!sniffed.readable)
    throw new UnsupportedMediaTypeException(
      `This file is a ${sniffed.label} image, which the menu reader cannot open. ` +
        "Save it as JPEG or PNG and upload it again; nothing was read.",
    );
  return sniffed.mime;
}
