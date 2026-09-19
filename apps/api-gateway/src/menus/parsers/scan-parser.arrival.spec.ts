import { HttpException } from "@nestjs/common";
import { ScanParserService } from "./scan-parser.service";

function service(): any {
  return new ScanParserService(
    { get: () => "fixture-key" } as any,
    {} as any,
    {} as any,
  );
}
describe("Arrival evidence keeps incomplete reads out of the batch", () => {
  it("rejects a truncated image while preserving legacy partial import behavior", async () => {
    const s = service();
    s.parseOne = jest
      .fn()
      .mockResolvedValue({ items: [{ name: "partial" }], truncated: true });
    await expect(s.parse("image", "house", true)).rejects.toThrow("cut short");
    await expect(s.parse("image", "house", false)).resolves.toEqual([
      { name: "partial" },
    ]);
  });
  it("does not replace a complete smaller retry with a larger incomplete response", async () => {
    const s = service();
    s.detectMediaType = () => "application/pdf";
    s.splitPdfIfLarge = jest
      .fn()
      .mockResolvedValueOnce(["pdf"])
      .mockResolvedValueOnce(["one", "two"]);
    s.parseOne = jest
      .fn()
      .mockResolvedValue({
        items: [{ name: "partial1" }, { name: "partial2" }],
        truncated: true,
      });
    s.parseChunks = jest.fn().mockResolvedValue([{ name: "complete" }]);
    await expect(s.parse("pdf", "house", true)).resolves.toEqual([
      { name: "complete" },
    ]);
  });
  it("refuses a page-range failure instead of staging a misleading partial menu", async () => {
    const s = service();
    s.parseOne = jest
      .fn()
      .mockResolvedValueOnce({ items: [{ name: "valid" }], truncated: false })
      .mockRejectedValueOnce(Error("upstream"));
    await expect(
      s.parseChunks(["one", "two"], "house", 0, true),
    ).rejects.toThrow("Some menu pages");
  });
  it("stops further chunks immediately when the spend ceiling refuses a call", async () => {
    const s = service();
    s.parseOne = jest
      .fn()
      .mockRejectedValue(new HttpException("Allowance reached", 429));
    await expect(
      s.parseChunks(["one", "two"], "house", 0, true),
    ).rejects.toThrow("Allowance reached");
    expect(s.parseOne).toHaveBeenCalledTimes(1);
  });
  it("refuses a PDF above the page cap instead of staging only its beginning", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    for (let n = 0; n < 121; n++) pdf.addPage([200, 200]);
    const s = service();
    s.parseOne = jest.fn();
    await expect(
      s.parse(Buffer.from(await pdf.save()).toString("base64"), "house", true),
    ).rejects.toThrow("exceeds 120 pages");
    expect(s.parseOne).not.toHaveBeenCalled();
  });
});
