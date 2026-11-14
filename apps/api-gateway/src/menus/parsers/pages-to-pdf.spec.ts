import { bareBase64, pagesToOneFile, MAX_MENU_PAGES } from "./pages-to-pdf";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("pagesToOneFile — several photos of one menu are one file", () => {
  it("returns one page as it came, without a data: prefix", async () => {
    expect(await pagesToOneFile([`data:image/png;base64,${PNG}`])).toBe(PNG);
    expect(bareBase64(" data:application/pdf;base64,JVBERi0 ")).toBe("JVBERi0");
  });

  it("joins several pages into one PDF, one page each, in the order sent", async () => {
    const out = await pagesToOneFile([PNG, PNG]);
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(Buffer.from(out, "base64"));
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 1, height: 1 });
  });

  it("joins the same pages to the same bytes, a minute apart (so a resend reopens its read)", async () => {
    // pdf-lib stamps the current time unless told not to; move the clock past it.
    jest.useFakeTimers({ now: new Date("2026-11-11T10:00:00Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    try {
      const first = await pagesToOneFile([PNG, PNG]);
      jest.setSystemTime(new Date("2026-11-11T10:01:01Z"));
      const later = await pagesToOneFile([PNG, PNG]);
      expect(later).toBe(first);
      // Three pages are another file.
      expect(await pagesToOneFile([PNG, PNG, PNG])).not.toBe(first);
    } finally {
      jest.useRealTimers();
    }
  });

  it("refuses no page, an empty page, too many pages, and a page it cannot join, in words", async () => {
    await expect(pagesToOneFile([])).rejects.toThrow(/sent none that could be read/);
    await expect(pagesToOneFile([PNG, ""])).rejects.toThrow(/sent none that could be read/);
    await expect(pagesToOneFile(Array(MAX_MENU_PAGES + 1).fill(PNG))).rejects.toThrow(/at most 20 pages/);
    const webp = Buffer.from("RIFF0000WEBPVP8 ").toString("base64");
    await expect(pagesToOneFile([PNG, webp])).rejects.toThrow(/Page 2 is not a JPEG or PNG photo/);
  });
});
