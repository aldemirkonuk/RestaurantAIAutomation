import { readFileSync } from "fs";
import { join } from "path";
import { CUTTING_CATALOGUE, CUTTING_IDS } from "../../analytics/report-cuttings";
import { isWithheld, type ExportDoc } from "./report-export-doc";
import {
  EXPORTABLE_CUTTINGS,
  EXPORT_CUTTINGS,
  countWithheld,
  isExportableCutting,
} from "./report-export-cuttings";
import { PAYLOADS } from "./__fixtures__/cutting-payloads";

/**
 * OD-81 — every cutting an export can write, pinned to the sheet it exports.
 *
 * Two drifts this file exists to fail:
 *  1. a cutting added to the /reports sheet and not here (or the reverse), so
 *     the page offers an export the gateway refuses;
 *  2. a figure the engine returned as null written as a number.
 */

const WEB_REGISTERS = join(
  __dirname,
  "../../../../web/src/pages/reports/next",
);
const webSource = [
  "rp-registers-trade.tsx",
  "rp-registers-house.tsx",
  "rp-registers-bench.tsx",
  "rp-registers-goals.tsx",
]
  .map((f) => readFileSync(join(WEB_REGISTERS, f), "utf8"))
  .join("\n");

function figure(doc: ExportDoc, label: string) {
  const f = doc.figures.find((x) => x.label === label);
  if (!f) throw new Error(`no figure "${label}" in ${JSON.stringify(doc.figures.map((x) => x.label))}`);
  return f.value;
}

/** The page's own id list, `rp-sheet.ts` ANALYSIS_IDS, read from its source. */
function webAnalysisIds(): string[] {
  const src = readFileSync(join(WEB_REGISTERS, "rp-sheet.ts"), "utf8");
  const block = /export const ANALYSIS_IDS = \[([^\]]*)\]/.exec(src);
  if (!block) throw new Error("rp-sheet.ts no longer declares ANALYSIS_IDS as a literal list");
  return Array.from(block[1].matchAll(/'([a-z_]+)'/g), (m) => m[1]);
}

describe("the exportable cuttings (OD-81)", () => {
  it("are exactly the sheet's analyses, less the writing desk that reads no register", () => {
    const web = webAnalysisIds();
    expect(web.length).toBeGreaterThan(10);
    expect([...EXPORTABLE_CUTTINGS].sort()).toEqual(web.filter((id) => id !== "writing").sort());
    expect(isExportableCutting("writing")).toBe(false);
    expect(isExportableCutting("ledger")).toBe(true);
    expect(isExportableCutting(null)).toBe(false);
  });

  it("agree with the gateway's cutting catalogue (every id it knows is exportable) and on which one takes a window", () => {
    for (const id of CUTTING_IDS) {
      expect([id, isExportableCutting(id)]).toEqual([id, true]);
      expect([id, EXPORT_CUTTINGS[id as keyof typeof EXPORT_CUTTINGS].takesWindow]).toEqual([
        id,
        CUTTING_CATALOGUE[id].takesWindow === true,
      ]);
    }
    // The page says the same: exactly one register takes a window.
    expect(webSource.match(/takesWindow: true/g)).toHaveLength(1);
    expect(EXPORTABLE_CUTTINGS.filter((id) => EXPORT_CUTTINGS[id].takesWindow)).toEqual(["till"]);
  });

  it("carry the page's own title and window line, verbatim", () => {
    for (const id of EXPORTABLE_CUTTINGS) {
      const spec = EXPORT_CUTTINGS[id];
      expect([id, webSource.includes(`title: '${spec.title}'`)]).toEqual([id, true]);
      if (!spec.takesWindow)
        expect([id, webSource.includes(`window: () => '${spec.window(null)}'`)]).toEqual([id, true]);
    }
    // The till's window is the one the reader picked.
    expect(webSource).toContain("window: (ctx) => `the last ${ctx.days} days of POS checks`");
    expect(EXPORT_CUTTINGS.till.window(7)).toBe("the last 7 days of POS checks");
  });

  it("write every fixture payload without throwing", () => {
    for (const id of EXPORTABLE_CUTTINGS) {
      const doc = EXPORT_CUTTINGS[id].write(PAYLOADS[id], { days: id === "till" ? 30 : null });
      expect(doc.figures.length + doc.tables.length + (doc.say ? 1 : 0)).toBeGreaterThan(0);
    }
  });
});

describe("a figure the engine did not compute is written as withheld, never as 0 (OD-81)", () => {
  it("figures of record: no delivered order and an incomplete cost basis withhold COGS and every cost-derived figure", () => {
    const doc = EXPORT_CUTTINGS.ledger.write(PAYLOADS.ledger, { days: null });
    for (const label of [
      "Cellar at cost",
      "Cost of goods (365d)",
      "Gross margin",
      "COGS ratio",
      "Inventory turns",
      "Days of inventory",
      "GMROI",
      "Capital sitting still",
    ])
      expect([label, isWithheld(figure(doc, label))]).toEqual([label, true]);
    expect(figure(doc, "Sell-price valuation")).toBe(5400);
    expect(doc.notes.join(" ")).toContain("1 of 2 on-hand wines carry a recorded cost");
    expect(countWithheld(doc)).toBe(8);
  });

  it("what's coming: an unfitted model projects nothing and claims no total", () => {
    const doc = EXPORT_CUTTINGS.ahead.write(PAYLOADS.ahead, { days: null });
    expect(isWithheld(figure(doc, "Next 14 days"))).toBe(true);
    expect(isWithheld(figure(doc, "Model"))).toBe(true);
    expect(doc.tables).toEqual([]);
    expect(doc.say).toContain("no model fitted this history");
  });

  it("through the till: a house with no POS feed has no takings, not takings of zero", () => {
    const doc = EXPORT_CUTTINGS.till.write({ posConnected: false, revenue: null, checkCount: null, from: "2026-08-19", to: "2026-09-17" }, { days: 30 });
    for (const label of ["Taken", "Checks", "Average check"])
      expect([label, isWithheld(figure(doc, label))]).toEqual([label, true]);
  });

  it("through the till: a connected till that took nothing is a measured zero, and the average of no checks is withheld", () => {
    const doc = EXPORT_CUTTINGS.till.write({ posConnected: true, revenue: 0, checkCount: 0, from: "2026-09-10", to: "2026-09-17", days: 7, dailySeries: [] }, { days: 7 });
    expect(figure(doc, "Taken")).toBe(0);
    expect(figure(doc, "Checks")).toBe(0);
    expect(isWithheld(figure(doc, "Average check"))).toBe(true);
  });

  it("through the till: the average is the page's own revenue ÷ checks", () => {
    const doc = EXPORT_CUTTINGS.till.write(PAYLOADS.till, { days: 30 });
    expect(figure(doc, "Average check")).toBeCloseTo(4210.5 / 96, 10);
    expect(doc.tables[0].note).toBe("2 of the 30 days in the window rang up a check; the rest are absent rather than zero.");
  });

  it("the week's shape: a tie names no busiest day, and an unseen weekday has no mean", () => {
    const doc = EXPORT_CUTTINGS.week.write(PAYLOADS.week, { days: null });
    expect(isWithheld(figure(doc, "Busiest day"))).toBe(true);
    expect(isWithheld(figure(doc, "Quietest day"))).toBe(true);
    const tuesday = doc.tables[0].rows.find((r) => r[0] === "Tuesday")!;
    expect(isWithheld(tuesday[1])).toBe(true);
    expect(tuesday[3]).toBe(0);
  });

  it("margin against movement: an uncosted wine is unknown, not a dog", () => {
    const doc = EXPORT_CUTTINGS.quadrants.write(PAYLOADS.quadrants, { days: null });
    const uncosted = doc.tables[0].rows[1];
    expect(isWithheld(uncosted[2])).toBe(true);
    expect(isWithheld(uncosted[4])).toBe(true);
    // A count the register did not return for a quadrant it did return counts
    // for is a zero, stated by the register's own `counts` object.
    expect(figure(doc, "Dogs")).toBe(0);
  });

  it("margin against movement: a register with no counts object withholds the counts rather than printing zeros", () => {
    const doc = EXPORT_CUTTINGS.quadrants.write({ ...(PAYLOADS.quadrants as object), counts: null }, { days: null });
    for (const label of ["Stars", "Plowhorses", "Puzzles", "Dogs"])
      expect([label, isWithheld(figure(doc, label))]).toEqual([label, true]);
  });

  it("goals: a goal that could not be read is withheld with its reason", () => {
    const doc = EXPORT_CUTTINGS.goals.write(PAYLOADS.goals, { days: null });
    const broken = doc.tables[0].rows[1];
    expect(isWithheld(broken[2])).toBe(true);
    expect((broken[2] as { why: string }).why).toBe("this goal could not be read: metric query failed");
    expect(figure(doc, "Could not be scored")).toBe(1);
  });

  it("against ourselves: a lens that did not answer inside the overview is withheld by name", () => {
    const doc = EXPORT_CUTTINGS.bench.write(PAYLOADS.bench, { days: null });
    const week = figure(doc, "The week's trend");
    expect(isWithheld(week)).toBe(true);
    expect((week as { why: string }).why).toBe("the weekday lens did not answer inside the overview call");
    expect(figure(doc, "Bought, the last 30 days")).toBe(1200);
  });

  it("the room and who served it: a table with no attributed check has no average, and a missing tip is not 0%", () => {
    const seats = EXPORT_CUTTINGS.seats.write(PAYLOADS.seats, { days: null });
    expect(isWithheld(seats.tables[0].rows[1][5])).toBe(true);
    const service = EXPORT_CUTTINGS.service.write(PAYLOADS.service, { days: null });
    expect(isWithheld(service.tables[0].rows[0][5])).toBe(true);
    expect(isWithheld(figure(service, "Table-adjusted fit (R²)"))).toBe(true);
  });

  it("what to buy back: a wine with no measured demand has no cover and no risk", () => {
    const doc = EXPORT_CUTTINGS.restock.write(PAYLOADS.restock, { days: null });
    const chablis = doc.tables[0].rows[1];
    expect(chablis[0]).toBe("Chablis");
    for (const i of [2, 3, 4, 5]) expect([i, isWithheld(chablis[i])]).toEqual([i, true]);
    expect(doc.tables[0].note).toContain("3 wines are below their reorder point");
  });

  it("an empty payload writes no invented money in any cutting", () => {
    for (const id of EXPORTABLE_CUTTINGS) {
      const doc = EXPORT_CUTTINGS[id].write({}, { days: id === "till" ? 30 : null });
      for (const f of doc.figures)
        if (f.unit === "money")
          expect([id, f.label, f.value]).toEqual([id, f.label, expect.objectContaining({ withheld: true })]);
    }
  });
});
