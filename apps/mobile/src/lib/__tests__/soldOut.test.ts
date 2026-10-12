import { STOCK_OUT_CHOICES, soldOutLine, type StockOutState } from "../soldOut";

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
});
