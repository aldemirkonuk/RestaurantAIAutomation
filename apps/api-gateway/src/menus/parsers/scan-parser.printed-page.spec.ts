/**
 * r110 menu-g4: a line keeps the page of the kept file it is printed on.
 *
 * The reader names a page within the document it was sent. A chunk of a long
 * PDF starts again at 1, so the gateway adds the chunk's first page, and a
 * page outside the chunk is null rather than a jump to the wrong page.
 */
import { MAX_PRINTED_PAGE, ScanParserService, WINE_EXTRACTION_PROMPT, placeOnPage } from "./scan-parser.service";

function readerReplying(...replies: unknown[][]) {
  const call = jest.fn();
  for (const r of replies) call.mockResolvedValueOnce({ content: [{ text: JSON.stringify(r) }], stop_reason: "end_turn" });
  const s: any = new ScanParserService({ get: () => "fixture-key" } as any, { call } as any, { record: jest.fn() } as any);
  return { s, call };
}

describe("a menu line keeps its printed page", () => {
  it("asks the reader for each line's page within the document sent", () => {
    expect(WINE_EXTRACTION_PROMPT).toContain("bottle_price, page }");
    expect(WINE_EXTRACTION_PROMPT).toContain("page is the 1-based page of this document the line is printed on");
  });

  it("chunk 2 covering pages 7-12 turns a model page 3 into printed page 9, and a page 9 inside a 6-page chunk into null", async () => {
    const { s } = readerReplying(
      [{ name: "Opus One", page: 2 }],
      [{ name: "Rakı", page: 3 }, { name: "Ayran", page: 9 }],
    );
    const items = await s.parseChunks(["c1", "c2"], "house", 0, false, [], [
      { first: 1, last: 6 },
      { first: 7, last: 12 },
    ]);
    expect(items.map((i: any) => [i.name, i.printed_page ?? null])).toEqual([
      ["Opus One", 2],
      ["Rakı", 9],
      ["Ayran", null],
    ]);
    expect(items.every((i: any) => !("page" in i))).toBe(true);
  });

  it("a chunk whose range was not kept places nothing", async () => {
    const { s } = readerReplying([{ name: "Rakı", page: 3 }]);
    const items = await s.parseChunks(["c1"], "house", 0, false, [], []);
    expect(items[0]).not.toHaveProperty("printed_page");
  });

  it("one read of a whole PDF keeps the page; a photo, a non-whole or a too-high page has none", () => {
    expect(placeOnPage([{ name: "a", page: 4 }], "document")[0].printed_page).toBe(4);
    expect(placeOnPage([{ name: "a", page: 4 }], null)[0].printed_page ?? null).toBeNull();
    expect(placeOnPage([{ name: "a", page: 2.5 }], "document")[0].printed_page ?? null).toBeNull();
    expect(placeOnPage([{ name: "a", page: 0 }], "document")[0].printed_page ?? null).toBeNull();
    expect(placeOnPage([{ name: "a", page: MAX_PRINTED_PAGE + 1 }], "document")[0].printed_page ?? null).toBeNull();
    expect(placeOnPage([{ name: "a" }], { first: 7, last: 12 })[0].printed_page ?? null).toBeNull();
  });
});
