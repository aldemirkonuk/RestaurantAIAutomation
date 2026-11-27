/**
 * A drink photo's bytes before storing (r110 drinks-g3, drink-photo.ts): every metadata block is gone, the image
 * itself is kept, the type is read from the bytes, and a file that does not parse or is over 5 MB is refused.
 */
import { PHOTO_MAX_BYTES, PHOTO_NOT_AN_IMAGE, PHOTO_TOO_BIG, cleanPhoto, photoPath, sniffPhoto } from "./drink-photo";
import { hasGps, jpegWithGps, pngWithGps, webpWithGps } from "./drink-photo.testing";

const clean = (b: Buffer) => {
  const c = cleanPhoto(b);
  if ("refused" in c) throw new Error(c.refused);
  return c;
};

describe("cleanPhoto", () => {
  it("a JPEG loses EXIF (GPS), XMP, comments, MPF and what is appended after the image; JFIF, ICC and the image stay", () => {
    const raw = jpegWithGps();
    expect(hasGps(raw)).toBe(true);
    const { bytes, type } = clean(raw);
    expect(type).toEqual({ mime: "image/jpeg", ext: "jpg" });
    expect(hasGps(bytes)).toBe(false);
    expect(bytes.includes(Buffer.from("taken at the bar", "latin1"))).toBe(false);
    expect(bytes.includes(Buffer.from("MPF", "latin1"))).toBe(false);
    expect(bytes.includes(Buffer.from("JFIF", "latin1"))).toBe(true);
    expect(bytes.includes(Buffer.from("ICC_PROFILE", "latin1"))).toBe(true);
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(bytes.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(bytes.includes(Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]))).toBe(true);
  });

  it("a PNG loses eXIf and tEXt and keeps its image; a WebP loses EXIF and XMP and the VP8X flags that announced them", () => {
    for (const raw of [pngWithGps(), webpWithGps()]) {
      expect(hasGps(raw)).toBe(true);
      expect(hasGps(clean(raw).bytes)).toBe(false);
    }
    expect(clean(pngWithGps()).bytes.includes(Buffer.from("IDAT", "latin1"))).toBe(true);
    const w = clean(webpWithGps()).bytes;
    expect(w.readUInt32LE(4)).toBe(w.length - 8);
    expect(w[20] & 0x0c).toBe(0);
    expect(w.includes(Buffer.from("VP8 ", "latin1"))).toBe(true);
  });

  it("reads the type from the bytes, and refuses another type, a file that does not parse, and one over 5 MB", () => {
    expect(sniffPhoto(Buffer.from("GIF89a....", "latin1"))).toBeNull();
    expect(cleanPhoto(Buffer.from("GIF89a....", "latin1"))).toEqual({ refused: PHOTO_NOT_AN_IMAGE });
    expect(cleanPhoto(jpegWithGps().subarray(0, 40))).toEqual({ refused: PHOTO_NOT_AN_IMAGE });
    expect(cleanPhoto(pngWithGps().subarray(0, 60))).toEqual({ refused: PHOTO_NOT_AN_IMAGE });
    expect(cleanPhoto(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(PHOTO_MAX_BYTES)]))).toEqual({ refused: PHOTO_TOO_BIG });
  });

  it("the path is the house, then the drink, then the name", () => {
    expect(photoPath("h", "d", "n", "webp")).toBe("h/d/n.webp");
  });
});
