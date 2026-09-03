/**
 * The cuttings — one body per register on the sheet.
 *
 * Every number below comes from an endpoint in `useReportsNextData`; every
 * unknown is an em dash; every failure is a sentence naming the register that
 * could not be read. Nothing here computes a figure the engine did not
 * produce, and nothing rounds a `null` down to a zero on the way to a chart.
 *
 * The recurring judgement in this file is when a chart is the WRONG rendering
 * of a true answer. A weekday profile of seven zeros, two spend bars both at
 * zero, a forecast with no fitted model: all three are honest data that draw
 * as an empty frame, and an empty frame reads as "this page is broken" or, far
 * worse, as "the restaurant did nothing". Each of those cases says the
 * sentence instead — and names the window it is speaking about.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaSeries,
  BarSeries,
  FigureRow,
  ForecastSeries,
  Nothing,
  QuadrantPlot,
  RegisterBody,
  Working,
} from './rp-plot';
import { EM, MONO, countOf, figure, money, pct, ratioPct, shortDay } from './rp-format';
import { BLOCK_META } from './rp-sheet';
import type {
  AheadRegister,
  LedgerRegister,
  PacingRegister,
  QuadrantRegister,
  ReadingRow,
  Register,
  TillWindow,
  WeekRegister,
} from './useReportsNextData';

/** The engine's own category names, in the reader's words. */
const CATEGORY_LABEL: Record<string, string> = {
  sales: 'Sales',
  purchasing: 'Buying',
  inventory: 'Stock',
  efficiency: 'Efficiency',
  tables: 'Tables',
  staff: 'Team',
  basket: 'Pairings',
  risk: 'Watch out',
  forecast: 'Coming up',
  goals: 'Goals',
};

/* ─────────────────────────────────────────────────────── 1. the reading ── */

/**
 * The engine's sentences, verbatim. The founder asked for "more focus on the
 * insights", and the honest way to give an insight feed more weight is more
 * of it — not a bigger typeface on a summary somebody wrote by hand. Chips
 * filter to the categories this restaurant ACTUALLY has sentences for; a
 * category with nothing in it is not offered.
 */
export function ReadingCutting({ reg }: { reg: Register<ReadingRow[]> }) {
  const [only, setOnly] = useState<string | null>(null);
  return (
    <RegisterBody
      register={BLOCK_META.reading.register}
      loading={reg.loading}
      failure={reg.failure}
      data={reg.data}
      onRetry={reg.refetch}
    >
      {(rows) => {
        if (rows.length === 0)
          return (
            <Nothing>
              The engine has produced no insight for this restaurant yet. It computes hourly and on
              demand — there is nothing to say, rather than nothing to show.
            </Nothing>
          );
        const cats = Array.from(new Set(rows.map((r) => r.category)));
        const shown = only ? rows.filter((r) => r.category === only) : rows;
        return (
          <>
            <div className="rp-row">
              {cats.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="rp-chip rp-ink rp-focus rp-no-drag"
                  aria-pressed={only === c}
                  onClick={() => setOnly(only === c ? null : c)}
                >
                  {CATEGORY_LABEL[c] ?? c}
                </button>
              ))}
            </div>
            <ul className="rp-list">
              {shown.slice(0, 24).map((r) => (
                <li key={r.ruleKey} style={{ display: 'grid', gap: 3 }}>
                  <span className="rp-row">
                    <span className="rp-tag">{CATEGORY_LABEL[r.category] ?? r.category}</span>
                    {r.entityLabel && <span className="rp-cap">{r.entityLabel}</span>}
                  </span>
                  {/* Verbatim engine sentence — never reworded on this page. */}
                  <p className="rp-sentence">{r.sentence}</p>
                </li>
              ))}
            </ul>
            <Working
              lines={[
                `${countOf(rows.length, 'sentence', 'sentences')} read from the stored insight feed; every number in them was computed by the engine from this restaurant's own rows.`,
                'Sentences are printed as the engine wrote them. This page never composes one.',
              ]}
            />
          </>
        );
      }}
    </RegisterBody>
  );
}

/* ────────────────────────────────────────────────────── 2. the till ────── */

export function TillCutting({ reg }: { reg: Register<TillWindow> }) {
  return (
    <RegisterBody
      register={BLOCK_META.till.register}
      loading={reg.loading}
      failure={reg.failure}
      data={reg.data}
      onRetry={reg.refetch}
    >
      {(w) => {
        if (!w.posConnected)
          return (
            <>
              <Nothing>
                No POS check has ever landed for this restaurant, so there is no sales revenue to
                read. That is an absent feed, not a day of {money(0)} — nothing is drawn here.
              </Nothing>
              <Link to="/settings?tab=pos" className="rp-link rp-ink rp-focus rp-no-drag">
                Connect a till in Settings
              </Link>
            </>
          );
        const points = w.dailySeries.map((d) => ({ label: shortDay(d.date), value: d.revenue }));
        const avg =
          w.revenue != null && w.checkCount != null && w.checkCount > 0
            ? w.revenue / w.checkCount
            : null;
        return (
          <>
            <dl className="rp-dl">
              <FigureRow label="Taken" value={money(w.revenue)} note="No POS revenue recorded" />
              <FigureRow label="Checks" value={figure(w.checkCount)} />
              <FigureRow
                label="Average check"
                value={money(avg, 'table')}
                note="Needs both revenue and a check count"
              />
            </dl>
            {points.length === 0 ? (
              <Nothing>The till answered, and no check fell inside this window.</Nothing>
            ) : (
              <AreaSeries data={points} unit="taken" />
            )}
            <Working
              lines={[
                `Non-voided pos_checks.total between ${w.from || EM} and ${w.to || EM}.`,
                'The series is sparse on purpose: a day with no check is absent, not plotted at zero.',
              ]}
            />
          </>
        );
      }}
    </RegisterBody>
  );
}

/* ───────────────────────────────────────────────────── 3. spend pacing ── */

export function PacingCutting({ reg }: { reg: Register<PacingRegister> }) {
  return (
    <RegisterBody
      register={BLOCK_META.pacing.register}
      loading={reg.loading}
      failure={reg.failure}
      data={reg.data}
      onRetry={reg.refetch}
    >
      {(c) => {
        const bars = [
          { label: 'Prev 30', value: c.spendPrev30d },
          { label: 'Last 30', value: c.spendLast30d },
        ];
        const projection = c.projectedNext4Weeks;
        // Two invisible bars are not a chart. When both windows are empty the
        // sentence is the honest rendering — and it names WHICH windows.
        const nothingPaid = (c.spendLast30d ?? 0) === 0 && (c.spendPrev30d ?? 0) === 0;
        return (
          <>
            {nothingPaid ? (
              <Nothing>
                No delivered purchase order falls in either 30-day window, so there is no pace to
                draw — two bars at zero would say the same thing less clearly.
              </Nothing>
            ) : (
              <BarSeries data={bars} unit="paid out" />
            )}
            <dl className="rp-dl">
              <FigureRow
                label="Pace"
                value={pct(c.paceDeltaPct)}
                note="Needs two comparable 30-day windows"
              />
              <FigureRow label="Committed, not yet delivered" value={money(c.committedOpenOrders)} />
              <FigureRow label="Open orders" value={figure(c.openOrderCount)} />
            </dl>
            {projection && projection.length > 0 ? (
              <p className="rp-cap">
                Projected, next four weeks:{' '}
                <span style={{ fontFamily: MONO }}>
                  {projection.map((v) => money(v, 'compact')).join(' · ')}
                </span>{' '}
                — a Holt projection, not a measurement.
              </p>
            ) : (
              <p className="rp-cap">
                Too few weeks of purchasing to project — {EM} rather than a line drawn through two
                points.
              </p>
            )}
            <Working lines={[c.basis?.outflow ? `Outflow: ${c.basis.outflow}.` : null]} />
          </>
        );
      }}
    </RegisterBody>
  );
}

/* ───────────────────────────────────────────────── 4. the week's shape ── */

export function WeekCutting({ reg }: { reg: Register<WeekRegister> }) {
  return (
    <RegisterBody
      register={BLOCK_META.week.register}
      loading={reg.loading}
      failure={reg.failure}
      data={reg.data}
      onRetry={reg.refetch}
    >
      {(w) => {
        const bars = w.weekdayProfile.map((d) => ({
          label: d.day.slice(0, 3),
          value: d.n > 0 ? Number(d.mean.toFixed(2)) : null,
        }));
        if (bars.length === 0)
          return (
            <Nothing>
              No consumption is recorded in the last 90 days, so the week has no shape yet.
            </Nothing>
          );
        const flat = bars.every((b) => (b.value ?? 0) === 0);
        // A tie is not a ranking. The engine breaks one arbitrarily, so a
        // "busiest day" that is also the quietest day is no answer at all —
        // printing both would invent a pattern out of a flat week.
        const ranked = !flat && w.bestDay !== null && w.bestDay !== w.worstDay;
        return (
          <>
            {flat ? (
              <Nothing>
                Every weekday reads zero over the last 90 days — the consumption log recorded no
                movement, so the week has no shape to draw yet.
              </Nothing>
            ) : (
              <BarSeries data={bars} unit="bottles/day" />
            )}
            <dl className="rp-dl">
              <FigureRow
                label="Busiest day"
                value={ranked ? (w.bestDay as string) : EM}
                note="No day stands out from the others yet"
              />
              <FigureRow
                label="Quietest day"
                value={ranked ? (w.worstDay as string) : EM}
                note="No day stands out from the others yet"
              />
              <FigureRow label="28-day trend" value={pct(w.trendPerDayPct, 2)} />
            </dl>
            <Working
              lines={[
                'Mean units per weekday over the last 90 days of wine_consumption_log; a weekday with no observations is left blank rather than drawn at zero.',
                ranked
                  ? null
                  : 'Busiest and quietest read — because no weekday is distinguishable from the rest on this history.',
              ]}
            />
          </>
        );
      }}
    </RegisterBody>
  );
}

/* ───────────────────────────────────────────────────── 5. what's coming ── */

export function AheadCutting({ reg }: { reg: Register<AheadRegister> }) {
  return (
    <RegisterBody
      register={BLOCK_META.ahead.register}
      loading={reg.loading}
      failure={reg.failure}
      data={reg.data}
      onRetry={reg.refetch}
    >
      {(a) => {
        // No forecast points means every model failed to fit this history.
        // The endpoint still returns `totalForecastDemand: 0` in that case
        // (analytics.service.ts: `result ? sum : 0`) — a zero standing in for
        // an absent model. It is not printed; the absence is said instead.
        if (a.forecast.length === 0)
          return (
            <Nothing>
              There is too little consumption history to fit a model, so nothing is projected. No
              line is drawn and no total is claimed.
            </Nothing>
          );
        const tail = 28;
        const values = a.history.values.slice(-tail);
        const hist = a.history.dates.slice(-tail).map((d, i) => ({
          label: shortDay(d),
          measured: values[i] ?? null,
          projected: null as number | null,
        }));
        const seam = hist.length > 0 ? hist[hist.length - 1] : null;
        const fut = a.forecast.map((f) => ({
          label: shortDay(f.date),
          measured: null as number | null,
          projected: f.value,
        }));
        // The seam carries both series so the dashed run starts where the
        // measured one ends, instead of floating a gap between them.
        if (seam) seam.projected = seam.measured;
        return (
          <>
            <ForecastSeries data={[...hist, ...fut]} splitAt={seam?.label ?? null} unit="bottles" />
            <dl className="rp-dl">
              <FigureRow label={`Next ${a.horizon} days`} value={figure(a.totalForecastDemand)} />
              <FigureRow
                label="Backtest error (MAPE)"
                value={a.accuracy?.mape == null ? EM : ratioPct(a.accuracy.mape / 100, 1)}
                note="Not scoreable on this history"
              />
              <FigureRow label="Model" value={a.model || EM} />
            </dl>
            <p className="rp-cap">
              The dashed run is projected. It is the model’s expectation, not trade that happened.
              {a.history.values.every((v) => v === 0) &&
                ' Every day of the 120-day history reads zero, so the model is projecting from an empty log — the flat line is what it has seen, not a claim about what will sell.'}
            </p>
            <Working
              lines={[
                a.accuracy?.basis,
                `Scored on ${figure(a.accuracy?.scoredPoints)} out-of-sample points.`,
              ]}
            />
          </>
        );
      }}
    </RegisterBody>
  );
}

/* ────────────────────────────────────────── 6. margin against movement ── */

export function QuadrantsCutting({ reg }: { reg: Register<QuadrantRegister> }) {
  return (
    <RegisterBody
      register={BLOCK_META.quadrants.register}
      loading={reg.loading}
      failure={reg.failure}
      data={reg.data}
      onRetry={reg.refetch}
    >
      {(q) => {
        const points = q.items
          .filter((i) => i.marginPerBottle != null)
          .map((i) => ({
            x: Number(i.velocityPerDay.toFixed(3)),
            y: Number((i.marginPerBottle as number).toFixed(2)),
            name: i.name,
          }));
        const unclassified = q.counts.unclassified ?? 0;
        if (points.length === 0)
          return (
            <Nothing>
              No wine on the list carries both a recorded cost and a menu price, so there is no
              margin axis to plot against.
              {unclassified > 0
                ? ` ${countOf(unclassified, 'wine is', 'wines are')} unclassified for that reason — not because they sell badly.`
                : ' Nothing is filed in a quadrant, and nothing is guessed into one.'}
            </Nothing>
          );
        return (
          <>
            <QuadrantPlot
              points={points}
              medianX={q.medians.velocityPerDay}
              medianY={q.medians.marginPerBottle}
            />
            <div className="rp-row">
              <span className="rp-tag">{`Stars ${q.counts.star ?? 0}`}</span>
              <span className="rp-tag">{`Plowhorses ${q.counts.plowhorse ?? 0}`}</span>
              <span className="rp-tag">{`Puzzles ${q.counts.puzzle ?? 0}`}</span>
              <span className="rp-tag">{`Dogs ${q.counts.dog ?? 0}`}</span>
              <span className="rp-tag">{`No quadrant ${unclassified}`}</span>
            </div>
            <p className="rp-cap">
              Fast is right of the vertical rule, fat-margin is above the horizontal one; both rules
              are the engine’s own medians. {countOf(unclassified, 'wine is', 'wines are')} off the
              plot for want of a recorded cost — an uncosted wine is unknown, not a dog.
            </p>
            <Working lines={[q.basis?.velocity, q.basis?.margin]} />
          </>
        );
      }}
    </RegisterBody>
  );
}

/* ──────────────────────────────────────────────── 7. figures of record ── */

export function LedgerCutting({ reg }: { reg: Register<LedgerRegister> }) {
  return (
    <RegisterBody
      register={BLOCK_META.ledger.register}
      loading={reg.loading}
      failure={reg.failure}
      data={reg.data}
      onRetry={reg.refetch}
    >
      {(f) => {
        const cc = f.costCoverage;
        return (
          <>
            <dl className="rp-dl">
              <FigureRow
                label="Cellar at cost"
                value={money(f.inventoryValue)}
                note="Not every on-hand row carries a recorded cost"
              />
              <FigureRow label="Cost of goods (365d)" value={money(f.cogs)} />
              <FigureRow
                label="Gross margin"
                value={ratioPct(f.grossMargin)}
                note="Needs a complete cost basis"
              />
              <FigureRow label="COGS ratio" value={ratioPct(f.cogsRatio)} />
              <FigureRow label="Inventory turns" value={figure(f.inventoryTurnover)} />
              <FigureRow label="Days of inventory" value={figure(f.daysInventoryOutstanding)} />
              <FigureRow label="GMROI" value={figure(f.gmroi)} />
              <FigureRow
                label="Capital sitting still"
                value={money(f.deadStockCapital)}
                note="No movement signal recorded, or an idle row has no cost"
              />
            </dl>
            {cc && !cc.complete && (
              <p className="rp-cap">
                {cc.total === 0
                  ? `No on-hand wine carries a recorded cost, so every cost-derived figure above reads ${EM} rather than a total assembled from nothing.`
                  : `${figure(cc.priced)} of ${figure(cc.total)} on-hand wines carry a recorded cost, so every cost-derived figure above reads ${EM} rather than a total assembled from part of the cellar.`}
              </p>
            )}
            <Working lines={[f.basis?.revenue, f.basis?.inventoryValue, f.basis?.deadStock]} />
          </>
        );
      }}
    </RegisterBody>
  );
}

/* ───────────────────────────────────────────────── 8. the writing desk ── */

/**
 * The report generator, told the truth about.
 *
 * `POST /reports/generate` inserts a `generated_reports` row with
 * `status: "pending"` and a NULL `pdf_url`, and NOTHING in the repo — gateway,
 * orchestrator, worker — ever fills it in (OD-81; `/communications` deleted its
 * own copy of this button for the same reason, and the shipping Reports page
 * mounts `<ReportGenerator>` with no `onGenerate` at all, `Reports.tsx:911-917`).
 * So the control is rendered disabled with one line saying why, and the archive
 * that DOES hold real documents is one link away. A button that lies is worse
 * than no button.
 */
export function WritingCutting() {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p className="rp-note">
        Nothing writes a report yet. The endpoint behind “generate” files a row marked{' '}
        <span style={{ fontFamily: MONO }}>pending</span> with no document attached, and no worker
        in this product ever fills it in — so the button is off rather than pretending (OD-81).
      </p>
      <div className="rp-row" style={{ gap: 10 }}>
        <button type="button" className="rp-btn" disabled title="No report writer exists yet — OD-81">
          Write this sheet up
        </button>
        <Link to="/documents-reports" className="rp-link rp-ink rp-focus rp-no-drag">
          Open the document archive
        </Link>
      </div>
    </div>
  );
}

/** Window picker for the till cutting — the only period control on the sheet. */
export function TillWindowPicker({
  days,
  onChange,
}: {
  days: number;
  onChange: (d: number) => void;
}) {
  const options = useMemo(() => [7, 30, 90], []);
  return (
    <div role="group" aria-label="Till window" style={{ display: 'flex', gap: 3 }}>
      {options.map((d) => (
        <button
          key={d}
          type="button"
          className="rp-chip rp-ink rp-focus rp-no-drag"
          aria-pressed={days === d}
          onClick={() => onChange(d)}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}
