/**
 * The Roll Call — the scorecard as the second view of /providers (sketch 117
 * direction B, grafted onto A by the founder's pick of 2026-09-21; ADR 0207).
 *
 * Every vendor of the house on one table, five measures across, every cell a
 * count over a count with the prior window beneath it. Rows are ordered by
 * orders on the on-time line — a scanning order, not a rank. Sorting by a
 * measure sends the vendors that cannot score on it to the bottom, IN THEIR OWN
 * GROUP under a rule that says so: "too few" never ranks above or below a real
 * figure.
 *
 * A cell that has not earned a figure is words with the count that explains
 * it. A register that failed is written into every cell of its column, not
 * once in a banner someone scrolls past. A table with no rows is not drawn.
 * Tone is not a column.
 *
 * At phone width the same rows become one block per vendor — the cells carry
 * their own column label there — so the page never scrolls sideways.
 *
 * The founder's rulings of 2026-09-21: every cell is a percent with its count;
 * five records everywhere before a percent shows, so sorting by credits ranks
 * only vendors with five claims or more and lists the rest apart; formats are
 * the house's own, words in `sc-copy.ts`.
 */

import { Fragment, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ink } from '../../../../lib/mudavym/motion';
import { MONO, SANS, SERIF } from '../pv-format';
import { DocketSheet } from './DocketSheet';
import { WindowChips } from './LedgerCard';
import { SC } from './sc-copy';
import { figureOf, formatsOf, rowsLabel, windowLabel } from './sc-format';
import type { Formats } from './sc-format';
import type { MeasureKey, MeasureResult, VendorScorecard, WindowDays } from './scorecard-types';
import { serverMessage, useRollCall } from './useVendorScorecard';

const COLUMNS = SC.roll.columns;

type SortKey = 'deliveries' | MeasureKey;

/**
 * A comparable number for a scored cell; null when it cannot be ranked. Only an
 * ANSWERED measure ranks — under five records it is `too_few` and has no value
 * (question 2: "5 everywhere", credits included).
 */
function rankOf(m: MeasureResult): number | null {
  if (m.outcome !== 'answered' || m.value === null) return null;
  // Faster replies first; every other measure, the higher share first.
  return m.key === 'replyTime' ? -m.value : m.value;
}

/**
 * The line under a cell. A failed register names its reason; a prior window
 * with nothing in it says so in two words; and a cell that already reads
 * "nothing to score" does not repeat that the window before held nothing too.
 */
function priorLine(m: MeasureResult): string | null {
  if (m.outcome === 'could_not_read') return m.reason ?? SC.figure.didNotAnswer;
  const priorEmpty = m.prior.outcome === 'too_few' && m.prior.sample === 0;
  if (priorEmpty && m.outcome === 'too_few' && m.sample === 0) return null;
  if (priorEmpty) return SC.roll.priorNone;
  return m.priorSentence;
}

function measureOf(v: VendorScorecard, key: MeasureKey): MeasureResult {
  return v.measures.find((m) => m.key === key) as MeasureResult;
}

function Cell({
  v,
  m,
  label,
  f,
  onOpen,
}: {
  v: VendorScorecard;
  m: MeasureResult;
  label: string;
  f: Formats;
  onOpen: () => void;
}) {
  const fig = figureOf(m.key, m, f);
  return (
    <div role="cell" className="rc-cell">
      <span className="rc-cell-label">{label}</span>
      <button
        type="button"
        onClick={onOpen}
        aria-label={SC.roll.cellAria(v.providerName, label, `${fig.big}${fig.small ? ` ${fig.small}` : ''}`)}
        data-testid={`rc-cell-${v.providerId}-${m.key}`}
        className="rc-cell-btn"
      >
        <span
          style={
            fig.scored
              ? {
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--ink-1, #211C16)',
                }
              : {
                  fontSize: 11.5,
                  fontStyle: 'italic',
                  color: m.outcome === 'could_not_read' ? 'var(--alarm, #A33A2B)' : 'var(--ink-3, #7C7365)',
                }
          }
        >
          {fig.big}
          {fig.small && (
            <span
              style={{
                fontFamily: MONO,
                fontSize: 10,
                fontWeight: 400,
                fontStyle: 'normal',
                marginLeft: 4,
                color: 'var(--ink-3, #7C7365)',
              }}
            >
              {fig.small}
            </span>
          )}
        </span>
        <span
          style={{
            display: 'block',
            fontFamily: MONO,
            fontSize: 9.5,
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          {priorLine(m)}
        </span>
      </button>
    </div>
  );
}

export function RollCall() {
  const [days, setDays] = useState<WindowDays>(90);
  const [sort, setSort] = useState<SortKey>('deliveries');
  const [open, setOpen] = useState<{
    id: string;
    name: string;
    measure: MeasureKey;
  } | null>(null);
  const q = useRollCall(days);
  const f = formatsOf(q.data?.house);

  const groups = useMemo(() => {
    const vendors = q.data?.vendors ?? [];
    if (sort === 'deliveries') return { scored: vendors, refused: [] as VendorScorecard[] };
    const scored = vendors.filter((v) => rankOf(measureOf(v, sort)) !== null);
    const refused = vendors.filter((v) => rankOf(measureOf(v, sort)) === null);
    scored.sort((a, b) => (rankOf(measureOf(b, sort)) as number) - (rankOf(measureOf(a, sort)) as number));
    return { scored, refused };
  }, [q.data, sort]);

  const sortLabel = sort === 'deliveries' ? null : COLUMNS.find((c) => c.key === sort)?.label;

  const row = (v: VendorScorecard) => (
    <div role="row" key={v.providerId} className="rc-row" data-testid={`rc-row-${v.providerId}`}>
      <div role="rowheader" className="rc-vendor">
        <span
          style={{
            fontFamily: SERIF,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink-1, #211C16)',
          }}
        >
          {v.providerName}
        </span>
        <span
          style={{
            display: 'block',
            fontFamily: MONO,
            fontSize: 9.5,
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          {v.quiet
            ? SC.roll.vendorQuiet(v.window.days)
            : SC.roll.vendorRows(rowsLabel(measureOf(v, 'onTime')), v.window.days)}
        </span>
      </div>
      {COLUMNS.map((c) => (
        <Cell
          key={c.key}
          v={v}
          m={measureOf(v, c.key)}
          label={c.label}
          f={f}
          onOpen={() => setOpen({ id: v.providerId, name: v.providerName, measure: c.key })}
        />
      ))}
    </div>
  );

  return (
    <section data-testid="roll-call" style={{ fontFamily: SANS }}>
      <style>{`
        .rc-row { display: grid; grid-template-columns: minmax(150px, 1.3fr) repeat(5, minmax(0, 1fr)); gap: 8px; align-items: start; padding: 10px 0; border-top: 1px solid var(--paper-2, #EAE4D8) }
        .rc-head { border-top: 0; padding: 0 0 6px }
        .rc-cell-label { display: none }
        .rc-cell-btn { display: block; width: 100%; text-align: left; padding: 4px 6px; border-radius: 8px; border: 1px solid transparent; background: transparent; cursor: pointer; font-family: inherit; transition: border-color ${ink.ms}ms ${ink.easing}, background ${ink.ms}ms ${ink.easing} }
        .rc-cell-btn:hover { border-color: var(--paper-2, #EAE4D8); background: var(--paper-1, #F3EFE6) }
        .rc-cell-btn:focus-visible, .rc-sort:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: 2px }
        .rc-sort { text-align: left; padding: 0; border: 0; background: transparent; cursor: pointer; font-family: inherit }
        @media (max-width: 760px) {
          .rc-row { grid-template-columns: 1fr 1fr; gap: 4px 10px; padding: 12px 0 }
          .rc-vendor { grid-column: 1 / -1 }
          .rc-head { display: none }
          .rc-cell-label { display: block; font-family: ${MONO}; font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-3, #7C7365); padding: 0 6px }
        }
        @media (prefers-reduced-motion: reduce) { .rc-cell-btn { transition: none !important } }
      `}</style>

      <div className="flex flex-wrap items-center justify-between gap-2" style={{ margin: '0 0 10px' }}>
        <WindowChips value={days} onChange={setDays} />
        {q.data && (
          <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
            {SC.roll.header(windowLabel(q.data.window.from, q.data.window.to, f), days)}
            {sortLabel ? SC.roll.orderedByMeasure(sortLabel) : SC.roll.orderedByOrders}
          </span>
        )}
      </div>

      {q.isError ? (
        <p
          role="alert"
          style={{
            display: 'flex',
            gap: 6,
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.45,
            color: 'var(--alarm, #A33A2B)',
          }}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ marginTop: 2 }} />
          <span>
            {serverMessage(q.error, SC.roll.readFailed)} {SC.roll.readFailedTail}
          </span>
        </p>
      ) : !q.data ? (
        <p aria-busy="true" style={{ fontSize: 12, color: 'var(--ink-3, #7C7365)' }}>
          {SC.roll.reading}
        </p>
      ) : q.data.vendors.length === 0 ? (
        <p data-testid="rc-empty" style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)' }}>
          {SC.roll.empty}
        </p>
      ) : (
        <div role="table" aria-label={SC.roll.tableLabel(days)}>
          <div role="row" className="rc-row rc-head">
            <div role="columnheader">
              <button
                type="button"
                className="rc-sort"
                aria-pressed={sort === 'deliveries'}
                onClick={() => setSort('deliveries')}
              >
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: 'var(--ink-2, #4F473C)',
                  }}
                >
                  {SC.roll.vendor}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontFamily: MONO,
                    fontSize: 9.5,
                    color: 'var(--ink-3, #7C7365)',
                  }}
                >
                  {SC.roll.vendorRule(days)}
                </span>
              </button>
            </div>
            {COLUMNS.map((c) => (
              <div role="columnheader" key={c.key}>
                <button
                  type="button"
                  className="rc-sort"
                  aria-pressed={sort === c.key}
                  onClick={() => setSort(c.key)}
                >
                  <span
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: sort === c.key ? 'var(--ink-1, #211C16)' : 'var(--ink-2, #4F473C)',
                    }}
                  >
                    {c.label}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontFamily: MONO,
                      fontSize: 9.5,
                      color: 'var(--ink-3, #7C7365)',
                    }}
                  >
                    {c.rule}
                  </span>
                </button>
              </div>
            ))}
          </div>
          {groups.scored.map(row)}
          {groups.refused.length > 0 && (
            <Fragment>
              <div
                role="row"
                data-testid="rc-refused-rule"
                style={{
                  padding: '10px 0 2px',
                  borderTop: '1px dashed var(--paper-2, #EAE4D8)',
                  fontSize: 11,
                  fontStyle: 'italic',
                  color: 'var(--ink-3, #7C7365)',
                }}
              >
                <span role="cell">
                  {SC.roll.refused(groups.refused.length, sortLabel ?? '')}
                </span>
              </div>
              {groups.refused.map(row)}
            </Fragment>
          )}
        </div>
      )}

      {q.data && q.data.vendors.length > 0 && (
        <div
          style={{
            marginTop: 14,
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          <p style={{ margin: '0 0 4px' }}>{SC.roll.footListed}</p>
          <p style={{ margin: '0 0 4px' }}>{SC.roll.footTone}</p>
          <p
            data-testid="rc-alerting"
            style={{
              margin: '8px 0 0',
              padding: '8px 10px',
              border: '1px dashed var(--paper-2, #EAE4D8)',
              borderRadius: 10,
            }}
          >
            {q.data.alerting.sentence}
          </p>
        </div>
      )}

      {open && (
        <DocketSheet
          providerId={open.id}
          providerName={open.name}
          days={days}
          measure={open.measure}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}

export default RollCall;
