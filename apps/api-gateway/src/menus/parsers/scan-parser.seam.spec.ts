/**
 * r36 menu audit N8: when a long PDF is read in parts, the join dropped real
 * lines. It compared every line with every other on producer|name|vintage
 * folded to a-z0-9, so a Cyrillic, Greek or Arabic name folded to nothing (and
 * every such line after the first was dropped), and a dish or "House Red"
 * printed again pages later was dropped too. Now only the same printed line
 * read twice at a page break is dropped.
 */
import { ScanParserService, dropSeamRepeats, SEAM_WINDOW } from "./scan-parser.service";
import type { WineExtractItem } from "../wine-extract-item.interface";

const line = (name: string, more: Partial<WineExtractItem> = {}): WineExtractItem => ({ name, ...more });
const names = (items: WineExtractItem[]) => items.map((i) => i.name);

describe("dropSeamRepeats: only the same line read twice at a page break is dropped", () => {
  it("drops a line the next part reads again at its start", () => {
    const x = line("Merlot", { producer: "Duckhorn", vintage: "2019", category: "red", bottle_price: 120 });
    const out = dropSeamRepeats([[line("A"), line("B"), x], [{ ...x }, line("C")]]);
    expect(names(out)).toEqual(["A", "B", "Merlot", "C"]);
  });

  it("matches across case, accents and punctuation", () => {
    const out = dropSeamRepeats([
      [line("Côtes du Rhône", { producer: "E. Guigal", bottle_price: 40 })],
      [line("cotes du rhone", { producer: "E Guigal", bottle_price: 40 })],
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps Cyrillic, Greek and Arabic names: they are different lines", () => {
    const out = dropSeamRepeats([
      [line("Водка Белуга", { bottle_price: 90 }), line("Ούζο Πλωμαρίου", { bottle_price: 30 })],
      [line("Водка Царская", { bottle_price: 80 }), line("عرق", { bottle_price: 25 }), line("Ούζο Μίνι", { bottle_price: 20 })],
    ]);
    expect(out).toHaveLength(5);
  });

  it("still drops a Cyrillic line read twice at the seam", () => {
    const out = dropSeamRepeats([[line("Водка Белуга", { bottle_price: 90 })], [line("водка белуга", { bottle_price: 90 })]]);
    expect(out).toHaveLength(1);
  });

  it("keeps the same name at another price, or under another kind", () => {
    const out = dropSeamRepeats([
      [line("House Red", { category: "red", by_glass_price: 9 })],
      [line("House Red", { category: "red", bottle_price: 36 }), line("Efes", { category: "beer", bottle_price: 5 })],
      [line("Efes", { category: "food", bottle_price: 5 })],
    ]);
    expect(out).toHaveLength(4);
  });

  it("keeps a line printed again away from the seam, and a repeat within one part", () => {
    const x = line("Salad", { category: "food", bottle_price: 9 });
    const far = dropSeamRepeats([
      [{ ...x }, line("A"), line("B"), line("C")],
      [line("D"), line("E"), line("F"), { ...x }],
    ]);
    expect(names(far)).toEqual(["Salad", "A", "B", "C", "D", "E", "F", "Salad"]);
    expect(dropSeamRepeats([[{ ...x }, line("Soup"), { ...x }]])).toHaveLength(3);
  });

  it("compares only the last lines of one part with the first of the next", () => {
    const x = line("Rakı", { bottle_price: 900 });
    // x is the 4th-from-last line: past the window.
    const before = [{ ...x }, ...Array.from({ length: SEAM_WINDOW }, (_, i) => line(`T${i}`))];
    expect(dropSeamRepeats([before, [{ ...x }]])).toHaveLength(before.length + 1);
    // x is the 4th line of the next part: past the window.
    const after = [...Array.from({ length: SEAM_WINDOW }, (_, i) => line(`H${i}`)), { ...x }];
    expect(dropSeamRepeats([[{ ...x }], after])).toHaveLength(after.length + 1);
    // x is the last line before and the 3rd line after: inside the window.
    expect(dropSeamRepeats([[{ ...x }], [line("H0"), line("H1"), { ...x }]])).toHaveLength(3);
  });

  it("an empty or failed part ends the seam", () => {
    const x = line("Merlot", { bottle_price: 120 });
    expect(dropSeamRepeats([[{ ...x }], [], [{ ...x }]])).toHaveLength(2);
  });

  it("never takes a line whose name has no letter or digit for a repeat", () => {
    expect(dropSeamRepeats([[line("—", { bottle_price: 5 })], [line("—", { bottle_price: 5 })]])).toHaveLength(2);
  });
});

describe("a split PDF is joined with the seam rule", () => {
  function reader(replies: WineExtractItem[][]) {
    const s: any = new ScanParserService({ get: () => "fixture-key" } as any, { call: jest.fn() } as any, { record: jest.fn() } as any);
    let n = 0;
    s.parseOne = jest.fn(async () => ({ items: replies[n++] ?? [], truncated: false, unreadable: false }));
    return s;
  }

  it("keeps two parts' Greek lines and drops the one read twice at the break", async () => {
    const s = reader([
      [line("Ούζο Πλωμαρίου", { bottle_price: 30 }), line("Τσίπουρο", { bottle_price: 28 })],
      [line("Τσίπουρο", { bottle_price: 28 }), line("Ούζο Μίνι", { bottle_price: 20 })],
    ]);
    const out = await s.parseChunks(["c1", "c2"], "house");
    expect(names(out)).toEqual(["Ούζο Πλωμαρίου", "Τσίπουρο", "Ούζο Μίνι"]);
  });

  it("a failed part between two others ends the seam", async () => {
    const s: any = new ScanParserService({ get: () => "fixture-key" } as any, { call: jest.fn() } as any, { record: jest.fn() } as any);
    const x = line("Merlot", { bottle_price: 120 });
    let n = 0;
    s.parseOne = jest.fn(async () => {
      n += 1;
      if (n === 2) throw new Error("chunk 2 errored");
      return { items: [{ ...x }], truncated: false, unreadable: false };
    });
    const warnings: unknown[] = [];
    const out = await s.parseChunks(["c1", "c2", "c3"], "house", 0, false, warnings);
    expect(out).toHaveLength(2);
    expect(warnings).toEqual([{ kind: "chunk_failed", pages: null }]);
  });
});
