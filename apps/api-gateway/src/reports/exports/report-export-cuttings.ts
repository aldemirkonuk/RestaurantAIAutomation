/**
 * The cuttings a house can export, and how each one's payload is written down.
 *
 * WHERE THE FIGURES COME FROM
 * ---------------------------
 * Nowhere new. Each entry names the analytics call the /reports page makes for
 * that cutting (`apps/web/src/pages/reports/next/rp-registers-*.tsx`, the
 * `path` of each catalogue entry) and `ReportCuttingReader` makes exactly that
 * call through the same gateway service, with the same parameters. The `write`
 * function below SELECTS fields from that payload; it does not recompute them.
 * The one derivation it performs is the one the page performs — the till's
 * average check, revenue ÷ checks when both are known — cited where it is done.
 *
 * WHAT IT WRITES THAT THE SCREEN ABBREVIATES
 * -----------------------------------------
 * Rows the screen caps for space (40 wines, 14 bars) are written whole: an
 * export is where a reader goes for the rest. Dates are ISO, money is a bare
 * number under a header that names the house's reporting currency (or says it
 * is not recorded), and ratios are the engine's 0–1 values.
 *
 * DRIFT
 * -----
 * The web catalogue cannot be imported across the app boundary. The ids,
 * titles and window lines here are pinned by `report-export-cuttings.spec.ts`
 * against the page's own source (`rp-sheet.ts` ANALYSIS_IDS and the
 * `rp-registers-*.tsx` entries) and against the gateway's `CUTTING_CATALOGUE`
 * — so a cutting added to the sheet and not here fails a test instead of
 * silently being unexportable.
 */

import {
  arr,
  countWithheld,
  figure,
  num,
  obj,
  sentences,
  str,
  typed,
  withheld,
  type Cell,
  type ExportDoc,
  type ExportFigure,
  type ExportTable,
  type Unit,
} from "./report-export-doc";

export const EXPORTABLE_CUTTINGS = [
  "reading",
  "till",
  "goals",
  "bench",
  "pacing",
  "week",
  "ahead",
  "quadrants",
  "ledger",
  "seats",
  "service",
  "restock",
] as const;

export type ExportableCutting = (typeof EXPORTABLE_CUTTINGS)[number];

export function isExportableCutting(v: unknown): v is ExportableCutting {
  return (
    typeof v === "string" &&
    (EXPORTABLE_CUTTINGS as readonly string[]).includes(v)
  );
}

/** The till's window choices on the page (`Cutting.tsx` TillWindowPicker). The gateway accepts 1–365, as `GET /analytics/pos-revenue` does. */
export const TILL_DAYS_MIN = 1;
export const TILL_DAYS_MAX = 365;

export interface CuttingSpec {
  /** The page's title for this cutting, verbatim. */
  title: string;
  /** The window line the page prints under the title. */
  window: (days: number | null) => string;
  /** True for the one cutting whose endpoint takes a day window. */
  takesWindow: boolean;
  write: (payload: unknown, ctx: { days: number | null }) => ExportDoc;
}

const doc = (d: Partial<ExportDoc>): ExportDoc => ({
  say: d.say ?? null,
  figures: d.figures ?? [],
  tables: d.tables ?? [],
  notes: (d.notes ?? []).filter((n) => typeof n === "string" && n !== ""),
  basis: d.basis ?? [],
});

const f = (label: string, value: Cell, unit: Unit): ExportFigure => ({
  label,
  value,
  unit,
});

const nounCount = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/* ───────────────────────────────────────────────────── 1. the reading ──── */

function writeReading(payload: unknown): ExportDoc {
  // rp-registers-trade.tsx `reading.select`: both key spellings, empty
  // sentences dropped, highest score first.
  const rows = arr(obj(payload).insights)
    .map((row) => ({
      sentence: str(row.sentence),
      category: str(row.category) || "sales",
      score: num(row.score),
      entity: str(row.entity_label ?? row.entityLabel),
    }))
    .filter((r) => r.sentence !== "")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  if (rows.length === 0)
    return doc({
      say: "The engine has produced no insight for this restaurant yet. It computes hourly and on demand — there is nothing to say, rather than nothing to show.",
      figures: [f("Sentences read", 0, "count")],
    });

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);

  return doc({
    figures: [
      f("Sentences read", rows.length, "count"),
      f("Categories with something to say", counts.size, "count"),
    ],
    tables: [
      {
        title: "The engine's sentences",
        columns: [
          { label: "Category", unit: "text" },
          { label: "Sentence", unit: "text" },
          { label: "About", unit: "text" },
        ],
        rows: rows.map((r) => [r.category, r.sentence, r.entity || null]),
      },
      {
        title: "Sentences by category",
        columns: [
          { label: "Category", unit: "text" },
          { label: "Sentences", unit: "count" },
        ],
        rows: Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([c, n]) => [c, n]),
      },
    ],
    notes: [
      "Sentences are written as the engine wrote them. This export never composes one.",
    ],
    basis: [
      `${nounCount(rows.length, "sentence", "sentences")} read from the stored insight feed; every number in them was computed by the engine from this restaurant's own rows.`,
    ],
  });
}

/* ────────────────────────────────────────────────────── 2. the till ────── */

function writeTill(payload: unknown, ctx: { days: number | null }): ExportDoc {
  const d = obj(payload);
  const from = str(d.from);
  const to = str(d.to);
  const days = num(d.days) ?? ctx.days;
  const noFeed =
    "No POS check has ever landed for this restaurant — an absent feed, not a day of zero";

  if (d.posConnected !== true)
    return doc({
      say: "No POS check has ever landed for this restaurant, so there is no sales revenue to read. That is an absent feed, not a day of zero — nothing is written as a figure here.",
      figures: [
        f("Taken", withheld(noFeed), "money"),
        f("Checks", withheld(noFeed), "count"),
        f("Average check", withheld(noFeed), "money"),
      ],
      basis: [`Window ${from || "—"} to ${to || "—"}.`],
    });

  const revenue = num(d.revenue);
  const checks = num(d.checkCount);
  // The page's own derivation, rp-registers-trade.tsx `till.view`: an average
  // needs both operands and a non-zero count, or it is not an average.
  const avg =
    revenue != null && checks != null && checks > 0 ? revenue / checks : null;
  const series = arr(d.dailySeries).map((r) => ({
    date: str(r.date),
    revenue: num(r.revenue),
  }));

  return doc({
    say:
      series.length === 0
        ? "The till answered, and no check fell inside this window."
        : null,
    figures: [
      f("Taken", figure(revenue, "No POS revenue recorded"), "money"),
      f("Checks", figure(checks, "No POS check count recorded"), "count"),
      f(
        "Average check",
        figure(avg, "Needs both revenue and a check count"),
        "money",
      ),
    ],
    tables:
      series.length === 0
        ? []
        : [
            {
              title: "Taken, day by day",
              columns: [
                { label: "Day", unit: "text" },
                { label: "Taken", unit: "money" },
              ],
              rows: series.map((s) => [
                s.date,
                figure(s.revenue, "the till returned no total for this day"),
              ]),
              note:
                days != null && series.length < days
                  ? `${series.length} of the ${days} days in the window rang up a check; the rest are absent rather than zero.`
                  : undefined,
            },
          ],
    basis: [
      `Non-voided pos_checks.total between ${from || "—"} and ${to || "—"}.`,
      "The series is sparse on purpose: a day with no check is absent, not written as zero.",
    ],
  });
}

/* ───────────────────────────────────────────────────── 3. spend pacing ── */

function writePacing(payload: unknown): ExportDoc {
  const c = obj(payload);
  const last = num(c.spendLast30d);
  const prev = num(c.spendPrev30d);
  const projection = Array.isArray(c.projectedNext4Weeks)
    ? (c.projectedNext4Weeks as unknown[])
    : null;
  const bothZero = (last ?? 0) === 0 && (prev ?? 0) === 0;

  return doc({
    say: bothZero
      ? "No delivered purchase order falls in either 30-day window, so there is no pace to read."
      : null,
    figures: [
      f("Paid out, the last 30 days", figure(last, "the cashflow register returned no figure"), "money"),
      f("Paid out, the 30 days before", figure(prev, "the cashflow register returned no figure"), "money"),
      f("Pace", figure(c.paceDeltaPct, "Needs two comparable 30-day windows"), "percent"),
      f("Committed, not yet delivered", figure(c.committedOpenOrders, "the cashflow register returned no figure"), "money"),
      f("Open orders", figure(c.openOrderCount, "the cashflow register returned no figure"), "count"),
    ],
    tables:
      projection && projection.length > 0
        ? [
            {
              title: "Projected spend, the next four weeks",
              columns: [
                { label: "Week ahead", unit: "count" },
                { label: "Projected", unit: "money" },
              ],
              rows: projection.map((v, i) => [
                i + 1,
                figure(v, "the projection returned no figure for this week"),
              ]),
              note: "A Holt projection, not a measurement.",
            },
          ]
        : [],
    notes: [
      projection && projection.length > 0
        ? ""
        : "Too few weeks of purchasing to project — withheld rather than a line drawn through two points.",
      bothZero
        ? 'Both windows came back at zero, and the zeros are ambiguous: the cashflow lens sums a loader that returns an empty list for a failed query as well as for a quiet month, so zero means "no delivered order was returned", not necessarily "nothing was bought".'
        : "",
    ],
    basis: sentences(
      obj(c.basis).outflow ? `Outflow: ${str(obj(c.basis).outflow)}.` : null,
    ),
  });
}

/* ───────────────────────────────────────────────── 4. the week's shape ── */

function writeWeek(payload: unknown): ExportDoc {
  const w = obj(payload);
  const basisObj = obj(w.basis);
  const basis = sentences(
    basisObj.weekday ??
      "Mean units per weekday over the last 90 days of wine_consumption_log; a weekday with no observation is left blank rather than written as zero.",
    basisObj.extremes,
  );
  const profile = arr(w.weekdayProfile).map((p) => ({
    day: str(p.day),
    mean: num(p.mean),
    stdev: num(p.stdev),
    n: num(p.n),
  }));
  if (profile.length === 0)
    return doc({
      say: "No consumption is recorded in the last 90 days, so the week has no shape yet.",
      basis,
    });

  const tie = typeof w.tie === "boolean" ? w.tie : null;
  const best = typeof w.bestDay === "string" ? w.bestDay : null;
  const worst = typeof w.worstDay === "string" ? w.worstDay : null;
  // rp-registers-trade.tsx `week.view`: a tie is not a ranking.
  const ranked = tie === false || (tie === null && !!best && best !== worst);
  const allZero = profile.every((p) => (p.n ?? 0) === 0 || (p.mean ?? 0) === 0);
  const unseen = "no observation on this weekday";

  return doc({
    say: allZero
      ? "Every weekday reads zero over the last 90 days — the consumption log recorded no movement, so the week has no shape yet."
      : null,
    figures: [
      f("Busiest day", ranked && best ? best : withheld("More than one weekday shares the highest mean"), "text"),
      f("Quietest day", ranked && worst ? worst : withheld("More than one weekday shares the lowest mean"), "text"),
      f("28-day trend, per day", figure(w.trendPerDayPct, "the seasonality register returned no trend"), "percent"),
    ],
    tables: [
      {
        title: "Mean bottles per weekday",
        columns: [
          { label: "Weekday", unit: "text" },
          { label: "Mean per day", unit: "bottles" },
          { label: "Spread", unit: "bottles" },
          { label: "Days seen", unit: "count" },
        ],
        rows: profile.map((p) => [
          p.day,
          (p.n ?? 0) > 0 ? figure(p.mean, unseen) : withheld(unseen),
          (p.n ?? 0) > 0 ? figure(p.stdev, unseen) : withheld(unseen),
          figure(p.n, "the register returned no observation count"),
        ]),
      },
    ],
    notes: ranked
      ? []
      : [
          "Busiest and quietest are withheld because more than one weekday shares the extreme, and naming one of them would be an arbitrary tie-break rather than a finding.",
        ],
    basis,
  });
}

/* ───────────────────────────────────────────────────── 5. what's coming ── */

function writeAhead(payload: unknown): ExportDoc {
  const a = obj(payload);
  const b = obj(a.basis);
  const accuracy = a.accuracy == null ? null : obj(a.accuracy);
  const horizon = num(a.horizon) ?? 14;
  const forecast = arr(a.forecast).map((x) => ({
    date: str(x.date),
    value: num(x.value),
  }));
  const basis = sentences(
    b.demand,
    b.model,
    b.total,
    accuracy?.basis,
    accuracy && num(accuracy.scoredPoints) != null
      ? `Scored on ${num(accuracy.scoredPoints)} out-of-sample points.`
      : null,
  );
  const unfitted = "No model fitted this history";

  if (forecast.length === 0 || a.modelFitted === false)
    return doc({
      say: "Nothing is projected: no model fitted this history, so no line is drawn and no total is claimed.",
      figures: [
        f(`Next ${horizon} days`, withheld(unfitted), "bottles"),
        f("Model", withheld(unfitted), "text"),
      ],
      basis,
    });

  const h = obj(a.history);
  const dates = Array.isArray(h.dates) ? (h.dates as unknown[]) : [];
  const values = Array.isArray(h.values) ? (h.values as unknown[]) : [];
  const tail = 28;
  const hist = dates.slice(-tail).map((d, i) => ({
    date: str(d),
    value: num(values.slice(-tail)[i]),
  }));
  const mape = accuracy ? num(accuracy.mape) : null;

  return doc({
    figures: [
      f(`Next ${horizon} days`, figure(a.totalForecastDemand, "the forecast register withheld its total"), "bottles"),
      // The engine returns MAPE in percent; the page divides by 100 to print it.
      f("Backtest error (MAPE)", mape === null ? withheld("Not scoreable on this history") : { n: mape, unit: "percent" }, "percent"),
      f("Model", typeof a.model === "string" && a.model ? a.model : withheld(unfitted), "text"),
    ],
    tables: [
      {
        title: "Projected, day by day",
        columns: [
          { label: "Day", unit: "text" },
          { label: "Projected bottles", unit: "bottles" },
        ],
        rows: forecast.map((x) => [x.date, figure(x.value, "the model returned no value for this day")]),
        note: "Every row is the model's expectation. None of it is trade that happened.",
      },
      {
        title: `Measured, the last ${hist.length} days of history`,
        columns: [
          { label: "Day", unit: "text" },
          { label: "Bottles", unit: "bottles" },
        ],
        rows: hist.map((x) => [x.date, figure(x.value, "no value recorded for this day")]),
      },
    ],
    basis,
  });
}

/* ────────────────────────────────────────── 6. margin against movement ── */

function writeQuadrants(payload: unknown): ExportDoc {
  const q = obj(payload);
  const b = obj(q.basis);
  const counts = q.counts == null ? null : obj(q.counts);
  const medians = obj(q.medians);
  const cc = q.costCoverage == null ? null : obj(q.costCoverage);
  const items = arr(q.items).map((i) => ({
    name: str(i.name),
    velocity: num(i.velocityPerDay),
    margin: num(i.marginPerBottle),
    marginPct: num(i.marginPct),
    quadrant: typeof i.quadrant === "string" ? i.quadrant : null,
  }));
  const uncosted = "no recorded cost — unknown, not a dog";
  const count = (k: string) =>
    counts === null
      ? withheld("the register returned no quadrant counts")
      : (num(counts[k]) ?? 0);
  const unclassified = counts === null ? null : (num(counts.unclassified) ?? 0);
  const priced = items.filter((i) => i.margin != null).length;

  return doc({
    say:
      priced === 0
        ? "No wine on the list carries both a recorded cost and a menu price, so there is no margin to rank on. Nothing is filed in a quadrant, and nothing is guessed into one."
        : null,
    figures: [
      f("Stars", count("star"), "count"),
      f("Plowhorses", count("plowhorse"), "count"),
      f("Puzzles", count("puzzle"), "count"),
      f("Dogs", count("dog"), "count"),
      f("No quadrant", count("unclassified"), "count"),
      f("Median bottles per day", figure(medians.velocityPerDay, "the register published no median"), "bottles"),
      f("Median margin per bottle", figure(medians.marginPerBottle, "no wine carries a recorded cost"), "money"),
    ],
    tables:
      items.length === 0
        ? []
        : [
            {
              title: "The list, margin against movement",
              columns: [
                { label: "Wine", unit: "text" },
                { label: "Bottles per day", unit: "bottles" },
                { label: "Margin per bottle", unit: "money" },
                { label: "Margin share", unit: "ratio" },
                { label: "Quadrant", unit: "text" },
              ],
              rows: items.map((i) => [
                i.name,
                figure(i.velocity, "no movement figure returned"),
                figure(i.margin, uncosted),
                figure(i.marginPct, uncosted),
                i.quadrant ?? withheld(uncosted),
              ]),
              note:
                items.length > 40
                  ? `All ${items.length} wines on the list; the screen shows the first 40.`
                  : `All ${nounCount(items.length, "wine", "wines")} on the list.`,
            },
          ],
    notes: [
      unclassified && unclassified > 0
        ? `${nounCount(unclassified, "wine has", "wines have")} no quadrant because no cost was ever recorded for ${unclassified === 1 ? "it" : "them"} — an uncosted wine is unknown, not a dog.`
        : "",
      cc && cc.complete === false && num(cc.total) != null
        ? `${num(cc.priced) ?? 0} of ${num(cc.total)} wines carry a recorded cost.`
        : "",
    ],
    basis: sentences(b.velocity, b.margin),
  });
}

/* ──────────────────────────────────────────────── 7. figures of record ── */

function writeLedger(payload: unknown): ExportDoc {
  const d = obj(payload);
  const b = obj(d.basis);
  const cc = d.costCoverage == null ? null : obj(d.costCoverage);
  const costBasis = "Needs a complete cost basis";
  return doc({
    figures: [
      f("Cellar at cost", figure(d.inventoryValue, "Not every on-hand row carries a recorded cost"), "money"),
      f("Cost of goods (365d)", figure(d.cogs, "No delivered order came back for the window — which is either no buying or a read that failed"), "money"),
      f("Sell-price valuation", figure(d.revenue, "No inventory row came back"), "money"),
      f("Gross margin", figure(d.grossMargin, costBasis), "ratio"),
      f("COGS ratio", figure(d.cogsRatio, costBasis), "ratio"),
      f("Inventory turns", figure(d.inventoryTurnover, `${costBasis} and a year of delivered orders`), "count"),
      f("Days of inventory", figure(d.daysInventoryOutstanding, `${costBasis} and a year of delivered orders`), "days"),
      f("GMROI", figure(d.gmroi, costBasis), "count"),
      f("Capital sitting still", figure(d.deadStockCapital, "No movement signal recorded, or an idle row has no cost"), "money"),
    ],
    notes: [
      cc && cc.complete === false
        ? num(cc.total) === 0
          ? "No on-hand wine carries a recorded cost, so every cost-derived figure above is withheld rather than a total assembled from nothing."
          : `${num(cc.priced) ?? 0} of ${num(cc.total) ?? 0} on-hand wines carry a recorded cost, so every cost-derived figure above is withheld rather than a total assembled from part of the cellar.`
        : "",
    ],
    basis: sentences(b.revenue, b.cogs, b.inventoryValue, b.deadStock, b.costDerived),
  });
}

/* ──────────────────────────────────────────────────────── 8. the room ─── */

function writeSeats(payload: unknown): ExportDoc {
  const s = obj(payload);
  const sinceDays = num(s.sinceDays) ?? 90;
  const basis = sentences(
    `Non-voided pos_checks attributed to a table over the last ${sinceDays} days.`,
    str(s.dataStatus) ? `Feed: ${str(s.dataStatus)}.` : null,
  );
  const tables = arr(s.tables).map((t) => ({
    label: str(t.label),
    zone: typeof t.zone === "string" ? t.zone : null,
    seats: num(t.seats),
    checks: num(t.checks) ?? 0,
    revenue: num(t.revenue),
    avgCheck: num(t.avgCheck),
    wineAttach: num(t.wineAttachRate),
  }));
  if (tables.length === 0)
    return doc({
      say: "No table is mapped for this restaurant yet, so no check can be attributed to a seat. The room has to be drawn before it can be read.",
      basis,
    });
  const served = tables.filter((t) => t.checks > 0);
  const noCheck = "no check attributed to this table";
  return doc({
    say:
      served.length === 0
        ? `${nounCount(tables.length, "table is", "tables are")} mapped, and not one check in the last ${sinceDays} days was attributed to any of them — an absent attribution, not an empty room.`
        : null,
    figures: [
      f("Tables in the room", tables.length, "count"),
      f("Tables that took a check", served.length, "count"),
      f("Busiest by takings", served.length > 0 ? served[0].label : withheld("No check has been attributed to any table"), "text"),
    ],
    tables: [
      {
        title: "Tables",
        columns: [
          { label: "Table", unit: "text" },
          { label: "Zone", unit: "text" },
          { label: "Seats", unit: "count" },
          { label: "Checks", unit: "count" },
          { label: "Taken", unit: "money" },
          { label: "Average check", unit: "money" },
          { label: "Wine attach", unit: "ratio" },
        ],
        rows: tables.map((t) => [
          t.label,
          t.zone,
          figure(t.seats, "seats not recorded for this table"),
          t.checks,
          figure(t.revenue, noCheck),
          figure(t.avgCheck, noCheck),
          figure(t.wineAttach, noCheck),
        ]),
      },
    ],
    basis,
  });
}

/* ────────────────────────────────────────────────── 9. who served it ──── */

function writeService(payload: unknown): ExportDoc {
  const s = obj(payload);
  const sinceDays = num(s.sinceDays) ?? 90;
  const adj = s.adjusted == null ? null : obj(s.adjusted);
  const basis = sentences(
    `Non-voided pos_checks grouped by server name over the last ${sinceDays} days.`,
    str(s.dataStatus) ? `Feed: ${str(s.dataStatus)}.` : null,
    adj ? adj.method : null,
  );
  const waiters = arr(s.waiters).map((w) => ({
    name: str(w.name),
    checks: num(w.checks),
    revenue: num(w.revenue),
    avgCheck: num(w.avgCheck),
    wineAttach: num(w.wineAttachRate),
    tip: num(w.tipPct),
  }));
  const figures = [
    f("Servers with a check", waiters.length, "count"),
    f("Table-adjusted fit (R²)", figure(adj ? adj.r2 : null, "Needs 10 checks across at least two tables before a server can be separated from their section"), "ratio"),
  ];
  if (waiters.length === 0)
    return doc({
      say: "No check in the window carries a server name, so nothing can be attributed to anyone. That is an absent field on the POS feed, not a shift nobody worked.",
      figures,
      basis,
    });
  const none = "the register returned no figure for this server";
  return doc({
    figures,
    tables: [
      {
        title: "Servers",
        columns: [
          { label: "Server", unit: "text" },
          { label: "Checks", unit: "count" },
          { label: "Taken", unit: "money" },
          { label: "Average check", unit: "money" },
          { label: "Wine attach", unit: "ratio" },
          { label: "Tip", unit: "ratio" },
        ],
        rows: waiters.map((w) => [
          w.name,
          figure(w.checks, none),
          figure(w.revenue, none),
          figure(w.avgCheck, none),
          figure(w.wineAttach, none),
          figure(w.tip, "no tip recorded on this server's checks"),
        ]),
      },
    ],
    notes: [
      "A server's raw average is partly the section they were given. The adjusted fit is the engine's attempt to remove it; where it is withheld, the raw figures are all there is.",
    ],
    basis,
  });
}

/* ──────────────────────────────────────────── 10. what to buy back ────── */

function writeRestock(payload: unknown): ExportDoc {
  const r = obj(payload);
  const p = obj(r.params);
  const b = obj(r.basis);
  const skuCount = num(r.skuCount) ?? 0;
  const reorderCount = num(r.reorderCount) ?? 0;
  const list = arr(r.reorderList).map((x) => ({
    name: str(x.name),
    onHand: num(x.onHand),
    cover: num(x.daysOfCover),
    reorderPoint: num(x.reorderPoint),
    safety: num(x.safetyStock),
    risk: num(x.stockoutProbability),
  }));
  const basis = sentences(b.demand, b.reorderScience, b.costDerived);
  const figures = [
    f("Wines on the register", skuCount, "count"),
    f("Below their reorder point", reorderCount, "count"),
    f("Service level", figure(p.serviceLevel, "the register returned no service level"), "ratio"),
    f("Lead time assumed", figure(p.leadTimeDays, "the register returned no lead time"), "days"),
  ];
  if (skuCount === 0)
    return doc({
      say: "No wine came back from the inventory register, so there is nothing to reorder and nothing to say about cover.",
      figures,
      basis,
    });
  if (list.length === 0)
    return doc({
      say: `Nothing is below its reorder point. That is a real answer about ${nounCount(skuCount, "wine", "wines")}, not an empty register.`,
      figures,
      basis,
    });
  const unmeasured = "no measured demand — it cannot run out on a rate nobody has observed";
  return doc({
    figures,
    tables: [
      {
        title: "Below the reorder point, highest risk first",
        columns: [
          { label: "Wine", unit: "text" },
          { label: "On hand", unit: "bottles" },
          { label: "Days of cover", unit: "days" },
          { label: "Reorder at", unit: "bottles" },
          { label: "Safety stock", unit: "bottles" },
          { label: "Stockout risk", unit: "ratio" },
        ],
        rows: list.map((x) => [
          x.name,
          figure(x.onHand, "no on-hand count returned"),
          figure(x.cover, unmeasured),
          figure(x.reorderPoint, unmeasured),
          figure(x.safety, unmeasured),
          figure(x.risk, unmeasured),
        ]),
        note:
          reorderCount > list.length
            ? `${reorderCount} wines are below their reorder point; the ${list.length} at the highest risk are listed, as the register returns them.`
            : undefined,
      },
    ],
    basis,
  });
}

/* ─────────────────────────────────────────────── 11. against ourselves ── */

function writeBench(payload: unknown): ExportDoc {
  const d = obj(payload);
  const cashflowMissing = d.cashflow == null;
  const seasonalityMissing = d.seasonality == null;
  const cf = obj(d.cashflow);
  const se = obj(d.seasonality);
  const cfMissing = "the cashflow lens did not answer inside the overview call";
  const seMissing = "the weekday lens did not answer inside the overview call";
  const cfWhy = cashflowMissing ? cfMissing : "the cashflow register returned no figure";
  const tie = se.tie === true;
  const goals = arr(d.activeGoals).map((g) => ({
    name: str(g.name) || "Untitled goal",
    baseline: num(g.baseline_value),
    current: num(g.current_value),
    target: num(g.target_value),
  }));
  const last = num(cf.spendLast30d);
  const prev = num(cf.spendPrev30d);
  const noPeers =
    "No other house is in this comparison. Mudavym holds only this restaurant's books, so there is no market median to stand beside these figures — every one of them is this house against its own past.";

  const rows: Cell[][] = [
    [
      "Buying, the last 30 days against the 30 before",
      typed(last, "money", cfWhy),
      typed(prev, "money", cfWhy),
      typed(cf.paceDeltaPct, "percent", cashflowMissing ? cfMissing : "the server withholds a pace when the two windows are not comparable"),
    ],
    [
      "The week's own extremes (busiest, quietest, trend)",
      seasonalityMissing ? withheld(seMissing) : tie ? withheld("shared — more than one weekday holds the extreme") : typeof se.bestDay === "string" ? se.bestDay : withheld("no weekday is separable"),
      seasonalityMissing ? withheld(seMissing) : tie ? withheld("shared — more than one weekday holds the extreme") : typeof se.worstDay === "string" ? se.worstDay : withheld("no weekday is separable"),
      typed(se.trendPerDayPct, "percent", seasonalityMissing ? seMissing : "the seasonality register returned no trend"),
    ],
    ...arr(se.weekdayProfile).map((w): Cell[] => [
      `${str(w.day)}, mean per service`,
      typed(w.mean, "bottles", "no observation on this weekday"),
      typed(w.n, "count", "no observation count returned"),
      null,
    ]),
    ...goals.map((g): Cell[] => [
      `${g.name} — baseline, now, target`,
      typed(g.baseline, "count", "no baseline recorded when the goal was set"),
      typed(g.current, "count", "the goal's current value was not recorded"),
      typed(g.target, "count", "no target recorded"),
    ]),
  ];

  return doc({
    say:
      cashflowMissing && seasonalityMissing && goals.length === 0
        ? "Nothing in the overview register answered — neither the buying lens nor the weekday lens returned, and no goal is running."
        : null,
    figures: [
      f("Bought, the last 30 days", figure(last, cfWhy), "money"),
      f("Bought, the 30 before", figure(prev, cfWhy), "money"),
      f("Pace against last month", figure(cf.paceDeltaPct, cashflowMissing ? cfMissing : "the server withholds a pace when the two windows are not comparable"), "percent"),
      f("Committed, not yet delivered", figure(cf.committedOpenOrders, cfWhy), "money"),
      f("The week's trend", figure(se.trendPerDayPct, seasonalityMissing ? seMissing : "the seasonality register returned no trend"), "percent"),
      f("Goals running", goals.length, "count"),
    ],
    tables: [
      {
        title: "Against its own past",
        columns: [
          { label: "Against", unit: "text" },
          { label: "Then / busiest / baseline", unit: "text" },
          { label: "Now / quietest / current", unit: "text" },
          { label: "Change / trend / target", unit: "text" },
        ],
        rows,
      },
    ],
    notes: [
      noPeers,
      last === 0 && prev === 0
        ? 'Both buying windows came back at zero, and the zeros are ambiguous: the cashflow lens sums a loader that returns an empty list for a failed query as well as for a quiet month, so zero means "no delivered order was returned", not necessarily "nothing was bought".'
        : "",
      goals.length === 0
        ? "No goal is running, so there is nothing to measure against a baseline."
        : "",
    ],
    basis: sentences(obj(cf.basis).outflow, obj(se.basis).weekday, obj(se.basis).extremes),
  });
}

/* ────────────────────────────────────────────────────────── 12. goals ─── */

/**
 * The metric registry's units (`analytics/metric-registry.ts`: percent,
 * currency, units, days, score) in the export's vocabulary. A registry
 * `percent` is a 0–1 ratio — the page prints it through `ratioPct`.
 */
function goalUnit(unit: string): Unit {
  if (unit === "percent") return "ratio";
  if (unit === "currency") return "money";
  if (unit === "days") return "days";
  return "count";
}

function writeGoals(payload: unknown): ExportDoc {
  const d = obj(payload);
  const b = obj(d.basis);
  const goals = arr(d.goals).map((entry) => {
    const g = obj(entry.goal);
    return {
      name: str(g.name) || "Untitled goal",
      metric: str(entry.metricLabel) || str(g.metric_key),
      unit: goalUnit(str(entry.unit) || "count"),
      deadline: typeof g.deadline === "string" ? g.deadline : null,
      unreadable:
        entry.unreadable === true ? str(entry.reason) || "reason not given" : null,
      current: num(entry.current),
      target: num(entry.target),
      progress: num(entry.progressPct),
      onTrack: typeof entry.onTrack === "boolean" ? entry.onTrack : null,
    };
  });
  const total = num(d.total) ?? goals.length;
  const paced = goals.some((g) => g.onTrack !== null);
  const noPace = "no goal carries a deadline, so none has a pace";
  return doc({
    say:
      goals.length === 0
        ? "No goal is running. Set one on the goals desk and it is written here."
        : null,
    figures: [
      f("Goals running", total, "count"),
      f("On pace", paced ? goals.filter((g) => g.onTrack === true).length : withheld(noPace), "count"),
      f("Behind", paced ? goals.filter((g) => g.onTrack === false).length : withheld(noPace), "count"),
      f("Could not be scored", goals.filter((g) => g.unreadable).length, "count"),
    ],
    tables:
      goals.length === 0
        ? []
        : [
            {
              title: "Goals, each against its own target",
              columns: [
                { label: "Goal", unit: "text" },
                { label: "Measure", unit: "text" },
                { label: "Now", unit: "text" },
                { label: "Target", unit: "text" },
                { label: "Share of target", unit: "ratio" },
                { label: "On pace", unit: "text" },
                { label: "By", unit: "text" },
              ],
              rows: goals.map((g) => {
                const unreadable = g.unreadable
                  ? `this goal could not be read: ${g.unreadable}`
                  : null;
                return [
                  g.name,
                  g.metric,
                  unreadable ? withheld(unreadable) : typed(g.current, g.unit, "the goal's current value was not computed"),
                  typed(g.target, g.unit, "no target recorded"),
                  unreadable ? withheld(unreadable) : figure(g.progress, "the goal's progress was not computed"),
                  g.onTrack === null ? withheld(g.deadline ? "the pace was not computed" : "no deadline, so no pace") : g.onTrack ? "on pace" : "behind",
                  g.deadline,
                ];
              }),
              note:
                d.truncated === true
                  ? `Progress is computed for the first ${goals.length} of ${total} goals; the gateway caps the recomputation and says so.`
                  : undefined,
            },
          ],
    notes: [
      "Every figure is this house against its own baseline. No other restaurant's books are in it.",
    ],
    basis: sentences(b.current, b.peers),
  });
}

/* ─────────────────────────────────────────────────────── the catalogue ── */

/**
 * Keyed map, not an array of `{ id, … }` rows (ADR 0051 /
 * `check_no_seeded_defaults.py` S1): a vocabulary, not seeded data.
 * Titles and window lines are the page's, verbatim.
 */
export const EXPORT_CUTTINGS: Readonly<Record<ExportableCutting, CuttingSpec>> =
  Object.freeze({
    reading: { title: "The reading", window: () => "the stored insight feed, recomputed hourly", takesWindow: false, write: writeReading },
    till: { title: "Through the till", window: (days) => `the last ${days ?? 30} days of POS checks`, takesWindow: true, write: writeTill },
    goals: { title: "Goals", window: () => "each goal counted from the day it was set", takesWindow: false, write: writeGoals },
    bench: { title: "Against ourselves", window: () => "180 days of buying, 90 days of weekdays, each goal since it was set", takesWindow: false, write: writeBench },
    pacing: { title: "Spend pacing", window: () => "180 days of purchasing, compared in two 30-day windows", takesWindow: false, write: writePacing },
    week: { title: "The week’s shape", window: () => "the last 90 days of the consumption log", takesWindow: false, write: writeWeek },
    ahead: { title: "What’s coming", window: () => "120 days of history, 14 days ahead", takesWindow: false, write: writeAhead },
    quadrants: { title: "Margin against movement", window: () => "the list as it stands, against 90 days of movement", takesWindow: false, write: writeQuadrants },
    ledger: { title: "Figures of record", window: () => "365 days of COGS; the cellar as it stands today", takesWindow: false, write: writeLedger },
    seats: { title: "The room", window: () => "the last 90 days of POS checks", takesWindow: false, write: writeSeats },
    service: { title: "Who served it", window: () => "the last 90 days of POS checks", takesWindow: false, write: writeService },
    restock: { title: "What to buy back", window: () => "demand over the last 90 days, at the service level in the params", takesWindow: false, write: writeRestock },
  });

export { countWithheld };
export type { ExportDoc, ExportTable };
