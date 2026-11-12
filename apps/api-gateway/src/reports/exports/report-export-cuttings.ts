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
 * is not recorded), ratios are the engine's 0–1 values, and a signed change
 * (pace, trend — also 0–1 in the engine) is written in percent (`pctOf`).
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
  type Withheld,
} from "./report-export-doc";
import { HOUSE_ZONE_UNSET } from "../../common/house-day";

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
  write: (payload: unknown, ctx: WriteCtx) => ExportDoc;
}

/**
 * What a writer knows besides the payload: the till's day window, and the
 * house's money — the code the file's header names (F-1145).
 */
export interface WriteCtx {
  days: number | null;
  currency?: string | null;
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

/**
 * A money figure the gateway gives with its own code (F-1145). The file heads
 * every money figure with the house's code, so a euro COGS written as a bare
 * number under a lira header is read as lira. One in another currency is
 * withheld, and the reason says the amount with its own code.
 */
function houseMoney(
  v: unknown,
  code: unknown,
  ctx: WriteCtx,
  why: string,
): number | Withheld {
  const n = num(v);
  if (n === null) return withheld(why);
  const own = str(code).trim().toUpperCase();
  const house = (ctx.currency ?? "").trim().toUpperCase();
  if (!own || own === house) return n;
  return withheld(
    `${n} ${own}: given in ${own}, ${house ? `not the house's ${house}` : "and the house has no currency on record"}, and with no exchange rate on record it is not written as the house's money`,
  );
}

/** The same, for a cell in a table whose rows mix units. */
function houseMoneyCell(
  v: unknown,
  code: unknown,
  ctx: WriteCtx,
  why: string,
): Cell {
  const m = houseMoney(v, code, ctx, why);
  return typeof m === "number" ? { n: m, unit: "money" } : m;
}

const nounCount = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * A signed change the engine returns as a 0–1 fraction, in percent: 0.3333 →
 * 33.33, written under the `percent` unit ("already in percent").
 *
 * `paceDeltaPct` is (current − previous) ÷ |previous| (engine/comparisons.ts
 * periodOverPeriod) and `trendPerDayPct` is OLS slope ÷ |mean|
 * (engine/statistics.ts trendPerPeriodPct) — fractions, despite the names.
 * Until 2026-10-03 they were tagged `percent` as they came, so +20.7% a day
 * was written as 0.2 and printed "0.2%" (analytics walk, A-020). Not `ratio`:
 * that unit reads "share, 0–1", and a change is not a share of anything.
 */
const pctOf = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : n * 100;
};

/** A timestamptz's UTC calendar day, said as one — the export has no house clock. */
const utcDay = (v: string): string => {
  const t = Date.parse(v);
  return Number.isNaN(t) ? v : `${new Date(t).toISOString().slice(0, 10)} (UTC)`;
};

/**
 * `rp-registers-house.tsx` emptyWindowLine, for the two POS registers: the
 * sentence for a window that holds NO check, or null when it holds some (or
 * the gateway did not say). Only a `checksInWindow > 0` branch may blame a
 * missing field — there are checks, and none of them carries it.
 */
function emptyWindowLine(s: Record<string, unknown>, sinceDays: number): string | null {
  if (num(s.checksInWindow) !== 0) return null;
  const latest = typeof s.latestCheckAt === "string" && s.latestCheckAt ? s.latestCheckAt : null;
  return latest
    ? `No POS check was opened in the last ${sinceDays} days — the latest this house has was opened ${utcDay(latest)}. The window is empty; no field is missing.`
    : "No POS check has reached Mudavym for this house yet (voided checks are not counted), so there is nothing to attribute.";
}

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
      // Glass lines read at the 750 ml stand-in under it (ADR 0297).
      standIn: num(obj(obj(row.evidence).units).standInLines) ?? 0,
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
  const standIn = rows.filter((r) => r.standIn > 0).length;

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
    notes: sentences(
      "Sentences are written as the engine wrote them. This export never composes one.",
      standIn > 0
        ? `${nounCount(standIn, "of these sentences rests", "of these sentences rest")} in part on glass lines of items with no stated bottle size, read at the 750 ml stand-in the stock moves by; the stored feed carries each one's count of those lines and items.`
        : null,
    ),
    basis: [
      `${nounCount(rows.length, "sentence", "sentences")} read from the stored insight feed; every number in them was computed by the engine from this restaurant's own rows.`,
    ],
  });
}

/* ────────────────────────────────────────────────────── 2. the till ────── */

function writeTill(payload: unknown, ctx: WriteCtx): ExportDoc {
  const d = obj(payload);
  const from = str(d.from);
  const to = str(d.to);
  const timezone = str(d.timezone);
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

  // A house with no time zone has no days to file a check on (ADR 0296): the
  // till answered with no figures, and the sheet says why rather than reading
  // the gap as a quiet till. A payload from before ADR 0296 carries no
  // `zoneUnset` and is read as it always was.
  if (d.zoneUnset === true)
    return doc({
      say: HOUSE_ZONE_UNSET,
      figures: [
        f("Taken", withheld(HOUSE_ZONE_UNSET), "money"),
        f("Checks", withheld(HOUSE_ZONE_UNSET), "count"),
        f("Average check", withheld(HOUSE_ZONE_UNSET), "money"),
      ],
      basis: [],
    });

  const revenue = num(d.revenue);
  const checks = num(d.checkCount);
  // F-1444: checks with no total are left out of Taken, so the average
  // divides by the checks that carry one. An older payload says none.
  const untotaled = num(d.checksWithoutTotal) ?? 0;
  // F-1534: a check rung at 0 (a comp, a staff meal) is left out of the
  // average too. An older payload says none.
  const zeroRung = num(d.checksTakingNoMoney) ?? 0;
  // F-1644: a refund (a check with a minus total) is taken off Taken; the
  // average adds it back and leaves it out of its count. An older payload
  // says none.
  const refunds = num(d.checksRefunded) ?? 0;
  const refunded = num(d.refunded) ?? 0;
  const totaled =
    checks != null ? checks - untotaled - zeroRung - refunds : null;
  // The page's own derivation, rp-registers-trade.tsx `till.view`: an average
  // needs both operands and a non-zero count, or it is not an average.
  const avg =
    revenue != null && totaled != null && totaled > 0
      ? (revenue + refunded) / totaled
      : null;
  const series = arr(d.dailySeries).map((r) => ({
    date: str(r.date),
    revenue: num(r.revenue),
  }));
  // F-1606: a month close's till file carries the tax inside the till's
  // prices (gross less net); a plain window read carries no such key, and
  // neither does a US or unset house's close (F-1625).
  const taxSaid = "taxInside" in d;
  const taxWord = str(d.taxWord) || "tax";
  const taxChecks = num(d.taxInsideCheckCount) ?? 0;
  const netChecks = num(d.netSalesCheckCount);
  // F-1691: a month close's till file carries the month's tips as money, in
  // total and by who served; a plain window read carries no such key.
  const tipsSaid = "tips" in d;
  const tipChecks = num(d.tipsCheckCount) ?? 0;
  const tipOf = num(d.tipsOfChecks);
  const tipServers = arr(d.tipsByServer).map((r) => ({
    server: str(r.server) || "No server named",
    checks: num(r.checks),
    tips: num(r.tips),
  }));

  const tipTables: ExportTable[] =
    tipsSaid && tipServers.length > 0
      ? [
          {
            title: "Tips by server",
            columns: [
              { label: "Server", unit: "text" },
              { label: "Checks with a tip", unit: "count" },
              { label: "Tips", unit: "money" },
            ],
            rows: tipServers.map((s) => [
              s.server,
              figure(s.checks, "the till returned no count"),
              figure(s.tips, "the till returned no tip"),
            ]),
          },
        ]
      : [];

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
      ...(taxSaid
        ? [
            f(
              `${taxWord[0].toUpperCase()}${taxWord.slice(1)} inside till prices`,
              figure(
                num(d.taxInside),
                `No check this month had ${taxWord} taken out of its price`,
              ),
              "money",
            ),
          ]
        : []),
      ...(tipsSaid
        ? [
            f(
              "Tips",
              figure(num(d.tips), "No check this month recorded a tip"),
              "money",
            ),
          ]
        : []),
    ],
    // F-1644 (was F-412): a refund the till sends as a check with a minus
    // total (the CSV till, pos-hub/pos-adapters.ts) is taken off Taken. A
    // refund a till keeps apart (Toast's `payment.refunded` has no handler)
    // never reaches Mudavym, and the file says both.
    notes: [
      ...(revenue != null ? [TILL_TOTALS_NOT_NET, TILL_REFUNDS_TAKEN_OFF] : []),
      // w109-gross-basis: a house whose till prices include tax is told
      // Taken holds it, in the tax's own name; absent for any other house.
      ...(revenue != null && str(d.totalsTaxNote)
        ? [str(d.totalsTaxNote)]
        : []),
      ...(untotaled > 0 ? [tillUntotaledSaid(untotaled)] : []),
      ...(zeroRung > 0 ? [zeroChecksSaid(zeroRung)] : []),
      ...(refunds > 0 ? [refundChecksSaid(refunds)] : []),
      ...(taxSaid && taxChecks > 0 && netChecks != null && taxChecks < netChecks
        ? [
            `The ${taxWord} figure is from ${taxChecks} of ${netChecks} checks: the rest were rung before the house said its prices include ${taxWord}, or the till sent them without it.`,
          ]
        : []),
      ...(tipsSaid && num(d.tips) != null
        ? [
            `Tips are the tips your till recorded on this month's checks, voided checks left out. On most tills they are inside Taken.${
              tipOf != null && tipChecks < tipOf
                ? ` They are from ${tipChecks} of ${tipOf} checks: the rest came from the till with no tip amount.`
                : ""
            }`,
          ]
        : []),
    ],
    tables: [
      ...(series.length === 0
        ? []
        : ([
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
          ] satisfies ExportTable[])),
      ...tipTables,
    ],
    basis: [
      timezone
        ? `Non-voided pos_checks.total between ${from || "—"} and ${to || "—"}, each check filed on the house's day in ${timezone} by when it closed, else when it opened.`
        : `Non-voided pos_checks.total between ${from || "—"} and ${to || "—"}.`,
      "The series is sparse on purpose: a day with no check is absent, not written as zero.",
      ...(tipsSaid
        ? [
            "Tips: non-voided pos_checks.tip in the month, by server_name, else server_external_id.",
          ]
        : []),
    ],
  });
}

/**
 * F-1536: said on every till export that carries a figure. Taken sums the
 * checks' `total`, which on Square, Toast and Clover holds tax and the tip
 * (pos-hub/pos-adapters.ts), while the dashboard draws net sales, the
 * subtotal (ADR 0287). Word for word rp-registers-trade.tsx.
 */
export const TILL_TOTALS_NOT_NET =
  "Taken is the check totals as your till sends them. On most tills that includes tax and tips, so it reads higher than the dashboard's net sales, which are before tax and tips.";

/** F-1532: the room and server registers' twin of `TILL_TOTALS_NOT_NET`. */
export const REGISTER_TOTALS_NOT_NET =
  "Taken and the average check are check totals as your till sends them. On most tills that includes tax and tips, so they read higher than the dashboard's net sales, which are before tax and tips.";

/**
 * w111-net-table-revenue (AW17): the room and server registers' Taken and
 * average check are net sales, the dashboard's own reader, when the gateway
 * says so (`revenueBasis: "net"`). Word for word rp-registers-house.tsx.
 */
export const REGISTER_NET_SALES =
  "Taken and the average check are net sales, before tax and tips, the same figure as the dashboard's.";

/** w111: checks at a table or a server that stated no net, said on the room and server exports. */
export function checksWithoutNetSaid(n: number): string {
  return n === 1
    ? "1 check carried no amount before tax: counted in Checks, left out of Taken and the average check."
    : `${n} checks carried no amount before tax: counted in Checks, left out of Taken and the average check.`;
}

/** F-1532: the server register's tip rate is over net sales, never over a total that holds the tip. */
export const REGISTER_TIP_ON_NET =
  "Tip is tips over net sales, before tax and tips, on the checks that recorded a tip.";

/**
 * F-1534: checks rung at 0, said on the till, room and server exports as the
 * screen says them (rp-registers-trade.tsx `zeroChecksSaid`, word for word).
 */
export function zeroChecksSaid(n: number): string {
  return `${n} ${n === 1 ? "check was" : "checks were"} rung at 0, such as a comp or a staff meal: counted in Checks, left out of the average check.`;
}

/**
 * Said on every till export that carries a figure (F-1644): which refunds
 * Taken has had taken off, and which it cannot have. Word for word
 * rp-registers-trade.tsx.
 */
export const TILL_REFUNDS_TAKEN_OFF =
  "Refunds your till sends as a check with a minus total are taken off Taken. A refund your till keeps only in its own refund report does not reach Mudavym, so check that report before you hand this on as net takings.";

/**
 * F-1644: refunds sent as checks with a minus total, said on the till, room
 * and server exports as the screen says them (rp-registers-trade.tsx
 * `refundChecksSaid`, word for word).
 */
export function refundChecksSaid(n: number): string {
  return `${n} ${n === 1 ? "check was a refund" : "checks were refunds"}, sent by your till with a minus total: counted in Checks, taken off Taken, left out of the average check.`;
}

/**
 * F-1444: the till checks with no total, said on the till export as the
 * screen says them (rp-registers-trade.tsx `tillUntotaledSaid`, word for word).
 */
export function tillUntotaledSaid(n: number): string {
  return `${n} ${n === 1 ? "check has" : "checks have"} no total from the till, so ${n === 1 ? "it is" : "they are"} left out of Taken and of the Average check rather than counted as nothing paid.`;
}

/* ───────────────────────────────────────────────────── 3. spend pacing ── */

/**
 * `rp-registers-trade.tsx` notCountedNote, for the file (F-1009): the orders
 * neither buying figure counts, by kind. Their order value is a figure of its
 * own (money is typed there, not printed inside a sentence). Null when there
 * are none, or the gateway did not say.
 */
function notCountedLine(raw: unknown): string | null {
  const n = obj(raw);
  const approved = num(n.approved) ?? 0;
  const partly = num(n.partlyReceived) ?? 0;
  const other = num(n.other) ?? 0;
  const unpriced = num(n.unpriced) ?? 0;
  const parts = [
    approved > 0
      ? nounCount(approved, "approved order", "approved orders")
      : null,
    partly > 0
      ? nounCount(partly, "partly received order", "partly received orders")
      : null,
    other > 0
      ? nounCount(
          other,
          "order still being negotiated",
          "orders still being negotiated",
        )
      : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) return null;
  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const unpricedLine =
    unpriced > 0
      ? ` ${unpriced} of them ${unpriced === 1 ? "carries" : "carry"} no price, so that order value leaves ${unpriced === 1 ? "it" : "them"} out.`
      : "";
  return `Not in either figure: ${list}, written above at their order value.${unpricedLine} They count once the vendor confirms them or they close.`;
}

/**
 * `rp-registers-trade.tsx` unpricedNotes, for the file (F-1009): an order with
 * no price is left out of the buying sums, and the file says how many, as the
 * screen does — so a short figure is not handed on as the whole one.
 */
function unpricedLines(spendRaw: unknown, committedRaw: unknown): string[] {
  const spend = num(spendRaw) ?? 0;
  const committed = num(committedRaw) ?? 0;
  const out: string[] = [];
  if (spend > 0)
    out.push(
      `${spend} delivered ${spend === 1 ? "order carries" : "orders carry"} no price in these 180 days, so the 30-day buying figures leave ${spend === 1 ? "it" : "them"} out and may be short by what ${spend === 1 ? "it" : "they"} cost.`,
    );
  if (committed > 0)
    out.push(
      `${committed} open ${committed === 1 ? "order carries" : "orders carry"} no price, so Committed, not yet delivered leaves ${committed === 1 ? "it" : "them"} out.`,
    );
  return out;
}

function writePacing(payload: unknown, ctx: WriteCtx): ExportDoc {
  const c = obj(payload);
  const last = num(c.spendLast30d);
  const prev = num(c.spendPrev30d);
  const projection = Array.isArray(c.projectedNext4Weeks)
    ? (c.projectedNext4Weeks as unknown[])
    : null;
  // Two currencies have no one figure (F-1042): the gateway blanks the
  // windows and says why, and the file says it too — never the "no delivered
  // order" sentence, which those blanks would otherwise read as (F-1053).
  const spendNote = str(c.spendNote) || null;
  const committedNote = str(c.committedNote) || null;
  const orderValueNote = str(obj(c.notCounted).orderValueNote) || null;
  const bothZero = !spendNote && (last ?? 0) === 0 && (prev ?? 0) === 0;
  const notCounted = notCountedLine(c.notCounted);
  const basis = obj(c.basis);
  const noFigure = "the cashflow register returned no figure";

  return doc({
    say: spendNote
      ? spendNote
      : bothZero
        ? "No delivered purchase order falls in either 30-day window, so there is no pace to read."
        : null,
    figures: [
      f(
        "Paid out, the last 30 days",
        houseMoney(last, c.spendCurrency, ctx, spendNote ?? noFigure),
        "money",
      ),
      f(
        "Paid out, the 30 days before",
        houseMoney(prev, c.spendCurrency, ctx, spendNote ?? noFigure),
        "money",
      ),
      f(
        "Pace",
        figure(
          pctOf(c.paceDeltaPct),
          spendNote ?? "Needs two comparable 30-day windows",
        ),
        "percent",
      ),
      f(
        "Committed, not yet delivered",
        houseMoney(
          c.committedOpenOrders,
          c.committedCurrency,
          ctx,
          committedNote ?? noFigure,
        ),
        "money",
      ),
      f("Open orders", figure(c.openOrderCount, "the cashflow register returned no figure"), "count"),
      ...(notCounted
        ? [
            f(
              "Not in either figure, at order value",
              houseMoney(
                obj(c.notCounted).orderValue,
                obj(c.notCounted).orderValueCurrency,
                ctx,
                orderValueNote ?? noFigure,
              ),
              "money",
            ),
          ]
        : []),
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
                houseMoney(
                  v,
                  c.spendCurrency,
                  ctx,
                  "the projection returned no figure for this week",
                ),
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
      notCounted ?? "",
      ...unpricedLines(c.spendUnpricedCount, c.committedUnpricedCount),
    ],
    basis: sentences(
      basis.outflow ? `Outflow: ${str(basis.outflow)}.` : null,
      basis.days ? `Days: ${str(basis.days)}.` : null,
      basis.notCounted
        ? `Not in either figure: ${str(basis.notCounted)}.`
        : null,
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
    // How many lines rest on the 750 ml stand-in, and how many carry no
    // bottle figure (ADR 0297).
    basisObj.units,
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
      f("28-day trend, per day", figure(pctOf(w.trendPerDayPct), "the seasonality register returned no trend"), "percent"),
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
    // F-1587: why a costed wine has no margin on a price that includes tax.
    refusal: typeof i.marginRefusal === "string" ? i.marginRefusal : null,
    // F-1645: too few days of sales to place it.
    tooFew: i.tooFewDays === true,
  }));
  const uncosted = "no recorded cost — unknown, not a dog";
  // A costed wine whose sales include a line with no bottle figure has no
  // velocity, so no quadrant — for that reason, not for want of a cost
  // (ADR 0297).
  const unmeasured = "some of its sales carry no bottle figure";
  const count = (k: string) =>
    counts === null
      ? withheld("the register returned no quadrant counts")
      : (num(counts[k]) ?? 0);
  const unclassified = counts === null ? null : (num(counts.unclassified) ?? 0);
  const unmeasuredCount =
    counts === null ? null : (num(counts.unmeasured) ?? 0);
  const taxRefused = counts === null ? null : (num(counts.taxRefused) ?? 0);
  const tooFewCount = counts === null ? null : (num(counts.tooFewDays) ?? 0);
  const tooFew = "under a week of sales on record";
  // F-1667: priced wines on no live menu are not placed; named apart.
  const offMenu = arr(q.offMenu).map((w) => str(w.name));
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
      // Uncosted and unmeasured items both sit outside the four quadrants;
      // the notes say which is which (ADR 0297).
      // F-1670: the screen's own breakdown. A tax refusal and a wine under a
      // week of sales have rows of their own there, so they are not folded
      // into "No quadrant" here: one label, one number, on both.
      f(
        "No quadrant",
        counts === null
          ? count("unclassified")
          : (unclassified ?? 0) + (unmeasuredCount ?? 0),
        "count",
      ),
      ...(tooFewCount && tooFewCount > 0
        ? [f("Under a week of sales", tooFewCount, "count")]
        : []),
      ...(taxRefused && taxRefused > 0
        ? [
            f(
              q.taxBasisUnread === true
                ? "No margin: tax basis not read"
                : "No pre-tax margin",
              taxRefused,
              "count",
            ),
          ]
        : []),
      // F-1667: priced wines on no live menu, named in the notes.
      ...(offMenu.length > 0
        ? [f("Not on any menu", offMenu.length, "count")]
        : []),
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
                figure(
                  i.velocity,
                  i.margin != null ? unmeasured : "no movement figure returned",
                ),
                figure(i.margin, i.refusal ?? uncosted),
                figure(i.marginPct, i.refusal ?? uncosted),
                i.quadrant ??
                  withheld(
                    i.margin == null
                      ? (i.refusal ?? uncosted)
                      : i.tooFew
                        ? tooFew
                        : unmeasured,
                  ),
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
      taxRefused && taxRefused > 0
        ? `${nounCount(taxRefused, "wine has", "wines have")} no margin: the till's prices include tax, so margin is worked out on the price without tax, and each such row says why it could not be.`
        : "",
      unmeasuredCount && unmeasuredCount > 0
        ? `${nounCount(unmeasuredCount, "item has", "items have")} no velocity and no quadrant: some of ${unmeasuredCount === 1 ? "its" : "their"} sales carry no bottle figure.`
        : "",
      tooFewCount && tooFewCount > 0
        ? `${nounCount(tooFewCount, "wine has", "wines have")} no quadrant: ${tooFewCount === 1 ? "it has" : "they have"} been on the list or on record for under a week, too few days to say how fast ${tooFewCount === 1 ? "it moves" : "they move"}.`
        : "",
      cc && cc.complete === false && num(cc.total) != null
        ? `${num(cc.priced) ?? 0} of ${num(cc.total)} wines carry a recorded cost.`
        : "",
      offMenu.length > 0
        ? `Not on any menu, so not placed: ${offMenu.slice(0, 8).join(", ")}${offMenu.length > 8 ? ` and ${offMenu.length - 8} more` : ""}.`
        : "",
    ],
    basis: sentences(b.velocity, b.margin, b.list),
  });
}

/* ──────────────────────────────────────────────── 7. figures of record ── */

function writeLedger(payload: unknown, ctx: WriteCtx): ExportDoc {
  const d = obj(payload);
  const b = obj(d.basis);
  const cc = d.costCoverage == null ? null : obj(d.costCoverage);
  const pc = d.priceCoverage == null ? null : obj(d.priceCoverage);
  const costBasis = "Needs a complete cost basis";
  // F-1715: at a house whose till prices include tax, the margins' basis or
  // why they are withheld, as the screen says it; absent elsewhere.
  const taxNote = str(d.marginTaxNote);
  const marginWhy = taxNote || costBasis;
  // F-989: the screen's partly costed cellar (`rp-registers-house.tsx` view):
  // the priced wines' value under its own label, not withheld outright.
  const unpriced = cc ? (num(cc.unpriced) ?? 0) : 0;
  const partial =
    num(d.inventoryValue) == null &&
    num(d.pricedInventoryValue) != null &&
    unpriced > 0;
  const unpricedPrices = pc ? (num(pc.unpriced) ?? 0) : 0;
  const unpricedOrders = num(d.cogsUnpricedCount) ?? 0;
  // F-1216: turns and days divide cost of goods by the cellar. When COGS is in
  // another money, or blank for two moneys, that is why they are withheld, not
  // the cost basis (the gateway's own reason, analytics.service.ts basis.cogs).
  const cogsOwn = str(d.cogsCurrency).trim().toUpperCase();
  const houseOwn = str(d.houseCurrency).trim().toUpperCase();
  // F-1443: a COGS short of its unpriced deliveries is not set against the
  // cellar either; that comes first, as the gateway withholds for it first.
  // F-1491: a house under a month of buying has its own reason, the
  // gateway's `turnsSpanNote`; "a year of delivered orders" was never asked.
  const spanNote = str(d.turnsSpanNote);
  const turnsWhy =
    unpricedOrders > 0 && num(d.cogs) != null
      ? `${unpricedOrders} delivered ${unpricedOrders === 1 ? "order has" : "orders have"} no price, so Cost of goods is short and is not set against the cellar`
      : cogsOwn && houseOwn && cogsOwn !== houseOwn
        ? `Cost of goods is in ${cogsOwn}, not the house's ${houseOwn}, and with no exchange rate on record it is not set against the cellar`
        : str(d.cogsNote)
          ? `Cost of goods is withheld: ${str(d.cogsNote)}`
          : d.turnsSpanShort === true && spanNote
            ? spanNote
            : `${costBasis} and a delivered order with a price`;
  return doc({
    figures: [
      partial
        ? f(
            "Cellar at cost (priced wines)",
            figure(
              d.pricedInventoryValue,
              "No on-hand wine carries a recorded cost",
            ),
            "money",
          )
        : f(
            "Cellar at cost",
            figure(
              d.inventoryValue,
              "Not every on-hand row carries a recorded cost",
            ),
            "money",
          ),
      // F-1054: two currencies blank COGS for their own reason, said here.
      f(
        "Cost of goods (365d)",
        houseMoney(
          d.cogs,
          d.cogsCurrency,
          ctx,
          str(d.cogsNote) ||
            "No delivered order came back for the window — which is either no buying or a read that failed",
        ),
        "money",
      ),
      f(
        "Sell-price valuation",
        figure(
          d.revenue,
          taxNote ||
            "No wine on hand carries a bottle price, or no inventory row came back",
        ),
        "money",
      ),
      f("Gross margin", figure(d.grossMargin, marginWhy), "ratio"),
      f("COGS ratio", figure(d.cogsRatio, marginWhy), "ratio"),
      f("Inventory turns", figure(d.inventoryTurnover, turnsWhy), "count"),
      f(
        "Days of inventory",
        figure(d.daysInventoryOutstanding, turnsWhy),
        "days",
      ),
      f("GMROI", figure(d.gmroi, marginWhy), "count"),
      f("Capital sitting still", figure(d.deadStockCapital, "No movement signal recorded, or an idle row has no cost"), "money"),
    ],
    notes: [
      taxNote,
      cc && cc.complete === false
        ? num(cc.total) === 0
          ? "No on-hand wine carries a recorded cost, so every cost-derived figure above is withheld rather than a total assembled from nothing."
          : partial
            ? `${unpriced} of ${num(cc.total) ?? 0} on-hand wines have no cost yet, so the cellar figure above counts only the ${num(cc.priced) ?? 0} that do, and the figures built on the whole cellar are withheld.`
            : `${num(cc.priced) ?? 0} of ${num(cc.total) ?? 0} on-hand wines carry a recorded cost, so every cost-derived figure above is withheld rather than a total assembled from part of the cellar.`
        : "",
      // F-574 / F-701, as the screen says them.
      unpricedPrices > 0
        ? `${nounCount(unpricedPrices, "wine on hand has", "wines on hand have")} no bottle price, so ${unpricedPrices === 1 ? "it is" : "they are"} left out of the sell-price valuation, the gross margin and the COGS ratio, rather than counted as selling for nothing.`
        : "",
      unpricedOrders > 0
        ? `${unpricedOrders} delivered ${unpricedOrders === 1 ? "order carries" : "orders carry"} no price, so Cost of goods leaves ${unpricedOrders === 1 ? "it" : "them"} out and is short by what ${unpricedOrders === 1 ? "it" : "they"} cost. Inventory turns and Days of inventory are not taken from it.`
        : "",
      // F-1491: the span turns and days of stock are taken over, as the screen says it.
      spanNote,
    ],
    basis: sentences(
      b.revenue,
      b.cogs,
      b.inventoryValue,
      b.turns,
      b.deadStock,
      b.costDerived,
    ),
  });
}

/* ──────────────────────────────────────────────────────── 8. the room ─── */

function writeSeats(payload: unknown): ExportDoc {
  const s = obj(payload);
  const sinceDays = num(s.sinceDays) ?? 90;
  const basis = sentences(
    `Non-voided pos_checks the till attributed to a shown table over the last ${sinceDays} days.`,
    s.revenueBasis === "net" ? REGISTER_NET_SALES : REGISTER_TOTALS_NOT_NET,
    str(s.totalsTaxNote) || null,
    str(s.netSalesTaxNote) || null,
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
  // ADR 0303: tables are learned from the till, so nothing is drawn. A check
  // the till sent without a table, or one at a table the owner hid, is in
  // takings and in no table's figure; the register says how many.
  const withoutTable = num(s.checksWithoutTable) ?? 0;
  const atHidden = num(s.checksAtHiddenTables) ?? 0;
  const hiddenInHouse = num(s.hiddenTablesInHouse) ?? 0;
  const hiddenNote =
    atHidden > 0
      ? `${nounCount(atHidden, "check was", "checks were")} at ${nounCount(num(s.hiddenTables) ?? 0, "hidden table", "hidden tables")}: counted in takings, not shown here.`
      : "";
  if (tables.length === 0)
    return doc({
      say:
        withoutTable > 0
          ? `${nounCount(withoutTable, "check in this window has", "checks in this window have")} no table, so none can be attributed to a seat. They are in takings. A till word with no number in it, such as Booth or a name, makes no table.`
          : atHidden > 0
            ? "No shown table took a check in this window; show a table again under Settings → Point of sale."
            : hiddenInHouse > 0
              ? "Every table in this house is hidden, and this window held no check. Show a table again under Settings → Point of sale."
              : "This house has no table yet, so no check can be attributed to a seat. A table is learned when a check arrives naming one with a number in it, such as T12, 12 or Patio 3; rename or hide it under Settings → Point of sale.",
      notes: [hiddenNote],
      basis,
    });
  const served = tables.filter((t) => t.checks > 0);
  const noCheck = "no check attributed to this table";
  const mapped = `${nounCount(tables.length, "table is", "tables are")} mapped`;
  const empty = emptyWindowLine(s, sinceDays);
  const n = num(s.checksInWindow);
  const none =
    n === 1
      ? `the one check in the last ${sinceDays} days was not`
      : `not one of the ${nounCount(n ?? 0, "check", "checks")} in the last ${sinceDays} days was`;
  return doc({
    say:
      served.length > 0
        ? null
        : empty
          ? `${mapped}. ${empty}`
          : n !== null && n > 0
            ? atHidden > 0
              ? `${mapped}, and ${none} attributed to any of them.`
              : `${mapped}, and ${none} attributed to any of them — an absent attribution, not an empty room.`
            : `${mapped}, and no check in the last ${sinceDays} days was attributed to any of them. This register does not say whether the window held any check, so an empty window and checks that name no table cannot be told apart here.`,
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
          figure(t.revenue, t.checks > 0 ? "net sales not recorded" : noCheck),
          figure(t.avgCheck, noCheck),
          figure(t.wineAttach, noCheck),
        ]),
      },
    ],
    notes: [
      withoutTable > 0
        ? `${nounCount(withoutTable, "check has", "checks have")} no table: counted in takings, not in the room.`
        : "",
      hiddenNote,
      (num(s.checksTakingNoMoney) ?? 0) > 0
        ? zeroChecksSaid(num(s.checksTakingNoMoney) ?? 0)
        : "",
      (num(s.checksRefunded) ?? 0) > 0
        ? refundChecksSaid(num(s.checksRefunded) ?? 0)
        : "",
      (num(s.checksWithoutNet) ?? 0) > 0
        ? checksWithoutNetSaid(num(s.checksWithoutNet) ?? 0)
        : "",
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
    s.revenueBasis === "net" ? REGISTER_NET_SALES : REGISTER_TOTALS_NOT_NET,
    str(s.totalsTaxNote) || null,
    str(s.netSalesTaxNote) || null,
    s.tipBasis === "net" ? REGISTER_TIP_ON_NET : null,
    // F-1573: the gateway's own reason when Tip is not (all) over net sales.
    str(s.tipBasisWhy) || null,
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
    tipWhy: str(w.tipPctWhy),
  }));
  const figures = [
    f("Servers with a check", waiters.length, "count"),
    f("Table-adjusted fit (R²)", figure(adj ? adj.r2 : null, "Needs 10 checks across at least two tables before a server can be separated from their section"), "ratio"),
  ];
  if (waiters.length === 0) {
    const n = num(s.checksInWindow);
    const none =
      n === 1
        ? `The one check in the last ${sinceDays} days carries no`
        : `None of the ${nounCount(n ?? 0, "check", "checks")} in the last ${sinceDays} days carries a`;
    return doc({
      say:
        emptyWindowLine(s, sinceDays) ??
        (n !== null && n > 0
          ? `${none} server name, so nothing can be attributed to anyone. That is an absent field on the POS feed, not a shift nobody worked.`
          : `No check in the last ${sinceDays} days names a server. This register does not say whether the window held any check, so an empty window and checks that carry no server name cannot be told apart here.`),
      figures,
      basis,
    });
  }
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
          figure(
            w.revenue,
            (w.checks ?? 0) > 0 ? "net sales not recorded" : none,
          ),
          figure(w.avgCheck, none),
          figure(w.wineAttach, none),
          // F-1573: tips with no amount before tax are not "no tip".
          figure(w.tip, w.tipWhy || "no tip recorded on this server's checks"),
        ]),
      },
    ],
    notes: [
      "A server's raw average is partly the section they were given. The adjusted fit is the engine's attempt to remove it; where it is withheld, the raw figures are all there is.",
      (num(s.checksTakingNoMoney) ?? 0) > 0
        ? zeroChecksSaid(num(s.checksTakingNoMoney) ?? 0)
        : "",
      (num(s.checksRefunded) ?? 0) > 0
        ? refundChecksSaid(num(s.checksRefunded) ?? 0)
        : "",
      (num(s.checksWithoutNet) ?? 0) > 0
        ? checksWithoutNetSaid(num(s.checksWithoutNet) ?? 0)
        : "",
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

function writeBench(payload: unknown, ctx: WriteCtx): ExportDoc {
  const d = obj(payload);
  const cashflowMissing = d.cashflow == null;
  const seasonalityMissing = d.seasonality == null;
  const cf = obj(d.cashflow);
  const se = obj(d.seasonality);
  const cfMissing = "the cashflow lens did not answer inside the overview call";
  const seMissing = "the weekday lens did not answer inside the overview call";
  const cfWhy = cashflowMissing ? cfMissing : "the cashflow register returned no figure";
  const tie = se.tie === true;
  // F-573: a null goals lens is a read that failed, not "no goal is running".
  // Each goal is typed by its metric's unit, and its current figure is the
  // reading stored when the goal was last opened, so it is named that way.
  const goalsUnread = d.activeGoals == null;
  const goalsMissing = "the goals did not answer inside the overview call";
  const goals = arr(d.activeGoals).map((g) => ({
    name: str(g.name) || "Untitled goal",
    unit: goalUnit(str(g.unit) || "count"),
    baseline: num(g.baseline_value),
    current: num(g.current_value),
    target: num(g.target_value),
  }));
  const last = num(cf.spendLast30d);
  const prev = num(cf.spendPrev30d);
  // F-1053: two currencies blank the buying windows; say so, not "no figure".
  const spendNote = cashflowMissing ? null : str(cf.spendNote) || null;
  const committedNote = cashflowMissing ? null : str(cf.committedNote) || null;
  const spendWhy = spendNote ?? cfWhy;
  const paceWhy =
    spendNote ??
    (cashflowMissing
      ? cfMissing
      : "the server withholds a pace when the two windows are not comparable");
  const noPeers =
    "No other house is in this comparison. Mudavym holds only this restaurant's books, so there is no market median to stand beside these figures — every one of them is this house against its own past.";

  const rows: Cell[][] = [
    [
      "Buying, the last 30 days against the 30 before",
      houseMoneyCell(last, cf.spendCurrency, ctx, spendWhy),
      houseMoneyCell(prev, cf.spendCurrency, ctx, spendWhy),
      typed(pctOf(cf.paceDeltaPct), "percent", paceWhy),
    ],
    [
      "The week's own extremes (busiest, quietest, trend per day)",
      seasonalityMissing ? withheld(seMissing) : tie ? withheld("shared — more than one weekday holds the extreme") : typeof se.bestDay === "string" ? se.bestDay : withheld("no weekday is separable"),
      seasonalityMissing ? withheld(seMissing) : tie ? withheld("shared — more than one weekday holds the extreme") : typeof se.worstDay === "string" ? se.worstDay : withheld("no weekday is separable"),
      typed(pctOf(se.trendPerDayPct), "percent", seasonalityMissing ? seMissing : "the seasonality register returned no trend"),
    ],
    ...arr(se.weekdayProfile).map((w): Cell[] => [
      `${str(w.day)}, mean per service`,
      typed(w.mean, "bottles", "no observation on this weekday"),
      typed(w.n, "count", "no observation count returned"),
      null,
    ]),
    ...goals.map((g): Cell[] => [
      `${g.name} — baseline, last read, target`,
      typed(g.baseline, g.unit, "no baseline recorded when the goal was set"),
      typed(g.current, g.unit, "the goal's current value was not recorded"),
      typed(g.target, g.unit, "no target recorded"),
    ]),
  ];

  return doc({
    say:
      cashflowMissing && seasonalityMissing && goalsUnread
        ? "Nothing in the overview register answered — neither the buying lens, the weekday lens nor the goals returned."
        : cashflowMissing && seasonalityMissing && goals.length === 0
          ? "Nothing in the overview register answered — neither the buying lens nor the weekday lens returned, and no goal is running."
          : null,
    figures: [
      f(
        "Bought, the last 30 days",
        houseMoney(last, cf.spendCurrency, ctx, spendWhy),
        "money",
      ),
      f(
        "Bought, the 30 before",
        houseMoney(prev, cf.spendCurrency, ctx, spendWhy),
        "money",
      ),
      f(
        "Pace, the last 30 days (today so far) against the 30 before",
        figure(pctOf(cf.paceDeltaPct), paceWhy),
        "percent",
      ),
      f(
        "Committed, not yet delivered",
        houseMoney(
          cf.committedOpenOrders,
          cf.committedCurrency,
          ctx,
          committedNote ?? cfWhy,
        ),
        "money",
      ),
      f("Trend per day, last 28 days", figure(pctOf(se.trendPerDayPct), seasonalityMissing ? seMissing : "the seasonality register returned no trend"), "percent"),
      f(
        "Goals running",
        goalsUnread ? withheld(goalsMissing) : goals.length,
        "count",
      ),
    ],
    tables: [
      {
        title: "Against its own past",
        columns: [
          { label: "Against", unit: "text" },
          { label: "Then / busiest / baseline", unit: "text" },
          { label: "Now / quietest / last read", unit: "text" },
          { label: "Change / trend / target", unit: "text" },
        ],
        rows,
      },
    ],
    notes: [
      noPeers,
      ...(cashflowMissing
        ? []
        : unpricedLines(cf.spendUnpricedCount, cf.committedUnpricedCount)),
      spendNote ?? "",
      committedNote ?? "",
      last === 0 && prev === 0
        ? 'Both buying windows came back at zero, and the zeros are ambiguous: the cashflow lens sums a loader that returns an empty list for a failed query as well as for a quiet month, so zero means "no delivered order was returned", not necessarily "nothing was bought".'
        : "",
      goalsUnread
        ? "The goals could not be read inside the overview call, so whether any goal is running is not known."
        : goals.length === 0
          ? "No goal is running, so there is nothing to measure against a baseline."
          : "Each goal's middle figure is its reading from the last time the goal was opened on the goals desk, not a live count.",
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
      paceUnread: str(entry.paceUnread) || null,
      // A Bottles sold goal's lines on the 750 ml stand-in (ADR 0297).
      standInLines: num(obj(entry.units).standInLines) ?? 0,
      standInItems: num(obj(entry.units).standInItems) ?? 0,
      // w109-gross-basis: an Average check or Wine revenue goal at a house
      // whose till prices include tax.
      taxNote: str(entry.taxNote) || null,
    };
  });
  const total = num(d.total) ?? goals.length;
  const paced = goals.some((g) => g.onTrack !== null);
  // "No deadline" only when no goal carries one. A goal with a deadline and no
  // pace (a house with no time zone, ADR 0296; a goal that could not be read)
  // is not a goal without a deadline.
  const noPace = goals.some((g) => g.deadline !== null)
    ? "no goal's pace was judged; each goal's row says why"
    : "no goal carries a deadline, so none has a pace";
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
                  g.onTrack === null ? withheld(g.paceUnread ?? (g.deadline ? "the pace was not computed" : "no deadline, so no pace")) : g.onTrack ? "on pace" : "behind",
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
      ...goals
        .filter((g) => g.standInLines > 0)
        .map(
          (g) =>
            `${g.name}: ${nounCount(g.standInLines, "glass line", "glass lines")} across ${nounCount(g.standInItems, "item", "items")} with no stated bottle size ${g.standInLines === 1 ? "is" : "are"} read at the 750 ml stand-in the stock moves by.`,
        ),
      ...goals
        .filter((g) => g.taxNote && !g.unreadable)
        .map((g) => `${g.name}: ${g.taxNote}`),
    ],
    basis: sentences(b.current, b.peers, b.units),
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
    till: {
      title: "Through the till",
      window: (days) =>
        `the last ${days ?? 30} days of POS checks, today so far`,
      takesWindow: true,
      write: writeTill,
    },
    goals: { title: "Goals", window: () => "each goal counted from the day it was set", takesWindow: false, write: writeGoals },
    bench: { title: "Against ourselves", window: () => "180 days of buying, 90 days of weekdays, each goal since it was set", takesWindow: false, write: writeBench },
    pacing: {
      title: "Spend pacing",
      window: () =>
        "180 days of purchasing, compared in two 30-day windows, the last one ending today so far",
      takesWindow: false,
      write: writePacing,
    },
    week: { title: "The week’s shape", window: () => "the last 90 days of the consumption log", takesWindow: false, write: writeWeek },
    ahead: {
      title: "What’s coming",
      window: () =>
        "up to 120 days of history, from the first sale through yesterday; 14 days ahead",
      takesWindow: false,
      write: writeAhead,
    },
    quadrants: {
      title: "Margin against movement",
      window: () =>
        "the wines on your live Drinks and Desserts menus (your priced stock when no Drinks menu is live), each against its own days on the list, up to 90 days to yesterday",
      takesWindow: false,
      write: writeQuadrants,
    },
    ledger: {
      title: "Figures of record",
      window: () =>
        "365 days of COGS; turns over up to a year of buying; the cellar as it stands today",
      takesWindow: false,
      write: writeLedger,
    },
    seats: { title: "The room", window: () => "the last 90 days of POS checks", takesWindow: false, write: writeSeats },
    service: { title: "Who served it", window: () => "the last 90 days of POS checks", takesWindow: false, write: writeService },
    restock: {
      title: "What to buy back",
      window: () =>
        "demand over the last 90 days to yesterday, not counting today until it is over, at the service level in the params",
      takesWindow: false,
      write: writeRestock,
    },
  });

export { countWithheld };
export type { ExportDoc, ExportTable };
