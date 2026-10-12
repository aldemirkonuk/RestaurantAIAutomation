import { STOCK_OUT_CHOICES, soldOutChip, soldOutLine, type StockOutState } from "../soldOut";

/** F-145 (S195): a drink can be 86'd from the phone, and the phone says so. */
describe("sold out (86) on the phone", () => {
  const open: StockOutState = {
    open: {
      id: "so-1",
      cause: "broken",
      note: "case dropped",
      startedAt: "2026-08-28T17:30:00Z",
      startedBy: "u",
      endedAt: null,
      endedBy: null,
    },
    recent: [],
  };

  it("offers the four reasons the gateway takes", () => {
    expect(STOCK_OUT_CHOICES.map((c) => c.cause)).toEqual(["ran_out", "broken", "pulled", "other"]);
  });

  it("says when and why a wine is sold out, on the house's clock", () => {
    const line = soldOutLine(open, false, "en-GB", "Europe/Istanbul");
    expect(line).toMatch(/^Sold out since 28\/08 20:30, broken \(case dropped\)\./);
    expect(line).toContain("a delivery is booked in");
  });

  it("says a wine that is not sold out is available", () => {
    expect(soldOutLine({ open: null, recent: [] }, false)).toMatch(/^Available\./);
  });

  it("never reads a failed read as available", () => {
    expect(soldOutLine(undefined, true)).toMatch(/could not be read/);
    expect(soldOutLine(undefined, true)).not.toMatch(/Available/);
  });

  it("F-1434: says a broken bottle is still on stock", () => {
    expect(soldOutLine(open, false)).toContain("does not take the broken bottle off stock");
    const ranOut: StockOutState = { open: { ...open.open!, cause: "ran_out" }, recent: [] };
    expect(soldOutLine(ranOut, false)).not.toContain("broken bottle");
  });
});

/** F-1434: the cellar list says which rows are 86'd, spirits and beer too. */
describe("sold out (86) on the cellar list", () => {
  it("marks a row with an open 86", () => {
    expect(soldOutChip({ soldOut: { cause: "ran_out", startedAt: "2026-10-10T21:00:00Z" } })).toBe(
      "sold out (86)",
    );
  });

  it("says nothing for a row that is not sold out", () => {
    expect(soldOutChip({ soldOut: null, soldOutReadable: true })).toBeNull();
  });

  it("says the read failed instead of showing the row available", () => {
    expect(soldOutChip({ soldOut: null, soldOutReadable: false })).toBe("sold out? not read");
  });
});
