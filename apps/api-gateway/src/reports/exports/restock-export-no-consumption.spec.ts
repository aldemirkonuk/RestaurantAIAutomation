import { EXPORT_CUTTINGS } from "./report-export-cuttings";

/**
 * r40 (r36 reports gap 5, house slice): with no consumption line in the
 * window no good has a demand, so "nothing is below its reorder point" is not
 * an answer. The export says what the page says.
 */
const BASE = {
  params: { serviceLevel: 0.95, leadTimeDays: 7, demandWindowDays: 90 },
  skuCount: 3,
  reorderCount: 0,
  reorderList: [],
};
const say = (payload: object) =>
  EXPORT_CUTTINGS.restock.write(payload, { days: null }).say;

describe("the restock export with no consumption line", () => {
  it("says no demand was recorded, not that nothing is below its point", () => {
    expect(say({ ...BASE, unitsCoverage: { lines: 0 } })).toBe(
      "No consumption line was recorded in the last 90 days, so no wine has a demand to set a reorder point from, and nothing here can say what will run out.",
    );
  });

  it("wins over a list of zero-stock wines at a reorder point of 0", () => {
    expect(
      say({
        ...BASE,
        reorderCount: 1,
        reorderList: [{ name: "A", onHand: 0, reorderPoint: 0, stockoutProbability: 0 }],
        unitsCoverage: { lines: 0 },
      }),
    ).toMatch(/^No consumption line/);
  });

  it("keeps the real answer when lines were read, or when the count is not sent", () => {
    const real = "Nothing is below its reorder point. That is a real answer about 3 wines, not an empty register.";
    expect(say({ ...BASE, unitsCoverage: { lines: 4 } })).toBe(real);
    expect(say({ ...BASE })).toBe(real);
  });
});
