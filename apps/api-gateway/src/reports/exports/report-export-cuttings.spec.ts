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
  it("figures of record: a cost gap and an incomplete cost basis withhold what it cost and every cost-derived figure", () => {
    const doc = EXPORT_CUTTINGS.ledger.write(PAYLOADS.ledger, { days: null });
    for (const label of [
      "What it cost (365d)",
      "Kept",
      "Kept, of sales",
      "Cost of sales",
      "Cellar at cost",
      "Inventory turns",
      "Days of inventory",
      "GMROI",
      "Bought (365d)",
      "Capital sitting still",
    ])
      expect([label, isWithheld(figure(doc, label))]).toEqual([label, true]);
    // Cost-math lane 3.1: sales are the till's, net; the shelf valuation is
    // no longer printed as if it were sales.
    expect(figure(doc, "Sold, net (365d)")).toBe(5400);
    expect(doc.figures.map((x) => x.label)).not.toContain("Sell-price valuation");
    expect(doc.notes.join(" ")).toContain("Cost known for 2 of 3 items sold; 4 bottles");
    expect(doc.notes.join(" ")).toContain("1 of 2 on-hand goods carry a recorded cost");
    expect(countWithheld(doc)).toBe(10);
    // Batch review 2026-11-11: the cellar note names only the figures that
    // wait on the cellar; the costed part and the late prices on earlier
    // sales are said apart and divide into nothing.
    const notes = doc.notes.join(" ");
    expect(notes).not.toContain("every cost-derived figure");
    expect(notes).toContain("so the cellar at cost is withheld rather than");
    expect(notes).not.toContain("inventory turns, days of inventory and GMROI are withheld");
    expect(notes).toContain("The 2 of 3 items sold whose every bottle carries its cost came to 310.50 at cost. That is not the cost of everything sold");
    expect(notes).toContain("7.25 of late prices was settled in this window on bottles sold before it. It is not in what it cost");
  });

  it("figures of record: mapped goods that sold nothing are named, and counted (fix round 2026-11-12)", () => {
    const tillStock = { value: 1000, goodsOnHand: 4, goodsOnTill: 3, uncostedOnTill: 0, idleOnTill: 2, idleOnTillValue: 400, goodsOffTill: 1, offTillValue: 50 };
    const notes = EXPORT_CUTTINGS.ledger.write({ ...(PAYLOADS.ledger as object), tillStock }, { days: null }).notes.join(" ");
    expect(notes).toContain("2 of the 3 goods on hand the till sells sold nothing in this window (400.00 at cost). They are counted");
    const none = EXPORT_CUTTINGS.ledger.write({ ...(PAYLOADS.ledger as object), tillStock: { ...tillStock, idleOnTill: 0, idleOnTillValue: 0 } }, { days: null });
    expect(none.notes.join(" ")).not.toContain("sold nothing in this window");
  });

  it("figures of record: a caller without sales sees the till's figures withheld by name", () => {
    const doc = EXPORT_CUTTINGS.ledger.write({ ...(PAYLOADS.ledger as object), salesWithheld: true, revenue: null }, { days: null });
    expect(isWithheld(figure(doc, "Sold, net (365d)"))).toBe(true);
    expect(JSON.stringify(figure(doc, "What it cost (365d)"))).toContain("Owners and managers");
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

  it("against ourselves: a register that could not be read is withheld by name", () => {
    const doc = EXPORT_CUTTINGS.bench.write(PAYLOADS.bench, { days: null });
    const week = figure(doc, "Trend per day, last 28 days");
    expect(isWithheld(week)).toBe(true);
    expect((week as { why: string }).why).toBe("the seasonality register could not be read");
    expect(figure(doc, "Bought, the last 30 days")).toBe(1200);
    expect(figure(doc, "Goals running")).toBe(1);
  });

  it("against ourselves: a goals list that could not be read is not \"no goal is running\"", () => {
    const doc = EXPORT_CUTTINGS.bench.write({ ...(PAYLOADS.bench as object), goals: null }, { days: null });
    const running = figure(doc, "Goals running");
    expect(isWithheld(running)).toBe(true);
    expect((running as { why: string }).why).toBe("the goals list could not be read");
    expect(doc.notes.join(" ")).toMatch(/goals list could not be read/);
    expect(doc.notes.join(" ")).not.toMatch(/No goal is running/);
    // An empty list that WAS read is still "no goal is running".
    const none = EXPORT_CUTTINGS.bench.write({ ...(PAYLOADS.bench as object), goals: [] }, { days: null });
    expect(figure(none, "Goals running")).toBe(0);
    expect(none.notes.join(" ")).toMatch(/No goal is running/);
  });

  it("against ourselves: two zero windows are a quiet stretch, not an ambiguous zero (ADR 0292)", () => {
    const doc = EXPORT_CUTTINGS.bench.write(
      { ...(PAYLOADS.bench as object), cashflow: { spendLast30d: 0, spendPrev30d: 0, paceDeltaPct: null } },
      { days: null },
    );
    expect(doc.notes).toContain("No delivered purchase order falls in either 30-day window.");
    expect(JSON.stringify(doc)).not.toMatch(/ambiguous/);
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

/**
 * A-020 (analytics walk, 2026-10-03). The engine returns pace and trend as 0–1
 * fractions — (current − previous) ÷ |previous|, and OLS slope ÷ |mean| — and
 * the export tagged them `percent` ("already in percent") as they came, so a
 * 33% rise was written 0.33 and printed "0.3%". The fixtures are fractions now
 * (1200 against 900 is 0.3333); each figure below is that fraction × 100.
 */
describe("a signed change is written in percent, from the engine's 0–1 fraction (A-020)", () => {
  it("spend pacing: 1200 against 900 is a pace of +33.33%", () => {
    const doc = EXPORT_CUTTINGS.pacing.write(PAYLOADS.pacing, { days: null });
    const pace = doc.figures.find((x) => x.label === "Pace")!;
    expect(pace.unit).toBe("percent");
    expect(pace.value).toBeCloseTo(33.33, 6);
  });

  it("the week's shape: a -0.004 trend is -0.4% a day", () => {
    const doc = EXPORT_CUTTINGS.week.write(PAYLOADS.week, { days: null });
    const trend = doc.figures.find((x) => x.label === "28-day trend, per day")!;
    expect(trend.unit).toBe("percent");
    expect(trend.value).toBeCloseTo(-0.4, 6);
  });

  it("against ourselves: the pace figure, the pace cell and the trend cell are all in percent", () => {
    const doc = EXPORT_CUTTINGS.bench.write(
      {
        ...(PAYLOADS.bench as object),
        seasonality: { tie: false, bestDay: "Friday", worstDay: "Monday", trendPerDayPct: 0.20689655, weekdayProfile: [] },
      },
      { days: null },
    );
    expect(figure(doc, "Pace against last month")).toBeCloseTo(33.33, 6);
    expect(figure(doc, "Trend per day, last 28 days")).toBeCloseTo(20.689655, 6);
    const [buying, week] = doc.tables[0].rows;
    expect(buying[3]).toEqual({ n: expect.closeTo(33.33, 6), unit: "percent" });
    expect(week[0]).toBe("The week's own extremes (busiest, quietest, trend per day)");
    expect(week[3]).toEqual({ n: expect.closeTo(20.689655, 6), unit: "percent" });
  });

  it("an unknown change stays withheld, never 0%", () => {
    const doc = EXPORT_CUTTINGS.pacing.write({ ...(PAYLOADS.pacing as object), paceDeltaPct: null }, { days: null });
    expect(isWithheld(figure(doc, "Pace"))).toBe(true);
  });

  it("a window withheld over an uncosted order says why, and is not 'nothing bought'", () => {
    const why =
      "Purchasing spend could not be summed: 1 of the 2 delivered orders in this window carries no recorded cost, so a total would be short rather than true. Record what that order cost to read it.";
    const doc = EXPORT_CUTTINGS.pacing.write(
      {
        ...(PAYLOADS.pacing as object),
        spendLast30d: null,
        spendPrev30d: 0,
        paceDeltaPct: null,
        projectedNext4Weeks: null,
        unread: { spendLast30d: why, spendPrev30d: null, projectedNext4Weeks: why, committedOpenOrders: null },
      },
      { days: null },
    );
    expect(isWithheld(figure(doc, "Paid out, the last 30 days"))).toBe(true);
    expect(JSON.stringify(doc)).toContain("no recorded cost");
    expect(JSON.stringify(doc)).not.toContain("No delivered purchase order falls in either 30-day window");
  });
});

/**
 * A-040 (analytics walk, 2026-10-03). The room and who served it said "an
 * absent attribution" / "an absent field on the POS feed" whenever no check in
 * the 90-day window named a table or a server — including when the window held
 * no check at all because the feed stopped. The gateway now sends
 * `checksInWindow` and `latestCheckAt`; the export says which fact it is.
 */
describe("an empty POS window is not an absent field (A-040)", () => {
  const latest = "2026-08-30T19:00:00.000Z";
  const service = (extra: Record<string, unknown>) =>
    EXPORT_CUTTINGS.service.write({ sinceDays: 90, dataStatus: "x", adjusted: null, waiters: [], ...extra }, { days: null });
  const seats = (extra: Record<string, unknown>) =>
    EXPORT_CUTTINGS.seats.write(
      {
        sinceDays: 90,
        dataStatus: "x",
        tables: [{ tableId: "t1", label: "T1", zone: null, seats: 4, checks: 0, revenue: 0, covers: 0, avgCheck: null, wineAttachRate: null }],
        ...extra,
      },
      { days: null },
    );

  it("who served it: no check in the window, older ones on record — names the window and the latest day, blames no field", () => {
    const say = service({ checksInWindow: 0, latestCheckAt: latest }).say!;
    expect(say).toBe(
      "No POS check was opened in the last 90 days — the latest this house has was opened 2026-08-30 (UTC). The window is empty; no field is missing.",
    );
  });

  it("who served it: no check ever — says none has reached Mudavym", () => {
    const say = service({ checksInWindow: 0, latestCheckAt: null }).say!;
    expect(say).toContain("No POS check has reached Mudavym for this house yet");
    expect(say).not.toContain("absent field");
  });

  it("who served it: checks in the window, none naming a server — the absent field, with the count", () => {
    expect(service({ checksInWindow: 7, latestCheckAt: latest }).say).toBe(
      "None of the 7 checks in the last 90 days carries a server name, so nothing can be attributed to anyone. That is an absent field on the POS feed, not a shift nobody worked.",
    );
    expect(service({ checksInWindow: 1, latestCheckAt: latest }).say).toMatch(
      /^The one check in the last 90 days carries no server name, .* absent field on the POS feed/,
    );
  });

  it("who served it: an older gateway that sends no count — asserts neither cause", () => {
    const say = service({}).say!;
    expect(say).toContain("does not say whether the window held any check");
    expect(say).not.toContain("absent field");
  });

  it("the room: the same three facts, and 'absent attribution' only when checks exist", () => {
    expect(seats({ checksInWindow: 0, latestCheckAt: latest }).say).toBe(
      "1 table is mapped. No POS check was opened in the last 90 days — the latest this house has was opened 2026-08-30 (UTC). The window is empty; no field is missing.",
    );
    expect(seats({ checksInWindow: 0, latestCheckAt: null }).say).toContain("No POS check has reached Mudavym");
    expect(seats({ checksInWindow: 5, latestCheckAt: latest }).say).toBe(
      "1 table is mapped, and not one of the 5 checks in the last 90 days was attributed to any of them — an absent attribution, not an empty room.",
    );
    const old = seats({}).say!;
    expect(old).toContain("does not say whether the window held any check");
    expect(old).not.toContain("absent attribution");
  });

  it("a live window with attributed checks says nothing instead of drawing", () => {
    expect(EXPORT_CUTTINGS.seats.write(PAYLOADS.seats, { days: null }).say).toBeNull();
    expect(EXPORT_CUTTINGS.service.write(PAYLOADS.service, { days: null }).say).toBeNull();
  });
});

/**
 * Audit G7/G8 (2026-11-11). Spend and weekdays are filed on the house's day
 * (ADR 0296): a house with no time zone gets no spend and no weekday shape,
 * and the sheet says why, not "no delivered order" or "no consumption".
 */
describe("a house with no time zone is said so on spend and the week (ADR 0296)", () => {
  const ZONE = /time zone/i;

  it("pacing withholds spend, keeps what is committed, and never says no order was delivered", () => {
    const doc = EXPORT_CUTTINGS.pacing.write(
      { zoneUnset: true, spendLast30d: null, spendPrev30d: null, paceDeltaPct: null, projectedNext4Weeks: null, committedOpenOrders: 300, openOrderCount: 1 },
      { days: null },
    );
    expect(doc.say).toMatch(ZONE);
    expect(isWithheld(figure(doc, "Paid out, the last 30 days"))).toBe(true);
    expect(figure(doc, "Committed, not yet delivered")).toBe(300);
    expect(JSON.stringify(doc)).not.toMatch(/No delivered purchase order|ambiguous/);
  });

  it("a real quiet month still says no order was delivered, without calling the zero ambiguous", () => {
    const doc = EXPORT_CUTTINGS.pacing.write(
      { spendLast30d: 0, spendPrev30d: 0, paceDeltaPct: null, projectedNext4Weeks: null, committedOpenOrders: 0, openOrderCount: 0, basis: { uncosted: "1 delivered order carries no cost and adds nothing to spend." } },
      { days: null },
    );
    expect(doc.say).toMatch(/No delivered purchase order/);
    expect(JSON.stringify(doc)).not.toMatch(/ambiguous/);
    expect(doc.basis).toContain("1 delivered order carries no cost and adds nothing to spend.");
  });

  it("the week says the zone is missing, not that nothing was poured", () => {
    const doc = EXPORT_CUTTINGS.week.write({ zoneUnset: true, weekdayProfile: [], bestDay: null }, { days: null });
    expect(doc.say).toMatch(ZONE);
  });
});

describe("against ourselves, for a house with no time zone (ADR 0296)", () => {
  it("withholds buying and the week's extremes with the zone as the reason", () => {
    const doc = EXPORT_CUTTINGS.bench.write(
      {
        ...(PAYLOADS.bench as object),
        cashflow: { zoneUnset: true, spendLast30d: null, spendPrev30d: null, paceDeltaPct: null },
        seasonality: { zoneUnset: true, weekdayProfile: [], bestDay: null, worstDay: null, tie: false, trendPerDayPct: null },
      },
      { days: null },
    );
    const [buying, week] = doc.tables[0].rows;
    expect(JSON.stringify(buying[1])).toMatch(/time zone/);
    expect(JSON.stringify(week[1])).toMatch(/time zone/);
  });
});
