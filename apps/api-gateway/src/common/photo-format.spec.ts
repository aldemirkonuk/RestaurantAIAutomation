import {
  formatRefusalSentence,
  isoImageFormat,
  sniffPhotoFormat,
  stripDataUrl,
} from "./photo-format";

/** An `ftyp` box head: 4-byte size, `ftyp`, major brand, minor version, then padding. */
const ftyp = (brand: string, size = 0x18) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, size]),
    Buffer.from("ftyp" + brand, "latin1"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("mif1miaf", "latin1"),
    Buffer.alloc(32, 0xab),
  ]).toString("base64");

const HEIC = ftyp("heic");
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32, 0x11),
]).toString("base64");

describe("photo-format — one sniff for every path that reads a photo", () => {
  it("strips a data: URL prefix and keeps the type it declared", () => {
    expect(stripDataUrl(`data:image/heic;base64,${HEIC}`)).toEqual({
      base64: HEIC,
      declared: "image/heic",
    });
    expect(
      stripDataUrl(`data:image/jpeg;name=menu.jpg;base64,${JPEG}`),
    ).toEqual({ base64: JPEG, declared: "image/jpeg" });
    expect(stripDataUrl(JPEG)).toEqual({ base64: JPEG, declared: null });
  });

  it("sees HEIC bytes behind a data: URL prefix", () => {
    expect(isoImageFormat(`data:image/heic;base64,${HEIC}`)).toBe("HEIC");
    // The prefix lies about the type; the bytes win.
    expect(sniffPhotoFormat(`data:image/jpeg;base64,${HEIC}`)).toEqual({
      refused: "HEIC",
    });
    expect(
      sniffPhotoFormat(`data:application/octet-stream;base64,${ftyp("avif")}`),
    ).toEqual({ refused: "AVIF" });
  });

  it("hands back bare base64 for a readable photo behind a prefix", () => {
    expect(sniffPhotoFormat(`data:image/jpeg;base64,${JPEG}`)).toEqual({
      mediaType: "image/jpeg",
      base64: JPEG,
    });
  });

  it("refuses bytes in no format the model takes instead of guessing JPEG", () => {
    const unknown = Buffer.from([1, 2, 3, 4, 5, 6]).toString("base64");
    expect(sniffPhotoFormat(unknown)).toEqual({ refused: "unknown" });
  });

  it("words the reason once and the outcome per path", () => {
    expect(formatRefusalSentence("HEIC", "nothing was imported")).toBe(
      "This photo is in HEIC format, which the reader cannot open, so nothing was imported. Send it again as a JPEG, or take the photo again.",
    );
    expect(
      formatRefusalSentence("unknown", "the paper was stored unread"),
    ).toBe(
      "This file is not a PDF, JPEG, PNG, WebP or GIF, so the reader could not open it and the paper was stored unread. Send it again as a PDF or a JPEG photo.",
    );
  });
});
