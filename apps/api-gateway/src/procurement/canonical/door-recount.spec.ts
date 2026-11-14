import { sameItem, supersededCountLines, type CountDoc, type CountLine } from "./door-recount";

/**
 * r33 w2 F5: a recount supersedes the earlier count, item by item, so the
 * first count's old difference stops blocking AGREED. All ids SYNTHETIC.
 */

const line = (over: Partial<CountLine> & { id: string; document_id: string }): CountLine => ({
  inventory_id: null,
  vendor_sku: null,
  description: null,
  ...over,
});

const doc = (id: string, created_at: string | null, countedAt?: string | null): CountDoc => ({
  id,
  created_at,
  extracted: countedAt === undefined ? {} : { countedAt },
});

describe("supersededCountLines", () => {
  it("one count supersedes nothing", () => {
    expect(
      supersededCountLines(
        [doc("c1", "2026-11-13T10:00:00Z")],
        [line({ id: "l1", document_id: "c1", inventory_id: "inv-1" })],
      ),
    ).toEqual(new Set());
  });

  it("a recount of the same item supersedes the first count's line", () => {
    const gone = supersededCountLines(
      [doc("c1", "2026-11-13T10:00:00Z"), doc("c2", "2026-11-13T11:00:00Z")],
      [
        line({ id: "first", document_id: "c1", inventory_id: "inv-1" }),
        line({ id: "recount", document_id: "c2", inventory_id: "inv-1" }),
      ],
    );
    expect([...gone]).toEqual(["first"]);
  });

  it("the order the documents are listed in does not matter; the clock does", () => {
    const gone = supersededCountLines(
      [doc("c2", "2026-11-13T11:00:00Z"), doc("c1", "2026-11-13T10:00:00Z")],
      [
        line({ id: "recount", document_id: "c2", inventory_id: "inv-1" }),
        line({ id: "first", document_id: "c1", inventory_id: "inv-1" }),
      ],
    );
    expect([...gone]).toEqual(["first"]);
  });

  it("when the count says it was counted wins over when it was recorded", () => {
    // Recorded later, but counted earlier (an offline count sent late): the
    // count made at 11:00 is the door's word, as the paper page reads it.
    const gone = supersededCountLines(
      [doc("late-sent", "2026-11-13T12:00:00Z", "2026-11-13T09:00:00Z"), doc("c2", "2026-11-13T11:00:00Z")],
      [
        line({ id: "old", document_id: "late-sent", inventory_id: "inv-1" }),
        line({ id: "new", document_id: "c2", inventory_id: "inv-1" }),
      ],
    );
    expect([...gone]).toEqual(["old"]);
  });

  it("an item only the first count names stays counted (a recount of one wine)", () => {
    const gone = supersededCountLines(
      [doc("c1", "2026-11-13T10:00:00Z"), doc("c2", "2026-11-13T11:00:00Z")],
      [
        line({ id: "raki-1", document_id: "c1", inventory_id: "raki" }),
        line({ id: "wine-1", document_id: "c1", inventory_id: "wine" }),
        line({ id: "raki-2", document_id: "c2", inventory_id: "raki" }),
      ],
    );
    expect([...gone]).toEqual(["raki-1"]);
  });

  it("two lines of one item in ONE count add up; neither supersedes the other", () => {
    const gone = supersededCountLines(
      [doc("c1", "2026-11-13T10:00:00Z"), doc("c2", "2026-11-13T11:00:00Z")],
      [
        line({ id: "a", document_id: "c2", inventory_id: "cheese" }),
        line({ id: "b", document_id: "c2", inventory_id: "cheese" }),
        line({ id: "old", document_id: "c1", inventory_id: "cheese" }),
      ],
    );
    expect([...gone]).toEqual(["old"]);
  });

  it("three counts: only the newest stands", () => {
    const gone = supersededCountLines(
      [doc("c1", "2026-11-13T10:00:00Z"), doc("c3", "2026-11-13T12:00:00Z"), doc("c2", "2026-11-13T11:00:00Z")],
      [
        line({ id: "l1", document_id: "c1", vendor_sku: "R-70" }),
        line({ id: "l2", document_id: "c2", vendor_sku: "R-70" }),
        line({ id: "l3", document_id: "c3", vendor_sku: "R-70" }),
      ],
    );
    expect([...gone].sort()).toEqual(["l1", "l2"]);
  });
});

describe("sameItem — the strongest identity both lines carry decides", () => {
  it("two different linked goods are different, whatever their descriptions say", () => {
    expect(
      sameItem(
        line({ id: "a", document_id: "c1", inventory_id: "inv-1", description: "Rioja" }),
        line({ id: "b", document_id: "c2", inventory_id: "inv-2", description: "Rioja" }),
      ),
    ).toBe(false);
  });

  it("falls back to the vendor code, then the description folded for case and spaces (Turkish İ)", () => {
    expect(
      sameItem(
        line({ id: "a", document_id: "c1", vendor_sku: " r-70 " }),
        line({ id: "b", document_id: "c2", vendor_sku: "R-70", inventory_id: "inv-1" }),
      ),
    ).toBe(true);
    expect(
      sameItem(
        line({ id: "a", document_id: "c1", description: "YENİ  RAKI 70cl" }),
        line({ id: "b", document_id: "c2", description: "yeni rakı 70cl" }),
      ),
    ).toBe(true);
    expect(
      sameItem(
        line({ id: "a", document_id: "c1", vendor_sku: "R-70", description: "Raki" }),
        line({ id: "b", document_id: "c2", vendor_sku: "R-35", description: "Raki" }),
      ),
    ).toBe(false);
  });

  it("a line with nothing to know it by is never the same as another", () => {
    expect(sameItem(line({ id: "a", document_id: "c1" }), line({ id: "b", document_id: "c2" }))).toBe(false);
  });
});
