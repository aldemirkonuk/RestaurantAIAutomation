/**
 * "What they did" — the ledger card in the vendor sheet (sketch 117 direction
 * A, the founder's pick of 2026-09-21; ADR 0207).
 *
 * Five lines, each a count over a count with its denominator printed, the
 * sentence that says what was left out and why, the prior window's own count
 * beside it, and a link whose number equals the rows it opens (the Docket, C's
 * day book, as the rows surface). Nothing here is a grade, a rank or an alert.
 * Tone is not here: "How their mail reads" follows this card in the sheet, for
 * owners and managers only (the founder, 2026-09-21).
 *
 * FIGURE SIZE (the founder, 2026-09-21: "The font size are a little big"): the
 * figure steps down one place on the scale this page already uses (13 · 14 ·
 * 15 · 16 · 18) — the percent from 18 to 16 px serif, its count beside it from
 * 10.5 to 10 px mono. The line's label stays 12.5 px, so the figure still
 * leads its line and the hierarchy holds.
 *
 * Honesty, in the order a reader meets it:
 *   - loading: the labels are drawn and the figures are not — no zero flashes;
 *   - the read failed: the failure in words, and no line claimed;
 *   - a register failed: THAT line says so, the other four stand;
 *   - too few / not collected: a sentence with the count, never a figure;
 *   - a quiet vendor: one sentence — an empty record is not a clean one.
 *
 * The founder's rulings of 2026-09-21: every figure is a percent with its
 * count (the gateway's percent, printed); five records everywhere before a
 * percent shows, and under five claims the claims themselves are listed here;
 * English words in the house's own formats, every word in `sc-copy.ts`.
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ink } from '../../../../lib/mudavym/motion';
import { MONO, SANS, SERIF } from '../pv-format';
import { DocketSheet } from './DocketSheet';
import { SC } from './sc-copy';
import { dayLabel, figureOf, formatsOf, rowsLabel, windowLabel } from './sc-format';
import type { Formats } from './sc-format';
import type { MeasureKey, MeasureResult, VendorScorecard, WindowDays } from './scorecard-types';
import { MEASURE_ORDER, WINDOWS } from './scorecard-types';
import { serverMessage, useVendorCard } from './useVendorScorecard';

/** The figure's two sizes, one step down from 18 / 10.5 (the founder, 2026-09-21). */
export const FIGURE_PX = 16;
export const FIGURE_COUNT_PX = 10;

const eyebrow: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3, #7C7365)',
  margin: '14px 0 6px',
};

export function WindowChips({ value, onChange }: { value: WindowDays; onChange: (w: WindowDays) => void }) {
  return (
    <span role="group" aria-label={SC.window.group} style={{ display: 'inline-flex', gap: 4 }}>
      {WINDOWS.map((w) => (
        <button
          key={w}
          type="button"
          aria-pressed={w === value}
          onClick={() => onChange(w)}
          className="sc-chip"
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            padding: '3px 8px',
            borderRadius: 6,
            border: `1px solid ${w === value ? 'var(--seal-ring, rgba(26,94,107,.32))' : 'var(--paper-2, #EAE4D8)'}`,
            background: w === value ? 'var(--paper-1, #F3EFE6)' : 'transparent',
            color: w === value ? 'var(--ink-1, #211C16)' : 'var(--ink-3, #7C7365)',
            cursor: 'pointer',
            transition: `border-color ${ink.ms}ms ${ink.easing}, color ${ink.ms}ms ${ink.easing}`,
          }}
        >
          {SC.window.chip(w)}
        </button>
      ))}
    </span>
  );
}

/** Under the minimum, the claims themselves — no percent over too few (question 2). */
function ListedClaims({ m, f }: { m: MeasureResult; f: Formats }) {
  if (!m.listed || m.listed.length === 0) return null;
  return (
    <div data-testid="ledger-listed-claims" style={{ marginTop: 4 }}>
      <p style={{ margin: 0, fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
        {SC.ledger.claimsBelowMinimum(m.minimum)}
      </p>
      <ul style={{ margin: '2px 0 0', padding: 0 }}>
        {m.listed.map((e) => (
          <li
            key={e.id}
            data-testid="ledger-listed-claim"
            style={{ listStyle: 'none', fontSize: 11, lineHeight: 1.45, color: 'var(--ink-2, #4F473C)' }}
          >
            <span style={{ fontFamily: MONO, fontSize: 10, color: 'var(--ink-3, #7C7365)', marginRight: 6 }}>
              {dayLabel(e.at, f)}
            </span>
            {e.title} — {e.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Line({ m, f, onRows }: { m: MeasureResult; f: Formats; onRows: (k: MeasureKey) => void }) {
  const fig = figureOf(m.key, m, f);
  return (
    <div
      data-testid={`ledger-line-${m.key}`}
      style={{
        padding: '10px 0',
        borderTop: '1px solid var(--paper-2, #EAE4D8)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--ink-1, #211C16)',
          }}
        >
          {m.label}
        </span>
        <span
          data-testid={`ledger-figure-${m.key}`}
          style={
            fig.scored
              ? {
                  fontFamily: SERIF,
                  fontSize: FIGURE_PX,
                  fontWeight: 600,
                  color: 'var(--ink-1, #211C16)',
                }
              : {
                  fontSize: 12,
                  fontStyle: 'italic',
                  color: 'var(--ink-3, #7C7365)',
                }
          }
        >
          {fig.big}
          {fig.small && (
            <small
              style={{
                fontFamily: MONO,
                fontSize: FIGURE_COUNT_PX,
                fontWeight: 400,
                fontStyle: 'normal',
                marginLeft: 6,
                color: 'var(--ink-3, #7C7365)',
              }}
            >
              {fig.small}
            </small>
          )}
        </span>
      </div>
      <p
        style={{
          margin: '3px 0 0',
          fontSize: 11.5,
          lineHeight: 1.45,
          color: m.outcome === 'could_not_read' ? 'var(--alarm, #A33A2B)' : 'var(--ink-2, #4F473C)',
        }}
      >
        {m.sentence}
      </p>
      <ListedClaims m={m} f={f} />
      <div className="flex items-baseline justify-between gap-3" style={{ marginTop: 4 }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          {m.priorSentence}
        </span>
        {m.rows > 0 ? (
          <button
            type="button"
            onClick={() => onRows(m.key)}
            className="sc-rows"
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              padding: 0,
              border: 0,
              background: 'transparent',
              color: 'var(--seal-deep, #14515C)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {rowsLabel(m)} ›
          </button>
        ) : (
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10,
              color: 'var(--ink-3, #7C7365)',
            }}
          >
            {SC.ledger.noRows}
          </span>
        )}
      </div>
    </div>
  );
}

function Body({ card, onRows }: { card: VendorScorecard; onRows: (k: MeasureKey) => void }) {
  const f = formatsOf(card.house);
  if (card.quiet) {
    return (
      <p
        data-testid="ledger-quiet"
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--ink-2, #4F473C)',
          margin: '6px 0',
        }}
      >
        {SC.ledger.quiet(card.window.days, card.providerName)}
      </p>
    );
  }
  return (
    <>
      {card.measures.map((m) => (
        <Line key={m.key} m={m} f={f} onRows={onRows} />
      ))}
    </>
  );
}

export function LedgerCard({ providerId, providerName }: { providerId: string; providerName: string }) {
  const [days, setDays] = useState<WindowDays>(90);
  const [rowsFor, setRowsFor] = useState<MeasureKey | null>(null);
  const q = useVendorCard(providerId, days);

  return (
    <section data-testid="ledger-card" style={{ fontFamily: SANS }}>
      <style>{`
        .sc-rows:hover { text-decoration: underline }
        .sc-chip:focus-visible, .sc-rows:focus-visible { outline: 2px solid var(--seal, #1A5E6B); outline-offset: 2px }
        @media (prefers-reduced-motion: reduce) { .sc-chip { transition: none !important } }
      `}</style>
      <h3 style={eyebrow}>{SC.ledger.heading}</h3>
      <div className="flex flex-wrap items-center justify-between gap-2" style={{ marginBottom: 4 }}>
        <WindowChips value={days} onChange={setDays} />
        {q.data && (
          <span style={{ fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
            {windowLabel(q.data.window.from, q.data.window.to, formatsOf(q.data.house))} · {SC.window.against(days)}
          </span>
        )}
      </div>

      {q.isError ? (
        <div role="alert" style={{ padding: '8px 0' }}>
          <p
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
              margin: 0,
              fontSize: 12,
              lineHeight: 1.45,
              color: 'var(--alarm, #A33A2B)',
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ marginTop: 2 }} />
            <span>
              {serverMessage(q.error, SC.ledger.readFailed)} {SC.ledger.readFailedTail}
            </span>
          </p>
          <button
            type="button"
            onClick={() => void q.refetch()}
            style={{
              marginTop: 6,
              fontSize: 11.5,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 8,
              border: '1px solid var(--seal-ring, rgba(26,94,107,.32))',
              background: 'transparent',
              color: 'var(--seal-deep, #14515C)',
              cursor: 'pointer',
            }}
          >
            {SC.ledger.tryAgain}
          </button>
        </div>
      ) : !q.data ? (
        <div data-testid="ledger-loading" aria-busy="true">
          <p
            style={{
              fontSize: 11.5,
              color: 'var(--ink-3, #7C7365)',
              margin: '6px 0',
            }}
          >
            {SC.ledger.reading}
          </p>
          {MEASURE_ORDER.map((k) => SC.labels[k]).map((l) => (
            <div
              key={l}
              className="flex justify-between"
              style={{
                padding: '9px 0',
                borderTop: '1px solid var(--paper-2, #EAE4D8)',
                fontSize: 12.5,
              }}
            >
              <span style={{ color: 'var(--ink-2, #4F473C)' }}>{l}</span>
            </div>
          ))}
        </div>
      ) : (
        <Body card={q.data} onRows={setRowsFor} />
      )}

      <details style={{ marginTop: 8, fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
        <summary style={{ cursor: 'pointer', color: 'var(--seal-deep, #14515C)' }}>
          {SC.ledger.howScored}
        </summary>
        <p style={{ margin: '6px 0 0', lineHeight: 1.5 }}>{SC.ledger.howScoredBody}</p>
        {q.data && (
          <p data-testid="ledger-deadline" style={{ margin: '6px 0 0', lineHeight: 1.5 }}>
            {q.data.house.deadline}
          </p>
        )}
      </details>

      <p
        data-testid="ledger-alerting"
        style={{
          margin: '10px 0 0',
          padding: '8px 10px',
          border: '1px dashed var(--paper-2, #EAE4D8)',
          borderRadius: 10,
          fontSize: 11,
          lineHeight: 1.45,
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        {q.data?.alerting.sentence ?? SC.ledger.alertingFallback}
      </p>

      {rowsFor && (
        <DocketSheet
          providerId={providerId}
          providerName={providerName}
          days={days}
          measure={rowsFor}
          onClose={() => setRowsFor(null)}
        />
      )}
    </section>
  );
}

export default LedgerCard;
