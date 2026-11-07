/**
 * What an uploaded photo or PDF IS, read from its bytes. One sniff for every
 * path that hands a paper to the vision model — document intake
 * (`document-extractor.service.ts`) and the menu scan
 * (`menus/parsers/scan-parser.service.ts`) — so a HEIC photo is refused with
 * the same reason on both, and never sent to the model labelled JPEG.
 *
 * The model takes JPEG, PNG, GIF and WebP images
 * (https://platform.claude.com/docs/en/build-with-claude/vision#supported-formats)
 * and PDF. Anything else is refused with a reason, never sent as a guess.
 */

export type ModelMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "application/pdf";

/** Why a payload is not sent: HEIC/AVIF by name, or bytes in no format the model takes. */
export type RefusedFormat = "HEIC" | "AVIF" | "unknown";

/** `base64` is the payload with any `data:` URL prefix removed — what the model is sent. */
export type SniffedFormat =
  | { mediaType: ModelMediaType; base64: string }
  | { refused: RefusedFormat };

/**
 * ISO-BMFF major brands at bytes 8-11 (after `ftyp` at 4-7). HEIF is an
 * iPhone's default; AVIF is refused too, by its own name (founder /goal
 * 2026-11-07 delegated the call).
 */
const HEIF_BRANDS = new Set(
  "heic heix hevc hevx heim heis hevm hevs mif1 msf1".split(" "),
);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/**
 * `data:<type>[;param]*;base64,` — what `FileReader.readAsDataURL` writes. The
 * clients strip it today; a payload that still carries it is sniffed past it,
 * so a HEIC behind the prefix is still seen as HEIC.
 */
const DATA_URL_PREFIX = /^data:([^;,]*)(?:;[^;,]*)*;base64,/i;

/** The bare base64 and the type a `data:` URL prefix declared, if it had one. */
export function stripDataUrl(payload: string): {
  base64: string;
  declared: string | null;
} {
  const m = DATA_URL_PREFIX.exec(payload);
  if (!m) return { base64: payload, declared: null };
  return { base64: payload.slice(m[0].length), declared: m[1] || null };
}

/**
 * HEIC or AVIF from the first 12 bytes (16 base64 chars), or null. Not a base64
 * prefix match: the box size in bytes 0-3 varies, which shifts the characters.
 */
export function isoImageFormat(payload: string): "HEIC" | "AVIF" | null {
  const { base64 } = stripDataUrl(payload);
  const head = Buffer.from(base64.slice(0, 16), "base64");
  if (head.length < 12) return null;
  if (head.toString("latin1", 4, 8) !== "ftyp") return null;
  const brand = head.toString("latin1", 8, 12);
  if (HEIF_BRANDS.has(brand)) return "HEIC";
  if (AVIF_BRANDS.has(brand)) return "AVIF";
  return null;
}

/**
 * The media type to send, or why not. `declared` is a content-type from an
 * email header or an upload form; a `data:` prefix's type stands in when there
 * is none.
 */
export function sniffPhotoFormat(
  payload: string,
  declared?: string | null,
): SniffedFormat {
  const { base64, declared: prefixDeclared } = stripDataUrl(payload);
  const ok = (mediaType: ModelMediaType): SniffedFormat => ({
    mediaType,
    base64,
  });

  // HEIC/AVIF bytes first, whatever the label says: a photo that IS HEIC is
  // unreadable even when an upload path called it image/jpeg.
  const iso = isoImageFormat(base64);
  if (iso) return { refused: iso };

  const d = (declared || prefixDeclared || "").toLowerCase();
  if (d.includes("pdf")) return ok("application/pdf");
  if (d.includes("png")) return ok("image/png");
  if (d.includes("webp")) return ok("image/webp");
  if (d.includes("gif")) return ok("image/gif");
  if (d.includes("jpeg") || d.includes("jpg")) return ok("image/jpeg");

  // Fall back to magic bytes: a declared content-type from an email header is
  // frequently wrong or absent, and the file itself does not lie.
  if (base64.startsWith("JVBERi")) return ok("application/pdf"); // %PDF
  if (base64.startsWith("/9j/")) return ok("image/jpeg");
  if (base64.startsWith("iVBORw")) return ok("image/png");
  if (base64.startsWith("UklGR")) return ok("image/webp");
  if (base64.startsWith("R0lGOD")) return ok("image/gif");

  // A declared HEIC/HEIF/AVIF whose bytes did not say otherwise is taken at
  // its word — and is never read as JPEG.
  if (/hei[cf]/.test(d)) return { refused: "HEIC" };
  if (d.includes("avif")) return { refused: "AVIF" };

  // Both readers used to `return "image/jpeg"` here: a guess the model
  // rejected, reported as the model being unreachable — the wrong reason.
  return { refused: "unknown" };
}

/**
 * The sentence a person reads for a refused format. `outcome` is what became
 * of the upload on that path ("the paper was stored unread", "nothing was
 * imported"), so the reason and the remedy are worded once for every path.
 */
export function formatRefusalSentence(
  refused: RefusedFormat,
  outcome: string,
): string {
  if (refused === "unknown")
    return `This file is not a PDF, JPEG, PNG, WebP or GIF, so the reader could not open it and ${outcome}. Send it again as a PDF or a JPEG photo.`;
  return `This photo is in ${refused} format, which the reader cannot open, so ${outcome}. Send it again as a JPEG, or take the photo again.`;
}
