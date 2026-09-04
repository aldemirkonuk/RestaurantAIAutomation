import {
  composeBook,
  composeRowRecord,
  emptyBook,
  fold,
  matchLine,
  unreadableBook,
  type LedgerEntry,
} from "./row-record";

const line = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  at: "2026-08-24T17:33:23.726Z",
  label: "Pinot Noir (glass)",
  who: null,
  qty: 2,
  unitPrice: 21,
  total: 42,
  note: null,
  matchedBy: "exact",
  ...over,
});

describe("matchLine — the stated, weaker rule", () => {
  it("matches the same words regardless of case and spacing", () => {
    expect(matchLine("Pinot  Noir (glass)", "pinot noir (glass)")).toBe(
      "exact",
    );
  });

  it("matches a row's label inside a longer till line, and says it was loose", () => {
    expect(matchLine("Lagunitas IPA", "LAGUNITAS IPA 6/12OZ NR")).toBe(
      "contains",
    );
  });

  it("refuses containment below four characters, so a short label cannot eat the till", () => {
    // "IPA" inside "Sipapu Red" is the failure mode the floor exists for.
    expect(matchLine("IPA", "Sipapu Red")).toBeNull();
    expect(matchLine("IPA", "IPA")).toBe("exact");
  });

  it("never matches an empty label in either direction", () => {
    expect(matchLine("", "anything")).toBeNull();
    expect(matchLine("anything", null)).toBeNull();
    expect(matchLine("anything", "   ")).toBeNull();
  });

  it("folds whitespace but does not strip punctuation — the rule is stated, not clever", () => {
    expect(fold("  A   B ")).toBe("a b");
    expect(matchLine("Kir-Yianni", "Kir Yianni")).toBeNull();
  });
});

describe("composeBook — a series is made only from dated, valued lines", () => {
  it("splits price and quantity into their own series, each time-ordered", () => {
    const b = composeBook({
      book: "pos",
      source: "pos_unresolved_lines",
      ledger: [
        line({ at: "2026-08-24T18:00:00.000Z", qty: 1, unitPrice: 22 }),
        line({ at: "2026-08-24T17:00:00.000Z", qty: 3, unitPrice: 21 }),
      ],
      emptyReason: "unused",
    });
    expect(b.price.map((p) => p.value)).toEqual([21, 22]);
    expect(b.quantity.map((p) => p.value)).toEqual([3, 1]);
    expect(b.price.every((p) => p.unit === "money")).toBe(true);
    expect(b.quantity.every((p) => p.unit === "count")).toBe(true);
  });

  it("keeps a dateless line in the ledger and refuses to give it an instant", () => {
    const b = composeBook({
      book: "invoice",
      source: "procurement_document_lines",
      ledger: [line({ at: null })],
      emptyReason: "unused",
    });
    expect(b.ledger).toHaveLength(1);
    expect(b.price).toHaveLength(0);
    expect(b.quantity).toHaveLength(0);
  });

  it("reads the ledger newest first, with undated lines last", () => {
    const b = composeBook({
      book: "invoice",
      source: "procurement_document_lines",
      ledger: [
        line({ at: null, label: "undated" }),
        line({ at: "2026-01-01T00:00:00.000Z", label: "older" }),
        line({ at: "2026-06-01T00:00:00.000Z", label: "newer" }),
      ],
      emptyReason: "unused",
    });
    expect(b.ledger.map((e) => e.label)).toEqual(["newer", "older", "undated"]);
  });

  it("an empty book is READ and says why, and is not the same shape as an unread one", () => {
    const empty = composeBook({
      book: "quote",
      source: "vendor_price_observations",
      ledger: [],
      emptyReason: "No vendor has quoted this to this house.",
    });
    expect(empty.readable).toBe(true);
    expect(empty.rows).toBe(0);
    expect(empty.reason).toMatch(/No vendor has quoted/);

    const unread = unreadableBook(
      "quote",
      "vendor_price_observations",
      "relation is missing",
    );
    expect(unread.readable).toBe(false);
    // The difference that matters: rows is NULL, never 0. A zero would let a
    // surface print "0 quotes" about a book nobody could open.
    expect(unread.rows).toBeNull();
  });
});

describe("composeRowRecord — which books named it, and the one sentence about none", () => {
  it("names only the books that were read AND carried a line", () => {
    const rec = composeRowRecord({
      restaurantId: "r1",
      label: "Pinot Noir (glass)",
      books: [
        emptyBook("menu", "menu_items", "not listed"),
        unreadableBook("invoice", "procurement_document_lines", "missing"),
        composeBook({
          book: "pos",
          source: "pos_unresolved_lines",
          ledger: [line()],
          emptyReason: "unused",
        }),
      ],
    });
    expect(rec.named).toEqual(["pos"]);
  });

  it("refuses 'nothing names it' while any book is unread", () => {
    const rec = composeRowRecord({
      restaurantId: "r1",
      label: "Rakı",
      books: [
        emptyBook("menu", "menu_items", "not listed"),
        unreadableBook("pos", "pos_unresolved_lines", "missing"),
      ],
    });
    expect(rec.named).toEqual([]);
    // The absence-reported-as-health guard: an unread book is not evidence.
    expect(rec.nothingNamesIt).toBe(false);
  });

  it("claims 'nothing names it' only when every book was readable and empty", () => {
    const rec = composeRowRecord({
      restaurantId: "r1",
      label: "Rakı",
      books: [
        emptyBook("menu", "menu_items", "not listed"),
        emptyBook("pos", "pos_unresolved_lines", "never rung up"),
      ],
    });
    expect(rec.nothingNamesIt).toBe(true);
  });

  it("carries the match rule in words on every response", () => {
    const rec = composeRowRecord({ restaurantId: "r1", label: "x", books: [] });
    expect(rec.matchRule).toMatch(/weaker rule/);
    expect(rec.matchRule).toMatch(/beverage_house_key/);
  });
});
