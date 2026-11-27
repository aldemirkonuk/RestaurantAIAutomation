/**
 * A drink's photo, before it is stored (r110 drinks-g3). Pure: bytes in, bytes
 * out, no I/O.
 *
 * WHY THE METADATA GOES
 * A phone photo carries EXIF, and EXIF carries GPS: a stored photo would put
 * the house's location (and the camera, the owner's name, the time) in a file
 * the house never meant to publish. Every metadata block is removed before the
 * bytes reach storage, whatever the client did first.
 *
 * HOW, WITHOUT AN IMAGE CODEC
 * The gateway has no image library (no sharp, no jimp in its dependencies), and
 * a native codec is a dependency and deploy decision of its own. The web client
 * re-encodes the photo to WebP at most 1600 px on a canvas before it sends it
 * (a canvas writes no metadata), so the normal path already arrives clean. The
 * gateway does not trust that: it walks the container and drops every block
 * that can hold metadata, and refuses a file whose structure does not parse.
 * - JPEG: every APPn segment except APP0 (JFIF), APP2 (ICC colour) and APP14
 *   (Adobe colour transform), and every COM segment. APP1 is EXIF and XMP,
 *   APP13 is IPTC/Photoshop.
 * - PNG: eXIf, tEXt, zTXt, iTXt and tIME chunks.
 * - WebP: EXIF and XMP chunks, and the VP8X flags that announce them.
 *
 * The type is read from the bytes, never from a name or a header.
 */

export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type PhotoType = { mime: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

/** Said when the bytes are not a JPEG, PNG or WebP that parses. */
export const PHOTO_NOT_AN_IMAGE = "That file is not a JPEG, PNG or WebP photo we can read. Nothing was stored.";
export const PHOTO_TOO_BIG = "That photo is over 5 MB. Nothing was stored.";

export function sniffPhoto(bytes: Buffer): PhotoType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIG)) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  return null;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

class Malformed extends Error {}

const EOI = Buffer.from([0xff, 0xd9]);

/** JPEG markers kept: APP0 (JFIF), APP2 only when it is the ICC profile, APP14 (Adobe). Every other APPn and COM goes. */
const ICC = Buffer.from("ICC_PROFILE\0", "latin1");
const keepJpegApp = (marker: number, seg: Buffer) =>
  marker === 0xe0 || marker === 0xee || (marker === 0xe2 && seg.subarray(4, 4 + ICC.length).equals(ICC));

function stripJpeg(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2;
  for (;;) {
    if (i + 4 > b.length || b[i] !== 0xff) throw new Malformed();
    const marker = b[i + 1];
    // Fill bytes before a marker.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) throw new Malformed();
    const seg = b.subarray(i, i + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xda) {
      // Start of scan: the image runs to the first end-of-image marker (in the
      // coded data 0xFF is always followed by 0x00 or a restart, never 0xD9).
      // What a phone appends after it (MPF second images, gain maps, each
      // able to carry its own EXIF) is not kept.
      const eoi = b.indexOf(EOI, i + 2 + len);
      if (eoi < 0) throw new Malformed();
      out.push(b.subarray(i, eoi + 2));
      return Buffer.concat(out);
    }
    if ((!isApp || keepJpegApp(marker, seg)) && marker !== 0xfe) out.push(seg);
    i += 2 + len;
  }
}

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Buffer): Buffer {
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  let ended = false;
  while (i < b.length) {
    if (i + 12 > b.length) throw new Malformed();
    const len = b.readUInt32BE(i);
    const end = i + 12 + len;
    if (end > b.length) throw new Malformed();
    const type = b.subarray(i + 4, i + 8).toString("latin1");
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended) throw new Malformed();
  return Buffer.concat(out);
}

const WEBP_DROP = new Set(["EXIF", "XMP "]);

function stripWebp(b: Buffer): Buffer {
  const riffEnd = 8 + b.readUInt32LE(4);
  if (riffEnd > b.length || riffEnd < 12) throw new Malformed();
  const chunks: Buffer[] = [];
  let i = 12;
  while (i < riffEnd) {
    if (i + 8 > riffEnd) throw new Malformed();
    const fourcc = b.subarray(i, i + 4).toString("latin1");
    const size = b.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > riffEnd) throw new Malformed();
    if (!WEBP_DROP.has(fourcc)) {
      const chunk = Buffer.from(b.subarray(i, Math.min(end, riffEnd)));
      // VP8X flags: bit 3 (0x08) says EXIF follows, bit 2 (0x04) XMP. Neither does now.
      if (fourcc === "VP8X" && chunk.length > 8) chunk[8] &= ~0x0c;
      chunks.push(chunk);
    }
    i = end;
  }
  if (chunks.length === 0) throw new Malformed();
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
}

/**
 * The photo's bytes with every metadata block removed, and its type; or the
 * sentence that says why it was refused. A file over 5 MB, of another type, or
 * whose container does not parse is refused, never stored as it came.
 */
export function cleanPhoto(bytes: Buffer): { bytes: Buffer; type: PhotoType } | { refused: string } {
  if (bytes.length > PHOTO_MAX_BYTES) return { refused: PHOTO_TOO_BIG };
  const type = sniffPhoto(bytes);
  if (!type) return { refused: PHOTO_NOT_AN_IMAGE };
  try {
    const clean = type.ext === "jpg" ? stripJpeg(bytes) : type.ext === "png" ? stripPng(bytes) : stripWebp(bytes);
    return { bytes: clean, type };
  } catch {
    return { refused: PHOTO_NOT_AN_IMAGE };
  }
}

/** Where a house's drink photo is kept: under the house, then the drink, then a fresh name. */
export const photoPath = (restaurantId: string, cocktailId: string, name: string, ext: PhotoType["ext"]) =>
  `${restaurantId}/${cocktailId}/${name}.${ext}`;
