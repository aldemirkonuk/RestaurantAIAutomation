/**
 * The merge picker — and the one rule the whole composer rests on.
 *
 *   THE UNIT OF INSERTION IS A SENTENCE THE ENGINE COMPUTED, WITH ITS
 *   PROVENANCE. NEVER A FIGURE RE-DERIVED FROM ONE.
 *
 * Sketch 100 surveyed ten mail products. Every one answers a missing merge
 * value by substituting a plausible one — a default, a silent blank, or a
 * fluent prediction. That is absence reported as health, written into a letter a
 * vendor keeps. Mudavym is the only one of them that computes its own figures,
 * so it is the only one that can say WHY a number is missing — and the way it
 * says so is by not offering the number at all.
 *
 * What that means mechanically: this list contains only sentences that exist as
 * rows in `analytics_insights`. A figure the engine WITHHELD (a day with no
 * records, non-comparable windows, a weekday baseline under three days, a zero
 * baseline) produced no sentence, so there is nothing here to insert and no
 * blank to fill in. There is deliberately no free "insert a figure" control: a
 * bare figure field would be the exact hole every other product falls through.
 *
 * Each inserted sentence carries a provenance chip — rule key, window,
 * computed-at — and the server re-reads the row before it records the letter
 * (`house-letters.service.ts`, `verifyInsertions`), so a chip that survives the
 * send is one the engine still stands behind.
 */

import { useMemo, useState } from 'react';
import { Quote, Search } from 'lucide-react';
import type { InsightSentence } from './useComposeData';
import { MONO, SANS, fmtDay, fmtWindow } from './compose-format';

const ICON = { size: 12, strokeWidth: 1.75 } as const;

/** The chip that travels with an inserted sentence. */
export function ProvenanceChip({ insight }: { insight: InsightSentence }) {
  return (
    <span
      data-testid="provenance-chip"
      title={`Rule ${insight.candidateKey} · window ${fmtWindow(insight.periodStart, insight.periodEnd)} · computed ${fmtDay(insight.computedAt)}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: MONO,
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.06em',
        padding: '2px 7px',
        borderRadius: 4,
        background: 'var(--seal-tint, rgba(26,94,107,.10))',
        color: 'var(--seal-deep, #14515C)',
        whiteSpace: 'nowrap',
      }}
    >
      <Quote {...ICON} aria-hidden />
      {insight.candidateKey}
      <span style={{ fontWeight: 500, opacity: 0.85 }}>
        {fmtWindow(insight.periodStart, insight.periodEnd)} · computed {fmtDay(insight.computedAt)}
      </span>
    </span>
  );
}

export function InsightPicker({
  insights,
  failed,
  error,
  chosen,
  onInsert,
  onRemove,
}: {
  insights: InsightSentence[] | null;
  failed: boolean;
  error: string | null;
  chosen: InsightSentence[];
  onInsert: (insight: InsightSentence) => void;
  onRemove: (candidateKey: string) => void;
}) {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = insights ?? [];
    const pool = q ? all.filter((i) => i.sentence.toLowerCase().includes(q)) : all;
    return pool.slice(0, 12);
  }, [insights, query]);

  return (
    <div style={{ fontFamily: SANS }}>
      <div className="flex items-baseline justify-between gap-2">
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          What the house knows
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--ink-3, #7C7365)' }}>
          whole sentences, with their provenance
        </span>
      </div>

      {chosen.length > 0 && (
        <ul
          data-testid="chosen-insights"
          style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 }}
        >
          {chosen.map((i) => (
            <li
              key={i.candidateKey}
              className="rounded-lg px-3 py-2"
              style={{ border: '1px solid var(--paper-2, #EAE4D8)', background: 'var(--paper-1, #F3EFE6)' }}
            >
              <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-1, #211C16)' }}>{i.sentence}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <ProvenanceChip insight={i} />
                <button
                  type="button"
                  onClick={() => onRemove(i.candidateKey)}
                  style={{
                    fontSize: 11,
                    padding: '2px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--paper-2, #EAE4D8)',
                    background: 'transparent',
                    color: 'var(--ink-2, #4F473C)',
                    cursor: 'pointer',
                  }}
                >
                  Take out
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {failed ? (
        <p role="alert" style={{ fontSize: 11.5, color: 'var(--alarm-deep, #8C3322)', margin: '8px 0 0' }}>
          The house's own sentences could not be read ({error ?? 'unknown error'}). Nothing may be
          merged into this letter until they can be — a figure typed by hand carries no provenance,
          and this composer will not pretend it does.
        </p>
      ) : insights === null ? (
        <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '8px 0 0' }}>
          Reading what the house knows…
        </p>
      ) : insights.length === 0 ? (
        <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)', margin: '8px 0 0' }}>
          The engine is holding no sentence for this house right now. That is an answer, not a
          gap: a figure it withheld has no sentence, and there is deliberately no field here for
          typing one in.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2">
            <Search {...ICON} aria-hidden style={{ color: 'var(--ink-3, #7C7365)' }} />
            <input
              aria-label="Search the house's sentences"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              style={{
                flex: 1,
                fontSize: 12,
                padding: '5px 9px',
                borderRadius: 8,
                border: '1px solid var(--paper-2, #EAE4D8)',
                background: 'var(--paper-0, #FAF7F1)',
                color: 'var(--ink-1, #211C16)',
              }}
            />
          </div>
          <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 2 }}>
            {shown
              .filter((i) => !chosen.some((c) => c.candidateKey === i.candidateKey))
              .map((i) => (
                <li key={i.candidateKey}>
                  <button
                    type="button"
                    className="cmp-pick"
                    onClick={() => onInsert(i)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      fontSize: 12,
                      lineHeight: 1.4,
                      padding: '6px 9px',
                      borderRadius: 8,
                      border: '1px solid transparent',
                      background: 'transparent',
                      color: 'var(--ink-1, #211C16)',
                      cursor: 'pointer',
                    }}
                  >
                    {i.sentence}
                    <span
                      style={{
                        display: 'block',
                        fontFamily: MONO,
                        fontSize: 9.5,
                        color: 'var(--ink-3, #7C7365)',
                        marginTop: 2,
                      }}
                    >
                      {i.candidateKey} · {fmtWindow(i.periodStart, i.periodEnd)}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default InsightPicker;
