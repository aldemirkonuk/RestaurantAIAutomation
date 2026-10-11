import { ScanParserService, scanPrice } from "./scan-parser.service";

/**
 * F-1292: a photo or PDF read that keeps only part of the menu used to come
 * back as a plain list, the same as a whole read; the gaps were only logged.
 * F-1296: a scan price was written as the model gave it, so one "120 TL"
 * failed the whole insert.
 */

jest.setTimeout(60_000);

function service(): any {
  return new ScanParserService(
    { get: () => "fixture-key" } as any,
    {} as any,
    {} as any,
  );
}

describe("A partial menu read says why (F-1292)", () => {
  it("a photo read cut short is kept, and says so", async () => {
    const s = service();
    s.parseOne = jest
      .fn()
      .mockResolvedValue({ items: [{ name: "partial" }], truncated: true });
    const gaps: string[] = [];
    await expect(s.parse("image", "house", false, gaps)).resolves.toEqual([
      { name: "partial" },
    ]);
    expect(gaps).toEqual(["the reading stopped before the end of the menu"]);
  });

  it("a whole photo read says nothing", async () => {
    const s = service();
    s.parseOne = jest
      .fn()
      .mockResolvedValue({ items: [{ name: "whole" }], truncated: false });
    const gaps: string[] = [];
    await s.parse("image", "house", false, gaps);
    expect(gaps).toEqual([]);
  });

  it("a PDF cut short that cannot be split says so", async () => {
    const s = service();
    s.detectMediaType = () => "application/pdf";
    s.splitPdfIfLarge = jest.fn().mockResolvedValue(["pdf"]);
    s.parseOne = jest
      .fn()
      .mockResolvedValue({ items: [{ name: "partial" }], truncated: true });
    const gaps: string[] = [];
    await s.parse("pdf", "house", false, gaps);
    expect(gaps).toEqual(["the reading stopped before the end of the menu"]);
  });

  it("a part of the file that failed is counted", async () => {
    const s = service();
    s.parseOne = jest
      .fn()
      .mockResolvedValueOnce({ items: [{ name: "valid" }], truncated: false })
      .mockRejectedValueOnce(Error("upstream"));
    const gaps: string[] = [];
    await expect(
      s.parseChunks(["one", "two"], "house", 0, false, gaps),
    ).resolves.toEqual([{ name: "valid" }]);
    expect(gaps).toEqual(["1 of the 2 parts of the file could not be read"]);
  });

  it("pages past the cap are named", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    for (let n = 0; n < 121; n++) pdf.addPage([200, 200]);
    const s = service();
    const gaps: string[] = [];
    const chunks = await s.splitPdfIfLarge(
      Buffer.from(await pdf.save()).toString("base64"),
      { gaps },
    );
    expect(chunks.length).toBe(12);
    expect(gaps).toEqual(["only the first 120 of its 121 pages were read"]);
  });
});

describe("A scan price is a number or nothing (F-1296)", () => {
  it("reads plain numbers and drops the rest", () => {
    expect(scanPrice(120)).toBe(120);
    expect(scanPrice("120 TL")).toBe(120);
    expect(scanPrice("$12.50")).toBe(12.5);
    expect(scanPrice("12,50")).toBe(12.5);
    expect(scanPrice("1.250,00")).toBeUndefined();
    expect(scanPrice("market price")).toBeUndefined();
    expect(scanPrice("12 / 45")).toBeUndefined();
    expect(scanPrice(-4)).toBeUndefined();
    expect(scanPrice({})).toBeUndefined();
  });

  it("a line's bad price is dropped, the line kept", () => {
    const s = service();
    const items = s.keepNamedItems([
      { name: "Rakı", bottle_price: "1.250,00", by_glass_price: "180 TL" },
    ]);
    expect(items).toEqual([{ name: "Rakı", by_glass_price: 180 }]);
  });
});
