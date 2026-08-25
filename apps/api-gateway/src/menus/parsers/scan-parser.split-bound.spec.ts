import { ScanParserService } from "./scan-parser.service";
import { ConfigService } from "@nestjs/config";
import { ModelClientService } from "../../common/model-client/model-client.service";

/**
 * OD-55 — loop-bound injection (CodeQL `js/loop-bound-injection`, high).
 *
 * `splitPdfIfLarge` read the page count out of an UPLOADED PDF and produced one
 * chunk per N pages; `parseChunks` then makes one PAID MODEL CALL per chunk. So
 * a single upload could drive thousands of billed calls. `MAX_SPLIT_DEPTH`
 * bounded recursion depth — nothing bounded breadth, which is the cheaper
 * attack.
 *
 * These tests build REAL PDFs with pdf-lib rather than stubbing the page count,
 * because the whole defect is that the count comes from the file.
 */

jest.setTimeout(120_000);

async function pdfWithPages(n: number): Promise<string> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([200, 200]);
  return Buffer.from(await doc.save()).toString("base64");
}

function makeService(): any {
  return new ScanParserService(
    { get: () => undefined } as unknown as ConfigService,
    {} as unknown as ModelClientService,
  );
}

describe("splitPdfIfLarge — the chunk count is bounded by us, not by the upload", () => {
  it("caps chunks for a hostile page count instead of scaling with it", async () => {
    const service = makeService();
    // 600 pages: at 6 pages/chunk that is 100 model calls, unbounded before the
    // fix. Kept modest so the test stays fast — the property is the cap, and a
    // cap that holds at 600 holds at 50,000.
    const base64 = await pdfWithPages(600);

    const chunks: string[] = await service.splitPdfIfLarge(base64, {
      force: true,
    });

    // MAX_PAGES 120 / PAGES_PER_CHUNK 6 = 20.
    expect(chunks.length).toBe(20);
    // The defect was chunks.length tracking pageCount. 600/6 = 100.
    expect(chunks.length).toBeLessThan(100);
  });

  it("still splits an ordinary long menu in full, uncapped", async () => {
    const service = makeService();
    // 42 pages — the densest real menu in the corpus is ~40. The cap must be
    // unreachable by legitimate use, or it is a silent data-loss bug.
    const base64 = await pdfWithPages(42);

    const chunks: string[] = await service.splitPdfIfLarge(base64, {
      force: true,
    });

    expect(chunks.length).toBe(7); // ceil(42/6) — nothing dropped
  });

  it("leaves a small PDF unsplit", async () => {
    const service = makeService();
    const base64 = await pdfWithPages(3);
    const chunks: string[] = await service.splitPdfIfLarge(base64);
    expect(chunks).toHaveLength(1);
  });

  it("returns the input unchanged when the bytes are not a PDF at all", async () => {
    const service = makeService();
    const notAPdf = Buffer.from("plainly not a pdf").toString("base64");
    const chunks: string[] = await service.splitPdfIfLarge(notAPdf, {
      force: true,
    });
    // Unsplittable input must still get one shot at extraction, not be dropped.
    expect(chunks).toEqual([notAPdf]);
  });
});
