/**
 * The Docket — the rows behind a figure (sketch 117 direction C's day book,
 * taken as the rows surface behind each line of the ledger card and each cell
 * of the Roll Call; ADR 0207). NOT a drawer in the Sorting Office: the founder
 * picked it as the shape of "the rows behind a figure", and it opens from the
 * vendor, where the figure is.
 *
 * The five tallies at the top are the same figures as the ledger card, from
 * the same answer as the list beneath them, and each is a filter: press it and
 * the entries that remain are its rows. The gateway computes the figures FROM
 * these entries, so a tally always equals the count of its counted rows.
 *
 * An entry listed and not counted says why. An unanswered message is an entry
 * ("open — not counted, not forgotten"), not a silent absence from a median. A
 * register that did not answer is a band in the list — its entries are missing
 * from this list, not absent from the record.
 *
 * It is a second Sheet: on /providers the page's SheetStack stacks it on the
 * vendor sheet as level two of the spindle (sketch 103 · 1c).
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Sheet } from '../../../../components/mudavym/Sheet';
import { ink } from '../../../../lib/mudavym/motion';
import { MONO, SANS } from '../pv-format';
import { dayLabel, figureOf, fmtMoney, windowLabel } from './sc-format';
import type { DocketEntry, MeasureKey, MeasureResult, WindowDays } from './scorecard-types';
import { serverMessage, useDocket } from './useVendorScorecard';

const LABEL: Record<MeasureKey, string> = {
  onTime: 'On time',
  linesAsOrdered: 'Lines as ordered',
  priceAsAgreed: 'Price as agreed',
  replyTime: 'Reply time',
  credits: 'Credits',
};

function Tally({ m, pressed, onPress }: { m: MeasureResult; pressed: boolean; onPress: () => void }) {
  const fig = figureOf(m.key, m);
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      data-testid={`docket-tally-${m.key}`}
      style={{
        textAlign: 'left',
        padding: '6px 8px',
        borderRadius: 8,
        border: `1px solid ${pressed ? 'var(--seal-ring, rgba(26,94,107,.32))' : 'var(--paper-2, #EAE4D8)'}`,
        background: pressed ? 'var(--paper-1, #F3EFE6)' : 'transparent',
        cursor: 'pointer',
        fontFamily: SANS,
        transition: `border-color ${ink.ms}ms ${ink.easing}, background ${ink.ms}ms ${ink.easing}`,
      }}
    >
      <span
        style={{
          display: 'block',
          fontSize: 10,
          color: 'var(--ink-3, #7C7365)',
        }}
      >
        {m.label}
      </span>
      <span
        style={{
          display: 'block',
          fontSize: 12.5,
          fontWeight: fig.scored ? 600 : 400,
          fontStyle: fig.scored ? 'normal' : 'italic',
          color: fig.scored ? 'var(--ink-1, #211C16)' : 'var(--ink-3, #7C7365)',
        }}
      >
        {fig.big}
      </span>
      {fig.small && (
        <span
          style={{
            display: 'block',
            fontFamily: MONO,
            fontSize: 9.5,
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          {fig.small}
        </span>
      )}
    </button>
  );
}

function entryStatus(e: DocketEntry): {
  word: string;
  tone: 'hit' | 'miss' | 'aside';
} {
  // An open or promised claim IS counted — in what was asked, never in what
  // was recovered — so it must not read "not counted" like an unanswered message.
  if (e.open) return { word: e.counted ? 'open · asked, not recovered' : 'open · not counted', tone: 'aside' };
  if (!e.counted) return { word: 'listed · not counted', tone: 'aside' };
  if (e.measure === 'replyTime') return { word: 'counted', tone: 'hit' };
  if (e.hit) {
    const word =
      e.measure === 'onTime'
        ? 'on time'
        : e.measure === 'linesAsOrdered'
          ? 'as ordered'
          : e.measure === 'priceAsAgreed'
            ? 'at agreed'
            : 'credited';
    return { word, tone: 'hit' };
  }
  const word =
    e.measure === 'onTime'
      ? `+${e.daysLate ?? '?'} d late`
      : e.measure === 'linesAsOrdered'
        ? 'not as ordered'
        : e.measure === 'priceAsAgreed'
          ? 'not at agreed'
          : 'not recovered';
  return { word, tone: 'miss' };
}

function Entry({ e }: { e: DocketEntry }) {
  const s = entryStatus(e);
  return (
    <li
      data-testid="docket-entry"
      style={{
        listStyle: 'none',
        padding: '8px 0',
        borderTop: '1px solid var(--paper-2, #EAE4D8)',
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span style={{ fontSize: 12, color: 'var(--ink-1, #211C16)' }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              color: 'var(--ink-3, #7C7365)',
              marginRight: 8,
            }}
          >
            {dayLabel(e.at)}
          </span>
          {e.title}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10,
            whiteSpace: 'nowrap',
            color:
              s.tone === 'miss'
                ? 'var(--alarm, #A33A2B)'
                : s.tone === 'hit'
                  ? 'var(--seal-deep, #14515C)'
                  : 'var(--ink-3, #7C7365)',
          }}
        >
          {s.word}
        </span>
      </div>
      <p
        style={{
          margin: '2px 0 0',
          fontSize: 11.5,
          lineHeight: 1.45,
          color: 'var(--ink-2, #4F473C)',
        }}
      >
        {e.detail}
        {e.measure === 'priceAsAgreed' && e.agreed != null && e.invoiced != null && (
          <span
            style={{
              fontFamily: MONO,
              fontSize: 10.5,
              color: 'var(--ink-3, #7C7365)',
            }}
          >
            {' '}
            agreed {e.currency ? fmtMoney(e.agreed, e.currency) : e.agreed.toFixed(2)} · invoiced{' '}
            {e.currency ? fmtMoney(e.invoiced, e.currency) : e.invoiced.toFixed(2)}
          </span>
        )}
      </p>
      {e.excludedBecause && !e.open && (
        <p
          style={{
            margin: '2px 0 0',
            fontSize: 10.5,
            fontStyle: 'italic',
            color: 'var(--ink-3, #7C7365)',
          }}
        >
          Not counted: {e.excludedBecause}.
        </p>
      )}
    </li>
  );
}

export function DocketSheet({
  providerId,
  providerName,
  days,
  measure,
  onClose,
}: {
  providerId: string;
  providerName: string;
  days: WindowDays;
  measure: MeasureKey | null;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<MeasureKey | null>(measure);
  const q = useDocket(providerId, days, filter);
  const card = q.data?.card;
  const current = card?.measures.find((m) => m.key === filter) ?? null;
  const title = filter ? `${providerName} · ${LABEL[filter]}` : `${providerName} · every entry`;

  return (
    <Sheet
      open
      onClose={onClose}
      label={`The rows behind ${filter ? LABEL[filter].toLowerCase() : 'the figures'} for ${providerName}`}
      eyebrow={card ? `${days} d · ${windowLabel(card.window.from, card.window.to)}` : `${days} d`}
      title={title}
      spine={filter ? LABEL[filter] : 'Docket'}
    >
      <div className="px-4 py-3" style={{ fontFamily: SANS }} data-testid="docket">
        {q.isError ? (
          <p
            role="alert"
            style={{
              display: 'flex',
              gap: 6,
              margin: 0,
              fontSize: 12,
              lineHeight: 1.45,
              color: 'var(--alarm, #A33A2B)',
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ marginTop: 2 }} />
            <span>
              {serverMessage(q.error, 'The rows could not be read.')} That is a failed read — this list is
              unknown, not empty.
            </span>
          </p>
        ) : !q.data || !card ? (
          <p aria-busy="true" style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
            Reading the rows…
          </p>
        ) : (
          <>
            <div
              role="group"
              aria-label="Filter by measure"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
                gap: 6,
              }}
            >
              {card.measures.map((m) => (
                <Tally
                  key={m.key}
                  m={m}
                  pressed={filter === m.key}
                  onPress={() => setFilter(filter === m.key ? null : m.key)}
                />
              ))}
            </div>
            <p
              style={{
                margin: '10px 0 4px',
                fontSize: 11,
                lineHeight: 1.45,
                color: 'var(--ink-3, #7C7365)',
              }}
            >
              {filter
                ? `${current?.label}: ${q.data.entries.length} ${q.data.entries.length === 1 ? 'entry' : 'entries'} in the last ${days} days, newest first. The figure above is counted from exactly these rows.`
                : `Every entry in the last ${days} days, newest first. Each figure above is counted from these rows.`}
            </p>
            {current && current.outcome !== 'answered' && (
              <p
                data-testid="docket-refusal"
                style={{
                  margin: '4px 0 6px',
                  fontSize: 11.5,
                  lineHeight: 1.45,
                  color:
                    current.outcome === 'could_not_read' ? 'var(--alarm, #A33A2B)' : 'var(--ink-2, #4F473C)',
                }}
              >
                {current.sentence}
                {current.outcome === 'could_not_read' &&
                  ' Its entries are missing from this list, not absent from the record.'}
              </p>
            )}
            {!filter &&
              card.measures
                .filter((m) => m.outcome === 'could_not_read')
                .map((m) => (
                  <p
                    key={m.key}
                    role="alert"
                    style={{
                      margin: '4px 0',
                      fontSize: 11.5,
                      color: 'var(--alarm, #A33A2B)',
                    }}
                  >
                    {m.label}: {m.sentence} Its entries are missing from this list, not absent from the
                    record.
                  </p>
                ))}
            {q.data.entries.length === 0 ? (
              <p data-testid="docket-empty" style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
                No entries in the last {days} days — an empty docket is not a clean one.
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0 }}>
                {q.data.entries.map((e) => (
                  <Entry key={e.id} e={e} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

export default DocketSheet;
