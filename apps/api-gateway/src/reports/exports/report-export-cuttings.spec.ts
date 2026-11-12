import { readFileSync } from "fs";
import { join } from "path";
import { CUTTING_CATALOGUE, CUTTING_IDS } from "../../analytics/report-cuttings";
import { isWithheld, type ExportDoc } from "./report-export-doc";
import {
  EXPORTABLE_CUTTINGS,
  EXPORT_CUTTINGS,
  countWithheld,
  isExportableCutting,
  refundChecksSaid,
  TILL_REFUNDS_TAKEN_OFF,
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
    expect(webSource).toContain(
      "window: (ctx) => `the last ${ctx.days} days of POS checks, today so far`",
    );
    // F-1215: the window ends on the house's today, so it says today is unfinished.
    expect(EXPORT_CUTTINGS.till.window(7)).toBe(
      "the last 7 days of POS checks, today so far",
    );
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

  it("figures of record: a partly costed cellar writes the priced wines' value and the notes the screen shows (F-989)", () => {
    const doc = EXPORT_CUTTINGS.ledger.write(
      {
        ...(PAYLOADS.ledger as Record<string, unknown>),
        pricedInventoryValue: 1800,
        priceCoverage: { total: 2, priced: 1, unpriced: 1 },
        cogsUnpricedCount: 3,
      },
      { days: null },
    );
    expect(figure(doc, "Cellar at cost (priced wines)")).toBe(1800);
    const notes = doc.notes.join(" ");
    expect(notes).toContain(
      "1 of 2 on-hand wines have no cost yet, so the cellar figure above counts only the 1 that do",
    );
    expect(notes).not.toContain("assembled from part of the cellar");
    expect(notes).toContain("1 wine on hand has no bottle price");
    expect(notes).toContain("3 delivered orders carry no price");
    expect(countWithheld(doc)).toBe(7);
  });

  it("figures of record: a withheld sell-price valuation gives both causes, not only an empty read (F-989)", () => {
    const doc = EXPORT_CUTTINGS.ledger.write(
      { ...(PAYLOADS.ledger as Record<string, unknown>), revenue: null },
      { days: null },
    );
    expect(JSON.stringify(figure(doc, "Sell-price valuation"))).toContain(
      "No wine on hand carries a bottle price, or no inventory row came back",
    );
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

  it("through the till: says which refunds are taken off whenever it carries a figure (F-1644, was F-412)", () => {
    const doc = EXPORT_CUTTINGS.till.write(PAYLOADS.till, { days: 30 });
    expect(doc.notes).toContain(TILL_REFUNDS_TAKEN_OFF);
    expect(TILL_REFUNDS_TAKEN_OFF).toMatch(
      /^Refunds your till sends as a check with a minus total are taken off Taken\./,
    );
    const zero = EXPORT_CUTTINGS.till.write(
      {
        posConnected: true,
        revenue: 0,
        checkCount: 0,
        from: "2026-09-10",
        to: "2026-09-17",
        days: 7,
        dailySeries: [],
      },
      { days: 7 },
    );
    expect(zero.notes).toContain(TILL_REFUNDS_TAKEN_OFF);
    // No figure, nothing to qualify.
    const none = EXPORT_CUTTINGS.till.write(
      { posConnected: false, revenue: null, checkCount: null },
      { days: 30 },
    );
    expect(none.notes).toEqual([]);
  });

  it("through the till: the average is the page's own revenue ÷ checks", () => {
    const doc = EXPORT_CUTTINGS.till.write(PAYLOADS.till, { days: 30 });
    expect(figure(doc, "Average check")).toBeCloseTo(4210.5 / 96, 10);
    expect(doc.tables[0].note).toBe("2 of the 30 days in the window rang up a check; the rest are absent rather than zero.");
  });

  it("through the till: a refund check is taken off Taken but is no paid check in the average (F-1644)", () => {
    // 200 sales of 1,000 and 20 refunds of 1,000: Taken 180,000 over 220
    // checks. The average was 180,000 / 220 = 818; it is 1,000.
    const doc = EXPORT_CUTTINGS.till.write(
      {
        posConnected: true,
        revenue: 180_000,
        checkCount: 220,
        checksWithoutTotal: 0,
        checksTakingNoMoney: 0,
        checksRefunded: 20,
        refunded: 20_000,
        from: "2026-09-01",
        to: "2026-09-30",
        days: 30,
        dailySeries: [{ date: "2026-09-01", revenue: 180_000 }],
      },
      { days: 30 },
    );
    expect(figure(doc, "Taken")).toBe(180_000);
    expect(figure(doc, "Checks")).toBe(220);
    expect(figure(doc, "Average check")).toBe(1000);
    expect(doc.notes).toContain(refundChecksSaid(20));
    expect(refundChecksSaid(1)).toBe(
      "1 check was a refund, sent by your till with a minus total: counted in Checks, taken off Taken, left out of the average check.",
    );
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

  it("margin against movement: 'No quadrant' is the screen's count, and tax, too-new and off-menu wines have rows of their own (F-1670, F-1667)", () => {
    const doc = EXPORT_CUTTINGS.quadrants.write(
      {
        ...(PAYLOADS.quadrants as object),
        counts: {
          star: 1,
          unclassified: 2,
          unmeasured: 1,
          taxRefused: 3,
          tooFewDays: 4,
          offMenu: 1,
        },
        offMenu: [{ id: "w9", name: "SYNTHETIC Reserve" }],
      },
      { days: null },
    );
    expect(figure(doc, "No quadrant")).toBe(3);
    expect(figure(doc, "Under a week of sales")).toBe(4);
    expect(figure(doc, "No pre-tax margin")).toBe(3);
    expect(figure(doc, "Not on any menu")).toBe(1);
    expect(doc.notes).toContain(
      "Not on any menu, so not placed: SYNTHETIC Reserve.",
    );
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
    const week = figure(doc, "Trend per day, last 28 days");
    expect(isWithheld(week)).toBe(true);
    expect((week as { why: string }).why).toBe("the weekday lens did not answer inside the overview call");
    expect(figure(doc, "Bought, the last 30 days")).toBe(1200);
  });

  it("against ourselves: a goal is typed by its unit and named as its last reading; an unread goals lens is not 'no goal' (F-573)", () => {
    const bench = (activeGoals: unknown) =>
      EXPORT_CUTTINGS.bench.write(
        { ...(PAYLOADS.bench as object), activeGoals },
        { days: null },
      );
    const typed = bench([
      {
        name: "Lift wine attach",
        metric_key: "wine_attach_rate",
        unit: "percent",
        baseline_value: 0.2,
        current_value: 0.35,
        target_value: 0.4,
      },
    ]);
    const row = typed.tables[0].rows.find((r) =>
      String(r[0]).startsWith("Lift wine attach"),
    )!;
    expect(row[0]).toBe("Lift wine attach — baseline, last read, target");
    expect(row[2]).toEqual({ n: 0.35, unit: "ratio" });
    const unread = bench(null);
    expect(isWithheld(figure(unread, "Goals running"))).toBe(true);
    expect(unread.notes.join(" ")).toContain("The goals could not be read");
    expect(unread.notes.join(" ")).not.toContain("No goal is running");
  });

  it("the room and who served it: a table with no attributed check has no average, and a missing tip is not 0%", () => {
    const seats = EXPORT_CUTTINGS.seats.write(PAYLOADS.seats, { days: null });
    expect(isWithheld(seats.tables[0].rows[1][5])).toBe(true);
    const service = EXPORT_CUTTINGS.service.write(PAYLOADS.service, { days: null });
    expect(isWithheld(service.tables[0].rows[0][5])).toBe(true);
    expect(isWithheld(figure(service, "Table-adjusted fit (R²)"))).toBe(true);
  });

  it("F-1573: who served it on a till with no amount before tax — Tip says why, never 'no tip recorded' or 'over net sales'", () => {
    const why =
      "Your till sends tips but no amount before tax, so no tip rate can be taken.";
    const doc = EXPORT_CUTTINGS.service.write(
      {
        sinceDays: 90,
        dataStatus: "live",
        adjusted: null,
        tipBasis: null,
        tipBasisWhy: why,
        waiters: [
          {
            name: "Maya",
            checks: 3,
            revenue: 378,
            avgCheck: 126,
            tipPct: null,
            tipPctWhy:
              "tips were recorded, but the till sent no amount before tax, so no tip rate can be taken",
          },
        ],
      },
      { days: null },
    );
    const tip = doc.tables[0].rows[0][5];
    expect(isWithheld(tip)).toBe(true);
    expect(JSON.stringify(tip)).toContain("no amount before tax");
    expect(JSON.stringify(tip)).not.toContain("no tip recorded");
    expect(doc.basis).toContain(why);
    expect(doc.basis.join(" ")).not.toContain("over net sales");
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
    expect(
      figure(
        doc,
        "Pace, the last 30 days (today so far) against the 30 before",
      ),
    ).toBeCloseTo(33.33, 6);
    // F-1574: two trailing 30-day windows, never called a month.
    expect(doc.figures.map((x) => x.label).join("|")).not.toMatch(/month/i);
    expect(EXPORT_CUTTINGS.pacing.window(null)).toMatch(/ending today so far/);
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
 * F-1009 (sim 36, owner's month end). The screen's Spend pacing and Against
 * ourselves print how many orders carry no price and which orders are in
 * neither figure. The files left both out, under a footer that promises any
 * figure the engine could not compute is written "withheld" — so a short
 * buying figure was handed to the accountant as the whole one.
 */
describe("the buying files carry the caveats the screen prints (F-1009)", () => {
  const unpricedPacing = {
    ...(PAYLOADS.pacing as object),
    spendUnpricedCount: 3,
    committedUnpricedCount: 1,
    notCounted: {
      approved: 2,
      partlyReceived: 1,
      other: 0,
      orderValue: 850,
      unpriced: 1,
    },
    basis: {
      outflow: "delivered procurement_orders",
      days: "each 30-day window ends today, on the house's own date (Europe/Istanbul)",
      notCounted:
        "orders approved but not yet confirmed by the vendor are in neither figure",
    },
  };

  it("spend pacing names the unpriced orders and the orders in neither figure", () => {
    const doc = EXPORT_CUTTINGS.pacing.write(unpricedPacing, { days: null });
    expect(doc.notes).toContain(
      "3 delivered orders carry no price in these 180 days, so the 30-day buying figures leave them out and may be short by what they cost.",
    );
    expect(doc.notes).toContain(
      "1 open order carries no price, so Committed, not yet delivered leaves it out.",
    );
    expect(doc.notes).toContain(
      "Not in either figure: 2 approved orders and 1 partly received order, written above at their order value. 1 of them carries no price, so that order value leaves it out. They count once the vendor confirms them or they close.",
    );
    expect(figure(doc, "Not in either figure, at order value")).toBe(850);
    expect(doc.basis).toEqual([
      "Outflow: delivered procurement_orders.",
      "Days: each 30-day window ends today, on the house's own date (Europe/Istanbul).",
      "Not in either figure: orders approved but not yet confirmed by the vendor are in neither figure.",
    ]);
  });

  it("spend pacing with every order priced and counted adds no caveat", () => {
    const doc = EXPORT_CUTTINGS.pacing.write(PAYLOADS.pacing, { days: null });
    expect(doc.notes.join(" ")).not.toMatch(/no price|Not in either figure/);
    expect(doc.figures.map((x) => x.label)).not.toContain(
      "Not in either figure, at order value",
    );
  });

  it("against ourselves names the unpriced orders its buying figures leave out", () => {
    const bench = PAYLOADS.bench as { cashflow: object };
    const doc = EXPORT_CUTTINGS.bench.write(
      {
        ...bench,
        cashflow: {
          ...bench.cashflow,
          spendUnpricedCount: 1,
          committedUnpricedCount: 2,
        },
      },
      { days: null },
    );
    expect(doc.notes).toContain(
      "1 delivered order carries no price in these 180 days, so the 30-day buying figures leave it out and may be short by what it cost.",
    );
    expect(doc.notes).toContain(
      "2 open orders carry no price, so Committed, not yet delivered leaves them out.",
    );
  });
});

// F-1053 / F-1054: a house that bought in two currencies has blank money
// figures for that reason, and the file says it — not "nothing was bought".
describe("two currencies are said in the file, not read as an empty window (F-1053, F-1054)", () => {
  const SPEND =
    "Paid in EUR and TRY: with no exchange rate on record they cannot be added into one figure, so the 30-day buying figures and the pace are left blank.";
  const ORDERED =
    "Ordered in EUR and TRY: with no exchange rate on record these cannot be added into one figure.";
  const why = (doc: ExportDoc, label: string) =>
    (figure(doc, label) as { why: string }).why;

  it("spend pacing says the two currencies, not that no order was delivered", () => {
    const doc = EXPORT_CUTTINGS.pacing.write(
      {
        ...(PAYLOADS.pacing as object),
        spendLast30d: null,
        spendPrev30d: null,
        paceDeltaPct: null,
        spendNote: SPEND,
        committedOpenOrders: null,
        committedNote: ORDERED,
        notCounted: {
          approved: 2,
          partlyReceived: 0,
          other: 0,
          orderValue: null,
          orderValueNote: ORDERED,
          unpriced: 0,
        },
      },
      { days: null },
    );
    expect(doc.say).toBe(SPEND);
    expect(why(doc, "Paid out, the last 30 days")).toBe(SPEND);
    expect(why(doc, "Paid out, the 30 days before")).toBe(SPEND);
    expect(why(doc, "Pace")).toBe(SPEND);
    expect(why(doc, "Committed, not yet delivered")).toBe(ORDERED);
    expect(why(doc, "Not in either figure, at order value")).toBe(ORDERED);
    expect(doc.notes.join(" ")).not.toContain("Both windows came back at zero");
  });

  it("against ourselves gives the two currencies as the reason its buying figures are blank", () => {
    const bench = PAYLOADS.bench as { cashflow: object };
    const doc = EXPORT_CUTTINGS.bench.write(
      {
        ...bench,
        cashflow: {
          ...bench.cashflow,
          spendLast30d: null,
          spendPrev30d: null,
          paceDeltaPct: null,
          spendNote: SPEND,
          committedOpenOrders: null,
          committedNote: ORDERED,
        },
      },
      { days: null },
    );
    expect(why(doc, "Bought, the last 30 days")).toBe(SPEND);
    expect(why(doc, "Bought, the 30 before")).toBe(SPEND);
    expect(
      why(doc, "Pace, the last 30 days (today so far) against the 30 before"),
    ).toBe(SPEND);
    expect(why(doc, "Committed, not yet delivered")).toBe(ORDERED);
    expect(doc.notes).toContain(SPEND);
    expect(doc.notes).toContain(ORDERED);
  });

  it("figures of record gives the two currencies as the reason Cost of goods is blank", () => {
    const doc = EXPORT_CUTTINGS.ledger.write(
      { ...(PAYLOADS.ledger as object), cogs: null, cogsNote: ORDERED },
      { days: null },
    );
    expect(why(doc, "Cost of goods (365d)")).toBe(ORDERED);
    const empty = EXPORT_CUTTINGS.ledger.write(PAYLOADS.ledger, { days: null });
    expect(why(empty, "Cost of goods (365d)")).toContain(
      "No delivered order came back",
    );
  });

  // F-1715: at a house whose till prices include tax, the margins' reason and
  // basis are the tax, as the screen says them.
  it("figures of record gives the tax basis as the margins' reason and note", () => {
    const TAXED =
      "Your till prices include tax, so margin is set against costs recorded without tax, and 1 wine on hand has a cost not recorded that way, so gross margin, COGS ratio and GMROI are not worked out.";
    const doc = EXPORT_CUTTINGS.ledger.write(
      {
        ...(PAYLOADS.ledger as object),
        grossMargin: null,
        cogsRatio: null,
        gmroi: null,
        marginTaxNote: TAXED,
      },
      { days: null },
    );
    for (const label of ["Gross margin", "COGS ratio", "GMROI"])
      expect(why(doc, label)).toBe(TAXED);
    expect(doc.notes).toContain(TAXED);
  });

  // F-1216: turns and days are withheld because COGS is in other money, not
  // for want of a cost basis or a year of orders.
  it("inventory turns and days give the currency as their reason, not the cost basis", () => {
    const euro = EXPORT_CUTTINGS.ledger.write(
      {
        ...(PAYLOADS.ledger as object),
        cogs: 4200,
        cogsCurrency: "EUR",
        houseCurrency: "TRY",
      },
      { days: null, currency: "TRY" },
    );
    for (const label of ["Inventory turns", "Days of inventory"]) {
      expect(why(euro, label)).toBe(
        "Cost of goods is in EUR, not the house's TRY, and with no exchange rate on record it is not set against the cellar",
      );
    }
    const two = EXPORT_CUTTINGS.ledger.write(
      { ...(PAYLOADS.ledger as object), cogs: null, cogsNote: ORDERED },
      { days: null },
    );
    expect(why(two, "Inventory turns")).toBe(
      `Cost of goods is withheld: ${ORDERED}`,
    );
    const plain = EXPORT_CUTTINGS.ledger.write(PAYLOADS.ledger, { days: null });
    expect(why(plain, "Inventory turns")).toBe(
      "Needs a complete cost basis and a delivered order with a price",
    );
  });

  // F-1491: a fully costed house under a month of buying had its turns
  // withheld for "a year of delivered orders"; the span is its reason.
  it("inventory turns and days give a young house's short span as their reason, and the basis says it", () => {
    const SHORT =
      "Turns and days of stock need 30 days of buying on record; this house has 21 days, counted from its first delivery.";
    const doc = EXPORT_CUTTINGS.ledger.write(
      {
        ...(PAYLOADS.ledger as object),
        cogs: 2000,
        turnsSpanShort: true,
        turnsSpanNote: SHORT,
        basis: {
          ...((PAYLOADS.ledger as any).basis ?? {}),
          turns: "null: the house has 21 days of buying on record",
        },
      },
      { days: null },
    );
    for (const label of ["Inventory turns", "Days of inventory"])
      expect(why(doc, label)).toBe(SHORT);
    expect(doc.notes).toContain(SHORT);
    expect(doc.basis).toContain(
      "null: the house has 21 days of buying on record",
    );
  });
});
