import { UnsupportedMediaTypeException } from "@nestjs/common";
import { ScanParserService } from "./scan-parser.service";
import {
  decodeUploadBase64,
  readableMenuMediaOrRefuse,
  sniffUploadMedia,
  stripDataUrlPrefix,
} from "./upload-base64";

/** Leading bytes of each kind, as a browser or camera writes them. */
const MAGIC = {
  pdf: Buffer.from("%PDF-1.7\n"),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.from([0x24, 0, 0, 0]),
    Buffer.from("WEBPVP8 "),
  ]),
  gif: Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"),
  // An iPhone photo: ftyp box, major brand heic, compatible mif1 heic.
  heic: Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from("ftypheic"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("mif1heic"),
  ]),
  // A HEIF whose only image brand is mif1.
  heif: Buffer.concat([
    Buffer.from([0, 0, 0, 0x14]),
    Buffer.from("ftypmif1"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("mif1"),
  ]),
  // AVIF often has major brand mif1 and avif only among the compatible brands.
  avif: Buffer.concat([
    Buffer.from([0, 0, 0, 0x1c]),
    Buffer.from("ftypmif1"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("mif1avifmiaf"),
  ]),
  tiffLe: Buffer.from("II*\0\x08\0\0\0", "latin1"),
  tiffBe: Buffer.from("MM\0*\0\0\0\x08", "latin1"),
  // 14-byte file header (size, zero reserved, pixel offset) + DIB size 40.
  bmp: Buffer.from(
    "BM\x36\x00\x0c\x00\x00\x00\x00\x00\x36\x00\x00\x00\x28\x00\x00\x00",
    "latin1",
  ),
};

describe("decodeUploadBase64 — a data URL and bare base64 decode to the same bytes (gap M6)", () => {
  const bytes = Buffer.concat([MAGIC.png, Buffer.from("rest of the photo")]);
  const bare = bytes.toString("base64");

  it("strips a data-URL prefix, so the bytes are the file and not the prefix's letters", () => {
    const r = decodeUploadBase64(`data:image/png;base64,${bare}`);
    expect(r.base64).toBe(bare);
    expect(r.bytes.equals(bytes)).toBe(true);
  });

  it("leaves bare base64 as it is", () => {
    expect(decodeUploadBase64(bare)).toEqual({ base64: bare, bytes });
    expect(stripDataUrlPrefix(bare)).toBe(bare);
  });

  it("strips whatever type the browser declared, since the type is sniffed from the bytes", () => {
    expect(
      stripDataUrlPrefix(`data:application/octet-stream;base64,${bare}`),
    ).toBe(bare);
    expect(
      stripDataUrlPrefix(`DATA:image/jpeg;name=menu.jpg;base64,${bare}`),
    ).toBe(bare);
  });
});

describe("sniffUploadMedia — each magic-byte family maps or is refused", () => {
  it.each([
    ["pdf", "application/pdf", "pdf"],
    ["jpeg", "image/jpeg", "jpg"],
    ["png", "image/png", "png"],
    ["webp", "image/webp", "webp"],
    ["gif", "image/gif", "gif"],
  ] as const)("%s is readable as %s", (kind, mime, ext) => {
    expect(sniffUploadMedia(MAGIC[kind])).toEqual({
      readable: true,
      mime,
      ext,
    });
    expect(readableMenuMediaOrRefuse(MAGIC[kind])).toBe(mime);
  });

  it.each([
    ["heic", "HEIC", "image/heic"],
    ["heif", "HEIF", "image/heif"],
    ["avif", "AVIF", "image/avif"],
    ["tiffLe", "TIFF", "image/tiff"],
    ["tiffBe", "TIFF", "image/tiff"],
    ["bmp", "BMP", "image/bmp"],
  ] as const)(
    "%s is recognised and refused in words, never labelled JPEG",
    (kind, label, mime) => {
      expect(sniffUploadMedia(MAGIC[kind])).toMatchObject({
        readable: false,
        label,
        mime,
      });
      let thrown: unknown;
      try {
        readableMenuMediaOrRefuse(MAGIC[kind]);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(UnsupportedMediaTypeException);
      expect((thrown as UnsupportedMediaTypeException).getStatus()).toBe(415);
      expect((thrown as Error).message).toBe(
        `This file is a ${label} image, which the menu reader cannot open. Save it as JPEG or PNG and upload it again; nothing was read.`,
      );
    },
  );

  it("bytes of no known kind are null, not a guess", () => {
    expect(sniffUploadMedia(Buffer.from("hello, menu"))).toBeNull();
    expect(readableMenuMediaOrRefuse(Buffer.from("hello, menu"))).toBeNull();
  });

  it("a file that only starts with the letters BM is not taken for a bitmap", () => {
    const text = Buffer.from("BM menu notes, wines by the glass, page one");
    expect(sniffUploadMedia(text)).toBeNull();
    expect(readableMenuMediaOrRefuse(text)).toBeNull();
  });
});

function service(): any {
  const s: any = new ScanParserService(
    { get: () => "fixture-key" } as any,
    {} as any,
    {} as any,
  );
  s.parseOne = jest
    .fn()
    .mockResolvedValue({ items: [{ name: "Opus One" }], truncated: false });
  return s;
}
const photo = (head: Buffer) =>
  Buffer.concat([head, Buffer.alloc(80, 7)]).toString("base64");

describe("ScanParserService — what reaches the model is the file, with its real type (gap M6)", () => {
  it("a data-URL photo reaches the model as bare base64 labelled by its bytes", async () => {
    const s = service();
    const bare = photo(MAGIC.png);
    await s.parse(`data:image/png;base64,${bare}`, "house");
    expect(s.parseOne).toHaveBeenCalledWith(
      bare,
      "image/png",
      false,
      "house",
      false,
    );
  });

  it.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
    ["gif", "image/gif"],
  ] as const)("a %s photo is sent as %s", async (kind, mime) => {
    const s = service();
    await s.parse(photo(MAGIC[kind]), "house");
    expect(s.parseOne.mock.calls[0][1]).toBe(mime);
  });

  it.each(["heic", "heif", "avif", "tiffLe", "tiffBe", "bmp"] as const)(
    "a %s photo is refused with a 415 before the billed read",
    async (kind) => {
      const s = service();
      await expect(s.parse(photo(MAGIC[kind]), "house")).rejects.toBeInstanceOf(
        UnsupportedMediaTypeException,
      );
      await expect(
        s.parse(
          `data:image/${kind};base64,${photo(MAGIC[kind])}`,
          "house",
          true,
        ),
      ).rejects.toThrow(/which the menu reader cannot open/);
      expect(s.parseOne).not.toHaveBeenCalled();
    },
  );

  it("a refused kind gets its 415 even when no model key is set", async () => {
    const s: any = new ScanParserService(
      { get: () => undefined } as any,
      {} as any,
      {} as any,
    );
    await expect(s.parse(photo(MAGIC.heic), "house")).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });
});
