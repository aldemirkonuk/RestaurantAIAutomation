/**
 * Count many goods in one sitting (inventory r36 audit, gap 6).
 *
 * WHY
 * A food or a supply is not drawn by the till, so its "Usage a day" and "Days
 * left" come only from two counts (days_of_stock_from_real_use). Counting meant
 * one drawer and one sheet per good: a weekly count of 80 kitchen goods was 80
 * sheets. This sheet lists the goods the page lists (or the selected ones) with
 * one box each, and records every typed box under one seal.
 *
 * WHAT IT KEEPS FROM THE ONE-GOOD SHEET
 *  - The count is blind (INV-W22): no book figure is shown until the seal, and
 *    the gap is said against the book as it read when the sheet opened.
 *  - Each good is counted in its own unit (iv-amount): a weighed good in kg, a
 *    poured one in l, a counted one in whole numbers.
 *  - Each count goes through the spot-count outbox, so a count with no signal
 *    is held on the device and sent later, with one key per good drawn when the
 *    sheet opens: a retry re-sends the same key, and the gateway records it once.
 *
 * WHAT IS NEW
 *  - A box left blank is not counted. It is never read as 0; an empty shelf is
 *    typed as 0. The seal says how many boxes it records.
 *  - The counts go out four at a time. Each good says its own result, and the
 *    sheet says the whole: recorded, held, refused, or not known.
 *  - Goods whose count was refused or whose outcome is not known can be sent
 *    again; a recorded or held one cannot be sent twice from this opening.
 */
import { useId, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { HoldToApprove, Sheet } from '@/components/mudavym';
import { getErrorStatus } from '../../../services/api/client';
import { queryKeys } from '../../../lib/query-keys';
import { newClientCountId, submitSpotCount } from '../../../lib/spotCountOutbox';
import { fmtCount, type InvRow } from './useInventoryNextData';
import { amountUnit, type AmountUnit } from './iv-amount';
import { SAFE_RETRY, writeFailure } from './iv-failure';
import './count-many.css';

/** More boxes than this is a walk of the whole house; a zone or a kind is a shelf. */
export const COUNT_MANY_MAX = 200;
/** Counts in flight at once. */
export const COUNT_MANY_AT_ONCE = 4;

export type CountOutcome =
  | { kind: 'recorded'; counted: number; book: number | null }
  | { kind: 'held'; counted: number }
  | { kind: 'refused'; text: string }
  | { kind: 'unknown'; text: string };

function titleOf(row: InvRow): string {
  return row.name ?? 'Unnamed title';
}

/** A bottle says its bare figure, as the one-good sheet does; any other unit says itself. */
function wordsOf(unit: AmountUnit): (n: number) => string {
  return unit.base === 'bottle' ? fmtCount : unit.words;
}

/** One good's line after its count: how far the shelf was from the book. */
export function gapWords(book: number | null, counted: number, words: (n: number) => string): string {
  const c = words(counted);
  if (book === null) return `Counted ${c}. The book could not be read before, so there is no gap to show.`;
  if (book === counted) return `Counted ${c}, the same as the book.`;
  const d = counted - book;
  return `Counted ${c}; the book said ${words(book)}, so the shelf is ${words(Math.abs(d))} ${d < 0 ? 'short' : 'over'}.`;
}

function listOf(names: string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  const head = shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return more > 0 ? `${shown.join(', ')} and ${fmtCount(more)} more` : head;
}

/**
 * The whole sitting in words. `outcomes` holds only the goods that were sent;
 * `blank` is how many boxes were left empty.
 */
export function countManySummary(
  outcomes: ReadonlyArray<{ title: string; outcome: CountOutcome }>,
  blank: number,
): string {
  const recorded = outcomes.filter((o) => o.outcome.kind === 'recorded') as Array<{
    title: string;
    outcome: Extract<CountOutcome, { kind: 'recorded' }>;
  }>;
  const held = outcomes.filter((o) => o.outcome.kind === 'held');
  const refused = outcomes.filter((o) => o.outcome.kind === 'refused');
  const unknown = outcomes.filter((o) => o.outcome.kind === 'unknown');
  const parts: string[] = [];
  if (recorded.length > 0) {
    const short = recorded.filter((o) => o.outcome.book !== null && o.outcome.counted < o.outcome.book).length;
    const over = recorded.filter((o) => o.outcome.book !== null && o.outcome.counted > o.outcome.book).length;
    const same = recorded.filter((o) => o.outcome.book !== null && o.outcome.counted === o.outcome.book).length;
    const unread = recorded.length - short - over - same;
    const split = [
      short > 0 ? `${fmtCount(short)} short of the book` : null,
      over > 0 ? `${fmtCount(over)} over` : null,
      same > 0 ? `${fmtCount(same)} the same as the book` : null,
      unread > 0 ? `${fmtCount(unread)} against a book that could not be read` : null,
    ].filter((s): s is string => s !== null);
    parts.push(
      `Recorded ${fmtCount(recorded.length)} ${recorded.length === 1 ? 'count' : 'counts'}: ${split.join(', ')}.`,
    );
  }
  if (held.length > 0) {
    parts.push(
      `${fmtCount(held.length)} ${held.length === 1 ? 'is' : 'are'} held on this device, not yet confirmed, and go${held.length === 1 ? 'es' : ''} out when the connection returns; until then the book still reads what it read.`,
    );
  }
  if (refused.length > 0) {
    parts.push(`Nothing was recorded for ${listOf(refused.map((o) => o.title))}; each says why below.`);
  }
  if (unknown.length > 0) {
    parts.push(
      `For ${listOf(unknown.map((o) => o.title))} it is not known whether the count was recorded. ${SAFE_RETRY}`,
    );
  }
  if (blank > 0) {
    parts.push(
      `${fmtCount(blank)} left blank ${blank === 1 ? 'was' : 'were'} not counted; a blank box is never read as 0.`,
    );
  }
  return parts.join(' ');
}

/** Run `work` over `items`, at most `limit` at a time; every item gets its turn. */
async function inTurns<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

interface CountManyProps {
  rows: InvRow[];
  /** The good's own unit (house item `uom`); absent is a bottle. */
  uomOf: (row: InvRow) => string | null | undefined;
  /** What the list is, for the sheet's label: "the 12 listed titles", "the 3 selected titles". */
  what: string;
  onClose: () => void;
}

export default function CountMany({ rows, uomOf, what, onClose }: CountManyProps) {
  const queryClient = useQueryClient();
  const baseId = useId();
  // The book as it read when the sheet opened, and one key per good, both drawn once.
  const [book] = useState(() => new Map(rows.map((r) => [r.id, r.stock])));
  const [keys] = useState(() => new Map(rows.map((r) => [r.id, newClientCountId()])));
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [outcomes, setOutcomes] = useState<Record<string, CountOutcome>>({});
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [summary, setSummary] = useState<{ text: string; alarm: boolean } | null>(null);

  const units = useMemo(() => new Map(rows.map((r) => [r.id, amountUnit(uomOf(r))])), [rows, uomOf]);
  const done = (id: string) => {
    const k = outcomes[id]?.kind;
    return k === 'recorded' || k === 'held';
  };

  const open = rows.filter((r) => !done(r.id));
  const filled = open.filter((r) => (typed[r.id] ?? '').trim() !== '');
  const unreadable = filled.filter((r) => units.get(r.id)!.parse(typed[r.id]) === null);
  const ready = filled.filter((r) => units.get(r.id)!.parse(typed[r.id]) !== null);
  const blank = open.length - filled.length;

  if (rows.length > COUNT_MANY_MAX) {
    return (
      <Sheet open bodyClassName="iv-sheet-body" onClose={onClose} label={`Count ${what}`} eyebrow="Count many" title="Too many to count at once">
        <p className="iv-said" data-testid="count-many-too-many">
          That is {fmtCount(rows.length)} titles. Filter the list by a zone or a kind, or select the titles, to {fmtCount(COUNT_MANY_MAX)} or
          fewer, and count them here; each title can still be counted from its own row.
        </p>
      </Sheet>
    );
  }

  const send = async () => {
    const batch = ready.map((r) => ({ row: r, counted: units.get(r.id)!.parse(typed[r.id])! }));
    setSending(true);
    setSummary(null);
    const got: Record<string, CountOutcome> = {};
    await inTurns(batch, COUNT_MANY_AT_ONCE, async ({ row, counted }) => {
      let outcome: CountOutcome;
      try {
        const { synced } = await submitSpotCount({
          itemId: row.id,
          itemLabel: titleOf(row),
          body: { countedQty: counted, clientCountId: keys.get(row.id)!, reason: 'Count of many' },
        });
        outcome = synced ? { kind: 'recorded', counted, book: book.get(row.id) ?? null } : { kind: 'held', counted };
      } catch (e) {
        // As on the one-good sheet: the outbox holds a 5xx or an unanswered
        // count, so a status is a refusal; no status means the device could
        // not hold it, possibly after a send that landed.
        outcome =
          getErrorStatus(e) === null
            ? { kind: 'unknown', text: `This device could not hold the count to send later, so it is not known whether it was recorded. ${SAFE_RETRY}` }
            : { kind: 'refused', text: writeFailure(e, { refused: 'Nothing was recorded', act: 'the count was recorded', check: SAFE_RETRY }).text };
      }
      got[row.id] = outcome;
      setOutcomes((prev) => ({ ...prev, [row.id]: outcome }));
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
    void queryClient.invalidateQueries({ queryKey: ['inventory-next'] });
    const sent = batch.map(({ row }) => ({ title: titleOf(row), outcome: got[row.id] }));
    const failed = sent.filter((s) => s.outcome.kind === 'refused' || s.outcome.kind === 'unknown').length;
    setSummary({ text: countManySummary(sent, blank), alarm: failed > 0 });
    setSending(false);
    // A refused or unknown count leaves a fresh control to send those again;
    // when every count went in, the seal stays stamped.
    if (failed > 0) setAttempt((k) => k + 1);
  };

  const n = ready.length;
  const label =
    unreadable.length > 0
      ? `Put right ${fmtCount(unreadable.length)} ${unreadable.length === 1 ? 'amount' : 'amounts'} first`
      : n === 0
        ? 'Type a count first'
        : `Hold to record ${fmtCount(n)} ${n === 1 ? 'count' : 'counts'}`;

  return (
    <Sheet
      open
      wide
      bodyClassName="iv-sheet-body"
      onClose={onClose}
      label={`Count ${what}: what is on the shelf, sealed before the book changes`}
      eyebrow="Count many"
      title={`Count ${what}`}
      footer={<span>Each count sets its title’s book to what was counted and stamps its last-counted date.</span>}
    >
      <p className="iv-said">
        Type what is on the shelf for each title you count, then hold to seal them all. A box left blank is not counted; type 0 for an
        empty shelf. The book’s figures are shown after the seal, so they cannot steer the count.
      </p>
      <ol className="cm-list" data-testid="count-many-list">
        {rows.map((r) => {
          const unit = units.get(r.id)!;
          const id = `${baseId}-${r.id}`;
          const value = typed[r.id] ?? '';
          const n = value.trim() === '' ? null : unit.parse(value);
          const outcome = outcomes[r.id];
          const locked = done(r.id) || sending;
          return (
            <li key={r.id} className="cm-row" data-testid="count-many-row">
              <label htmlFor={id} className="cm-name">
                {titleOf(r)}
                <span className="iv-note"> in {unit.fieldUnit}</span>
              </label>
              <input
                id={id}
                className="mdv-count__input iv-amount-input cm-input"
                inputMode={unit.whole ? 'numeric' : 'decimal'}
                autoComplete="off"
                aria-describedby={`${id}-said`}
                value={value}
                disabled={locked}
                onChange={(e) => setTyped((prev) => ({ ...prev, [r.id]: e.target.value }))}
              />
              <span id={`${id}-said`} className={outcome && !done(r.id) ? 'iv-note iv-said-alarm cm-said' : 'iv-note cm-said'}>
                {outcome?.kind === 'recorded'
                  ? gapWords(outcome.book, outcome.counted, wordsOf(unit))
                  : outcome?.kind === 'held'
                    ? `Held on this device: ${wordsOf(unit)(outcome.counted)}, not yet confirmed.`
                    : outcome
                      ? outcome.text
                      : value.trim() === ''
                        ? ''
                        : n === null
                          ? (unit.why(value) ?? `Not an amount this book can hold. ${unit.hint}`)
                          : `Reads as ${unit.words(n)}.`}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="iv-note" data-testid="count-many-tally">
        {fmtCount(n)} of {fmtCount(open.length)} {open.length === 1 ? 'title' : 'titles'} still to count {n === 1 ? 'has' : 'have'} an amount;{' '}
        {fmtCount(blank)} {blank === 1 ? 'is' : 'are'} blank and will not be counted.
      </p>
      <div style={{ marginTop: 14 }}>
        <HoldToApprove
          key={`count-many-${attempt}`}
          label={sending ? 'Recording…' : label}
          approvedLabel="Counts recorded"
          boundSummary={n === 0 ? undefined : `${fmtCount(n)} ${n === 1 ? 'count' : 'counts'} of ${what}`}
          disabled={sending || n === 0 || unreadable.length > 0}
          onApprove={() => send()}
        />
      </div>
      {summary ? (
        <p role={summary.alarm ? 'alert' : 'status'} className={summary.alarm ? 'iv-said iv-said-alarm' : 'iv-said'} style={{ marginTop: 12 }} data-testid="count-many-summary">
          {summary.text}
        </p>
      ) : null}
    </Sheet>
  );
}
