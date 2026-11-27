import { createHash } from "crypto";
import { deflateSync } from "zlib";
import { PDFDocument } from "pdf-lib";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UploadDocumentDto } from "./dto/documents.dto";
import { DocumentsController } from "./documents.controller";
import {
  composePages,
  bodyLimitBytes,
  ComposePagesError,
  MAX_PAGES,
} from "./compose-pages";

/**
 * ONE PAPER, MANY PAGES (r108 g13). Each case fails with the rule it names
 * removed: fixed dates (hash), page order, the page cap, the WebP refusal, and
 * the page count of the PDF the extractor will read.
 */

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A w x h grey PNG whose pixel value is `shade`, so pages differ by content. */
function png(w: number, h: number, shade: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grey
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w, shade)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const webp = () =>
  Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    Buffer.alloc(4),
    Buffer.from("WEBPVP8 ", "latin1"),
    Buffer.alloc(16),
  ]);
const three = () => [png(8, 8, 10), png(8, 8, 120), png(8, 8, 240)];

describe("composePages", () => {
  it("the same 3 pages twice give the same sha256", async () => {
    const a = await composePages(three());
    // a later clock must not leak into the file
    jest.useFakeTimers().setSystemTime(new Date("2031-05-05T05:05:05Z"));
    const b = await composePages(three());
    jest.useRealTimers();
    expect(sha(a)).toBe(sha(b));
  });

  it("writes a plain xref table and the fixed producer, with no object streams", async () => {
    const out = await composePages(three());
    const text = out.toString("latin1");
    expect(text).not.toContain("/ObjStm");
    expect(text).toContain("xref");
    const parsed = await PDFDocument.load(out, { updateMetadata: false });
    expect(parsed.getProducer()).toBe("Mudavym");
    expect(parsed.getCreationDate()?.toISOString()).toBe("2000-01-01T00:00:00.000Z");
    expect(parsed.getModificationDate()?.toISOString()).toBe("2000-01-01T00:00:00.000Z");
  });

  it("a different order gives a different hash", async () => {
    const [p1, p2, p3] = three();
    expect(sha(await composePages([p1, p2, p3]))).not.toBe(
      sha(await composePages([p2, p1, p3])),
    );
  });

  it("the parsed PDF has 3 pages", async () => {
    const out = await composePages(three());
    expect(out.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const parsed = await PDFDocument.load(out);
    expect(parsed.getPageCount()).toBe(3);
  });

  it("takes a JPEG page beside a PNG page", async () => {
    // a 16 x 16 grey JPEG with its metadata stripped
    const jpeg = Buffer.from(
      "/9j/wAALCAAQABABAREA/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9sAQwAbGxsbGxsvGxsvQi8vL0JZQkJCQllwWVlZWVlwiHBwcHBwcIiIiIiIiIiIo6Ojo6Ojvr6+vr7V1dXV1dXV1dXV/90ABAAC/9oACAEBAAA/AKVpF0rYml+x2jSj7x+Vfqf8Otf/0JrSLpVG/l+0XflL92L5fx7/AOH4V//Z",
      "base64",
    );
    const out = await composePages([jpeg, png(8, 8, 9)]);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  it("refuses 11 pages, in words", async () => {
    const pages = Array.from({ length: MAX_PAGES + 1 }, (_, i) => png(4, 4, i));
    await expect(composePages(pages)).rejects.toThrow(
      /at most 10 pages, and 11 were sent/,
    );
    await expect(composePages(pages)).rejects.toBeInstanceOf(ComposePagesError);
  });

  it("refuses a WebP page, naming which page and what to send", async () => {
    await expect(
      composePages([png(4, 4, 1), webp(), png(4, 4, 2)]),
    ).rejects.toThrow(/Page 2 is a WebP image.*JPEG or PNG/);
  });

  it("refuses one page, and a page that is not an image", async () => {
    await expect(composePages([png(4, 4, 1)])).rejects.toThrow(/at least 2 pages/);
    await expect(
      composePages([png(4, 4, 1), Buffer.from("%PDF-1.4 not an image")]),
    ).rejects.toThrow(/Page 2 is not a JPEG or PNG/);
  });

  it("refuses pages that together pass the upload limit", async () => {
    await expect(composePages(three(), 100)).rejects.toThrow(/more than the 0 MB one upload/);
  });
});

describe("bodyLimitBytes", () => {
  it("reads main.ts's limit string, defaulting to 15mb", () => {
    expect(bodyLimitBytes(undefined)).toBe(15 * 1024 * 1024);
    expect(bodyLimitBytes("20mb")).toBe(20 * 1024 * 1024);
    expect(bodyLimitBytes("512kb")).toBe(512 * 1024);
  });
});

describe("POST /procurement/documents with pages", () => {
  const intake = {
    ingest: jest
      .fn()
      .mockResolvedValue({ documentId: "doc-1", duplicate: false, parsed: null }),
  };
  // intake first; the other ten collaborators are not on this path
  const controller = new (DocumentsController as any)(
    intake,
    ...Array.from({ length: 10 }, () => ({})),
  ) as DocumentsController;
  const user = { userId: "u-1", restaurantId: "r-1", role: "owner" } as any;
  const b64 = (b: Buffer) => b.toString("base64");
  beforeEach(() => intake.ingest.mockClear());

  it("ingests ONE pdf, the same bytes for the same pages", async () => {
    const pages = three().map(b64);
    await controller.upload({ pages } as any, user);
    await controller.upload({ pages } as any, user);
    expect(intake.ingest).toHaveBeenCalledTimes(2);
    const [a, b] = intake.ingest.mock.calls.map((c) => c[0]);
    expect(a.mimeType).toBe("application/pdf");
    expect(a.source).toBe("photo");
    expect(sha(a.buffer)).toBe(sha(b.buffer));
    expect((await PDFDocument.load(a.buffer)).getPageCount()).toBe(3);
  });

  it("refuses pages sent with contentBase64, and a refused page, as a 400 in words", async () => {
    await expect(
      controller.upload({ pages: three().map(b64), contentBase64: "AAAA" } as any, user),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/not both/) });
    await expect(
      controller.upload({ pages: [b64(png(4, 4, 1)), b64(webp())] } as any, user),
    ).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/WebP/) });
    expect(intake.ingest).not.toHaveBeenCalled();
  });

  it("the body is checked: 11 pages and a body with neither field are refused", async () => {
    const over = plainToInstance(UploadDocumentDto, {
      pages: Array.from({ length: 11 }, () => "AAAA"),
    });
    const e1 = await validate(over);
    expect(JSON.stringify(e1)).toMatch(/at most 10 pages/);
    const none = plainToInstance(UploadDocumentDto, {});
    expect((await validate(none)).length).toBeGreaterThan(0);
    const single = plainToInstance(UploadDocumentDto, { contentBase64: "AAAA" });
    expect(await validate(single)).toHaveLength(0);
  });
});
