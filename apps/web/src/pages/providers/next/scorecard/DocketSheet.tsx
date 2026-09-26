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
 *
 * The founder's rulings of 2026-09-21: an order past its date and not landed
 * is counted as late and stays open ("late · not landed"); every tally is a
 * percent with its count; dates and money in the house's own formats, and
 * every word in `sc-copy.ts`.
 */

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Sheet } from '../../../../components/mudavym/Sheet';
import { ink } from '../../../../lib/mudavym/motion';
import { MONO, SANS } from '../pv-format';
import { SC } from './sc-copy';
import { dayLabel, figureOf, fmtMoney, formatsOf, windowLabel } from './sc-format';
import type { Formats } from './sc-format';
import type { DocketEntry, MeasureKey, MeasureResult, WindowDays } from './scorecard-types';
import { serverMessage, useDocket } from './useVendorScorecard';

const LABEL = SC.labels;

function Tally({
  m,
  f,
  pressed,
  onPress,
}: {
  m: MeasureResult;
  f: Formats;
  pressed: boolean;
  onPress: () => void;
}) {
  const fig = figureOf(m.key, m, f);
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
  const W = SC.docket.status;
  // An order past its date and not landed (round 3): counted LATE once someone
  // here said "Not yet" — a miss that says it has not landed; unconfirmed and
  // not counted while nobody has answered; incomplete after 30 days.
  if (e.open && e.measure === 'onTime' && e.overdue === 'unconfirmed')
    return { word: W.unconfirmed, tone: 'aside' };
  if (e.open && e.measure === 'onTime' && e.overdue === 'incomplete')
    return { word: W.incomplete, tone: 'aside' };
  if (e.open && e.counted && e.measure === 'onTime') return { word: W.overdue, tone: 'miss' };
  // An open or promised claim IS counted — in what was asked, never in what
  // was recovered — so it must not read "not counted" like an unanswered message.
  if (e.open) return { word: e.counted ? W.openAsked : W.openNotCounted, tone: 'aside' };
  if (!e.counted) return { word: W.listed, tone: 'aside' };
  if (e.measure === 'replyTime') return { word: W.counted, tone: 'hit' };
  if (e.hit) return { word: W.hit[e.measure], tone: 'hit' };
  const word =
    e.measure === 'onTime'
      ? W.miss.onTime(e.daysLate)
      : e.measure === 'linesAsOrdered'
        ? W.miss.linesAsOrdered
        : e.measure === 'priceAsAgreed'
          ? W.miss.priceAsAgreed
          : W.miss.credits;
  return { word, tone: 'miss' };
}

function Entry({ e, f }: { e: DocketEntry; f: Formats }) {
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
            {dayLabel(e.at, f)}
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
            {SC.docket.agreedInvoiced(
              fmtMoney(e.agreed, e.currency ?? null, f),
              fmtMoney(e.invoiced, e.currency ?? null, f),
            )}
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
          {SC.docket.notCounted(e.excludedBecause)}
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
  const f = formatsOf(card?.house);
  const current = card?.measures.find((m) => m.key === filter) ?? null;
  const title = SC.docket.title(providerName, filter ? LABEL[filter] : null);

  return (
    <Sheet
      open
      onClose={onClose}
      label={SC.docket.sheetLabel(filter ? LABEL[filter] : null, providerName)}
      eyebrow={SC.docket.eyebrow(days, card ? windowLabel(card.window.from, card.window.to, f) : null)}
      title={title}
      spine={filter ? LABEL[filter] : SC.docket.spine}
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
              {serverMessage(q.error, SC.docket.readFailed)} {SC.docket.readFailedTail}
            </span>
          </p>
        ) : !q.data || !card ? (
          <p aria-busy="true" style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
            {SC.docket.reading}
          </p>
        ) : (
          <>
            <div
              role="group"
              aria-label={SC.docket.filterGroup}
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
                  f={f}
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
                ? SC.docket.filtered(current?.label ?? LABEL[filter], q.data.entries.length, days)
                : SC.docket.unfiltered(days)}
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
                {current.outcome === 'could_not_read' && SC.docket.missing}
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
                    {m.label}: {m.sentence}
                    {SC.docket.missing}
                  </p>
                ))}
            {q.data.entries.length === 0 ? (
              <p data-testid="docket-empty" style={{ fontSize: 11.5, color: 'var(--ink-2, #4F473C)' }}>
                {SC.docket.empty(days)}
              </p>
            ) : (
              <ul style={{ margin: 0, padding: 0 }}>
                {q.data.entries.map((e) => (
                  <Entry key={e.id} e={e} f={f} />
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
