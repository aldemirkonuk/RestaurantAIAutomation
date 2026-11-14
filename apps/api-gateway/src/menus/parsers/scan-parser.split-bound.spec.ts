import { ScanParserService } from "./scan-parser.service";
import { ConfigService } from "@nestjs/config";
import { ModelClientService } from "../../common/model-client/model-client.service";
import { NfVerdictService } from "../../common/model-client/nf-verdict.service";

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
    // nfVerdicts — splitPdfIfLarge never reaches a model call, so the grader is
    // never invoked here.
    {} as unknown as NfVerdictService,
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

/**
 * Proposal-menu step 1c (gap M4): a partial read says which pages it missed.
 * The page ranges come from the REAL split of a real PDF; only the model call
 * (`parseOne`) is stubbed.
 */
describe("parseWithWarnings — names the page ranges that errored or were cut off", () => {
  function readingService(): any {
    return new ScanParserService(
      { get: () => "fixture-key" } as unknown as ConfigService,
      {} as unknown as ModelClientService,
      {} as unknown as NfVerdictService,
    );
  }

  it("names the page range of a chunk that errored, and keeps the rest", async () => {
    const service = readingService();
    // 30 pages: pre-split into 10-page chunks (1-10, 11-20, 21-30).
    const base64 = await pdfWithPages(30);
    service.parseOne = jest
      .fn()
      .mockResolvedValueOnce({ items: [{ name: "A" }], truncated: false })
      .mockRejectedValueOnce(new Error("upstream"))
      .mockResolvedValueOnce({ items: [{ name: "C" }], truncated: false });

    const r = await service.parseWithWarnings(base64, "house");

    expect(r.items.map((i: any) => i.name)).toEqual(["A", "C"]);
    expect(r.warnings).toEqual([
      { kind: "chunk_failed", pages: { first: 11, last: 20 } },
    ]);
  });

  it("counts a re-split chunk's pages from the chunk's own first page", async () => {
    const service = readingService();
    const base64 = await pdfWithPages(30);
    service.parseOne = jest
      .fn()
      // pages 1-10
      .mockResolvedValueOnce({ items: [{ name: "A" }], truncated: false })
      // pages 11-20: cut off, so re-split into 2-page chunks 11-12 .. 19-20
      .mockResolvedValueOnce({ items: [{ name: "B0" }], truncated: true })
      .mockResolvedValueOnce({ items: [{ name: "B1" }], truncated: false })
      .mockRejectedValueOnce(new Error("upstream")) // pages 13-14
      .mockResolvedValueOnce({ items: [{ name: "B3" }], truncated: false })
      .mockResolvedValueOnce({ items: [{ name: "B4" }], truncated: false })
      .mockResolvedValueOnce({ items: [{ name: "B5" }], truncated: true }) // pages 19-20
      // pages 21-30
      .mockResolvedValueOnce({ items: [{ name: "C" }], truncated: false });

    const r = await service.parseWithWarnings(base64, "house");

    expect(r.warnings).toEqual([
      { kind: "chunk_failed", pages: { first: 13, last: 14 } },
      { kind: "truncated", pages: { first: 19, last: 20 } },
    ]);
    expect(r.items.map((i: any) => i.name)).toEqual([
      "A",
      "B1",
      "B3",
      "B4",
      "B5",
      "C",
    ]);
  });

  it("names the pages past the 120-page cap that were never sent", async () => {
    const service = readingService();
    // 125 pages: pre-split into twelve 10-page chunks (1-120); 121-125 dropped.
    const base64 = await pdfWithPages(125);
    service.parseOne = jest
      .fn()
      .mockResolvedValue({ items: [{ name: "A" }], truncated: false });

    const r = await service.parseWithWarnings(base64, "house");

    expect(service.parseOne).toHaveBeenCalledTimes(12);
    expect(r.warnings).toEqual([
      { kind: "page_cap", pages: { first: 121, last: 125 } },
    ]);
  });

  it("names the page range whose reply was not a list of lines", async () => {
    const service = readingService();
    const base64 = await pdfWithPages(30);
    service.parseOne = jest
      .fn()
      .mockResolvedValueOnce({ items: [{ name: "A" }], truncated: false })
      .mockResolvedValueOnce({ items: [], truncated: false, unreadable: true })
      // an empty list is a page with no wine, not an unreadable reply
      .mockResolvedValueOnce({ items: [], truncated: false, unreadable: false });

    const r = await service.parseWithWarnings(base64, "house");

    expect(r.items.map((i: any) => i.name)).toEqual(["A"]);
    expect(r.warnings).toEqual([
      { kind: "unreadable_reply", pages: { first: 11, last: 20 } },
    ]);
  });

  it("arrival refuses a PDF read with one unreadable range instead of dropping it", async () => {
    const service = readingService();
    const base64 = await pdfWithPages(30);
    service.parseOne = jest
      .fn()
      .mockResolvedValueOnce({ items: [{ name: "A" }], truncated: false })
      .mockResolvedValueOnce({ items: [], truncated: false, unreadable: true })
      .mockResolvedValueOnce({ items: [{ name: "C" }], truncated: false });

    await expect(service.parse(base64, "house", true)).rejects.toThrow(
      "Some menu pages could not be read",
    );
  });

  it("says a one-shot read's reply was unreadable, with no page range", async () => {
    const service = readingService();
    service.parseOne = jest
      .fn()
      .mockResolvedValue({ items: [], truncated: false, unreadable: true });
    const png = Buffer.from("not a pdf").toString("base64");

    await expect(service.parseWithWarnings(png, "house")).resolves.toEqual({
      items: [],
      warnings: [{ kind: "unreadable_reply", pages: null }],
    });
  });

  it("a model reply that is prose or an object is unreadable; an empty list is not", async () => {
    const reply = (text: string) =>
      new ScanParserService(
        { get: () => "fixture-key" } as unknown as ConfigService,
        {
          call: async () => ({ content: [{ text }], stop_reason: "end_turn" }),
        } as unknown as ModelClientService,
        { record: () => undefined } as unknown as NfVerdictService,
      );
    const png = Buffer.from("not a pdf").toString("base64");
    const unreadable = [{ kind: "unreadable_reply", pages: null }];

    for (const text of ["Sorry, I cannot read this menu.", '{"wines": []}'])
      expect((await reply(text).parseWithWarnings(png)).warnings).toEqual(
        unreadable,
      );
    expect((await reply("[]").parseWithWarnings(png)).warnings).toEqual([]);
  });

  it("says a cut-off image read was cut off; parse() still returns only the lines", async () => {
    const service = readingService();
    service.parseOne = jest
      .fn()
      .mockResolvedValue({ items: [{ name: "partial" }], truncated: true });
    const png = Buffer.from("not a pdf").toString("base64");

    await expect(service.parseWithWarnings(png, "house")).resolves.toEqual({
      items: [{ name: "partial" }],
      warnings: [{ kind: "truncated", pages: null }],
    });
    await expect(service.parse(png, "house")).resolves.toEqual([
      { name: "partial" },
    ]);
  });
});
