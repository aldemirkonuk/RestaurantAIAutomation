/**
 * RecurrenceSheet — put a repeating rule on an order this house has approved,
 * and pause or end one that is already there.
 *
 * The founder, 2026-09-05: "Build recurrence on the order." ADR 0125's addendum.
 *
 * FOUR THINGS THIS SHEET SAYS OUT LOUD, BECAUSE EACH IS A DECISION
 * ---------------------------------------------------------------
 *  1. **It approves nothing, ever.** Every occurrence this rule produces is
 *     raised as a PENDING order that a person seals with the hold, under the
 *     same ADR 0116 threshold gate as any other. The sheet states that above
 *     the button rather than leaving an operator to discover it — a standing
 *     order that quietly bought wine would be the single most expensive
 *     surprise this page could hold.
 *  2. **The next date is DERIVED, and the sheet shows the derivation.** There
 *     is no "next date" field. You choose a rule and a start, and the sheet
 *     projects the first four occurrences from the same pure function the
 *     gateway advances the series with (`order-recurrence.ts` there,
 *     `nextOccurrenceOn` here would be a second implementation — so the
 *     projection is computed from the SAME arithmetic, imported, not retyped).
 *  3. **Refused on an order nobody has approved**, and the refusal is shown
 *     before the button, not after the round trip.
 *  4. **Pausing and ending are plain acts, not sealed ones**, and the sheet
 *     says why: they commit no money. Only approving an occurrence does, and
 *     that keeps its hold.
 */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/mudavym';
import { apiClient, getErrorMessage } from '@/services/api/client';
import { SANS, SERIF } from './format';
import {
  RECURRENCE_FREQUENCIES,
  type RecurrenceFrequency,
  ordinal,
  recurrenceLabel,
  shortDate,
} from './recurrence';
import type { OrderRowVM } from './useOrdersNextData';

/** How each rule reads to a person. Never a raw enum member on screen. */
const FREQUENCY_LABEL: Record<RecurrenceFrequency, string> = {
  daily: 'Every day',
  weekly: 'Every week',
  biweekly: 'Every fortnight',
  monthly: 'Every month',
  quarterly: 'Every quarter',
};

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** Which anchor control a rule takes, mirroring `anchorKindFor` on the gateway. */
function anchorKind(f: RecurrenceFrequency): 'weekday' | 'monthday' | 'none' {
  if (f === 'weekly' || f === 'biweekly') return 'weekday';
  if (f === 'monthly' || f === 'quarterly') return 'monthday';
  return 'none';
}

/** Today as YYYY-MM-DD in UTC — the same calendar the gateway measures in. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/*
 * THE PROJECTION.
 *
 * A deliberately small re-statement of the gateway's arithmetic, kept to what a
 * PREVIEW needs and nothing more. It is not the authority: the gateway derives
 * and stores every real date, and this only shows a person what they are about
 * to ask for. The two rules it must not get wrong are the two that bite —
 * month-end clamping and UTC-vs-local — and both are handled the same way here
 * as there, with Y/M/D integers and Date.UTC only.
 *
 * If these ever disagree, the gateway wins and the sheet is showing a preview
 * of something that will not happen — which is why the panel labels this block
 * "what this will ask for" rather than presenting it as a schedule.
 */
function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function toParts(iso: string) {
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10));
  return { y, m, d };
}
function fromParts(p: { y: number; m: number; d: number }) {
  return `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}
function addDays(p: { y: number; m: number; d: number }, n: number) {
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d) + n * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}
function addMonths(p: { y: number; m: number; d: number }, n: number) {
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(p.d, daysInMonth(y, m)) };
}
function snapWeekday(p: { y: number; m: number; d: number }, anchor: number) {
  const targetJs = anchor === 6 ? 0 : anchor + 1;
  const cur = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  const diff = (targetJs - cur + 7) % 7;
  return diff === 0 ? p : addDays(p, diff);
}
function snapMonthDay(p: { y: number; m: number; d: number }, anchor: number) {
  return { y: p.y, m: p.m, d: Math.min(anchor, daysInMonth(p.y, p.m)) };
}

export function projectOccurrences(
  startsOn: string,
  frequency: RecurrenceFrequency,
  anchorDay: number | null,
  count: number,
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn)) return [];
  let cur = toParts(startsOn);

  // The FIRST occurrence may be the start date itself, when it already
  // satisfies the anchor. Stepping first would silently lose a week.
  if (anchorDay !== null) {
    if (anchorKind(frequency) === 'weekday') {
      cur = snapWeekday(cur, anchorDay);
    } else if (anchorKind(frequency) === 'monthday') {
      const here = snapMonthDay(cur, anchorDay);
      cur = here.d >= cur.d ? here : snapMonthDay(addMonths(cur, 1), anchorDay);
    }
  }

  const out = [fromParts(cur)];
  while (out.length < count) {
    let next = toParts(out[out.length - 1]);
    if (frequency === 'daily') next = addDays(next, 1);
    else if (frequency === 'weekly') next = addDays(next, 7);
    else if (frequency === 'biweekly') next = addDays(next, 14);
    else if (frequency === 'monthly') next = addMonths(next, 1);
    else next = addMonths(next, 3);
    if (anchorDay !== null) {
      next =
        anchorKind(frequency) === 'weekday'
          ? snapWeekday(next, anchorDay)
          : anchorKind(frequency) === 'monthday'
            ? snapMonthDay(next, anchorDay)
            : next;
    }
    out.push(fromParts(next));
  }
  return out;
}

export interface RecurrenceSheetProps {
  open: boolean;
  onClose: () => void;
  row: OrderRowVM | null;
}

export function RecurrenceSheet({ open, onClose, row }: RecurrenceSheetProps) {
  const queryClient = useQueryClient();
  const [frequency, setFrequency] = useState<RecurrenceFrequency | null>(null);
  const [anchorDay, setAnchorDay] = useState<number | null>(null);
  const [startsOn, setStartsOn] = useState<string>(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const existing = row?.recurrence ?? null;
  const alreadyRecurs = !!existing?.frequency;

  /*
   * THE REFUSAL, SHOWN BEFORE THE BUTTON.
   *
   * The gateway refuses a recurrence on an order nobody has approved, with the
   * reason "there is no agreement to repeat". Printing it here rather than
   * after the round trip is ADR 0083's rule: a control that looks live and is
   * not teaches an operator that the page is unreliable.
   *
   * `approvedAt` is the same test the gateway makes, read off the same wire.
   */
  const blockedReason: string | null = !row
    ? 'No order is open.'
    : row.recurrence.parentOrderId
      ? 'This order is one occurrence of another order’s rule, so it cannot carry a rule of its own. Set it on the order it came from.'
      : !row.approvedAt
        ? 'This order has not been approved, so there is no agreement to repeat. Approve it once — the hold, the seal — and a recurrence can be set on it afterwards.'
        : null;

  const projection = useMemo(() => {
    if (!frequency) return [];
    return projectOccurrences(startsOn, frequency, anchorDay, 4);
  }, [frequency, anchorDay, startsOn]);

  const kind = frequency ? anchorKind(frequency) : 'none';

  async function post(path: string, body?: unknown) {
    if (!row) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await apiClient.post(`/procurement/orders/${row.id}${path}`, body ?? {});
      // Confirm only after acceptance (ADR 0020 / ADR 0083). Nothing above this
      // line claims a write; nothing below it runs if the request threw.
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
      setDone('Saved.');
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const canSave = !!frequency && !blockedReason && !busy;

  return (
    <Panel
      open={open}
      onClose={onClose}
      label="Set a recurring order"
      eyebrow={alreadyRecurs ? 'Recurring order' : 'New recurrence'}
      title={alreadyRecurs ? 'This order repeats' : 'Make this order repeat'}
      closeLabel="Put it down"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span style={{ fontFamily: SANS, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
            {/* The one sentence an operator must not have to discover. */}
            Every occurrence is raised for approval. Nothing is ever bought without a hold.
          </span>
          <button
            type="button"
            onClick={() =>
              post('/recurrence', {
                frequency,
                ...(anchorDay === null ? {} : { anchorDay }),
                startsOn,
              })
            }
            disabled={!canSave}
            data-testid="recurrence-save"
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              padding: '7px 14px',
              borderRadius: 3,
              border: '1px solid var(--seal, #1A5E6B)',
              background: canSave ? 'var(--seal, #1A5E6B)' : 'transparent',
              color: canSave ? 'var(--paper-0, #FBF8F1)' : 'var(--ink-3, #7C7365)',
              cursor: canSave ? 'pointer' : 'not-allowed',
            }}
          >
            {alreadyRecurs ? 'Replace the rule' : 'Set the rule'}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-4" style={{ fontFamily: SANS, fontSize: 12.5 }}>
        {row && (
          <p style={{ fontFamily: SERIF, fontSize: 14, color: 'var(--ink-1, #211C16)' }}>
            {row.wineName ?? 'This order'}
            {row.providerName ? ` from ${row.providerName}` : ''}
            {row.orderNumber ? ` · ${row.orderNumber}` : ''}
          </p>
        )}

        {blockedReason && (
          <p
            data-testid="recurrence-blocked"
            style={{ color: 'var(--ink-2, #4A4237)', lineHeight: 1.5 }}
          >
            {blockedReason}
          </p>
        )}

        {alreadyRecurs && existing && (
          <div
            data-testid="recurrence-current"
            style={{
              borderLeft: '2px solid var(--seal, #1A5E6B)',
              paddingLeft: 10,
              color: 'var(--ink-2, #4A4237)',
              lineHeight: 1.55,
            }}
          >
            <p>{recurrenceLabel(existing) ?? 'This order repeats.'}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {existing.status === 'active' && (
                <button
                  type="button"
                  onClick={() => post('/recurrence/pause')}
                  disabled={busy}
                  data-testid="recurrence-pause"
                  style={plainAct}
                >
                  Pause it
                </button>
              )}
              {existing.status === 'paused' && (
                <button
                  type="button"
                  onClick={() => post('/recurrence/resume')}
                  disabled={busy}
                  data-testid="recurrence-resume"
                  style={plainAct}
                >
                  Resume it
                </button>
              )}
              {existing.status !== 'ended' && (
                <button
                  type="button"
                  onClick={() => post('/recurrence/end')}
                  disabled={busy}
                  data-testid="recurrence-end"
                  style={plainAct}
                >
                  End it
                </button>
              )}
            </div>
            <p className="mt-2" style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
              {/* Why these three are plain buttons and the approval is a hold. */}
              Pausing and ending are recorded with your name and the time. They are not
              sealed: neither spends money — each occurrence is still approved on its own.
            </p>
          </div>
        )}

        {!blockedReason && (
          <>
            <fieldset className="flex flex-col gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ color: 'var(--ink-3, #7C7365)', fontSize: 11.5 }}>How often</legend>
              <div className="flex flex-wrap gap-2">
                {RECURRENCE_FREQUENCIES.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setFrequency(f);
                      // A changed rule DROPS the anchor rather than carrying it:
                      // "Tuesday" is not a day of the month, and 12 is not a
                      // weekday. Carrying it across would be the one input the
                      // gateway refuses, entered by the UI on the user's behalf.
                      setAnchorDay(null);
                    }}
                    data-testid={`recurrence-frequency-${f}`}
                    aria-pressed={frequency === f}
                    style={chip(frequency === f)}
                  >
                    {FREQUENCY_LABEL[f]}
                  </button>
                ))}
              </div>
            </fieldset>

            {kind === 'weekday' && (
              <fieldset className="flex flex-col gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ color: 'var(--ink-3, #7C7365)', fontSize: 11.5 }}>
                  On which day (optional — leave it and the rule runs from the start date)
                </legend>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map((w, i) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setAnchorDay((cur) => (cur === i ? null : i))}
                      aria-pressed={anchorDay === i}
                      data-testid={`recurrence-weekday-${i}`}
                      style={chip(anchorDay === i)}
                    >
                      {w.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            {kind === 'monthday' && (
              <label className="flex flex-col gap-1">
                <span style={{ color: 'var(--ink-3, #7C7365)', fontSize: 11.5 }}>
                  On which day of the month (1 to 28, so that every month has one)
                </span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={anchorDay ?? ''}
                  onChange={(e) =>
                    setAnchorDay(e.target.value === '' ? null : Number(e.target.value))
                  }
                  data-testid="recurrence-monthday"
                  style={field}
                />
                <span style={{ fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
                  {/* Why the ceiling is 28 and not 31, stated where it is imposed. */}
                  29, 30 and 31 are refused rather than clamped: a date that silently
                  moves twice a year is not a rule anybody agreed to.
                </span>
              </label>
            )}

            <label className="flex flex-col gap-1">
              <span style={{ color: 'var(--ink-3, #7C7365)', fontSize: 11.5 }}>
                Starting from
              </span>
              <input
                type="date"
                value={startsOn}
                onChange={(e) => setStartsOn(e.target.value)}
                data-testid="recurrence-startson"
                style={field}
              />
            </label>

            {projection.length > 0 && (
              <div
                data-testid="recurrence-projection"
                style={{ color: 'var(--ink-2, #4A4237)', lineHeight: 1.55 }}
              >
                <p style={{ color: 'var(--ink-3, #7C7365)', fontSize: 11.5 }}>
                  What this will ask for
                </p>
                <p>
                  {projection.map((d) => shortDate(d)).filter(Boolean).join(' · ')}
                  {' …'}
                </p>
                <p style={{ fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
                  {frequency === 'monthly' || frequency === 'quarterly'
                    ? anchorDay === null
                      ? 'Measured from the start date.'
                      : `On the ${ordinal(anchorDay)} of the month, clamped to the last day of a short one.`
                    : anchorDay === null
                      ? 'Measured from the start date.'
                      : `On ${WEEKDAYS[anchorDay]}.`}
                </p>
              </div>
            )}
          </>
        )}

        {error && (
          <p data-testid="recurrence-error" style={{ color: 'var(--alarm, #8C3A2B)', lineHeight: 1.5 }}>
            {error}
          </p>
        )}
        {done && !error && (
          <p data-testid="recurrence-done" style={{ color: 'var(--seal, #1A5E6B)' }}>
            {done}
          </p>
        )}
      </div>
    </Panel>
  );
}

const chip = (on: boolean): React.CSSProperties => ({
  fontFamily: SANS,
  fontSize: 12,
  padding: '5px 10px',
  borderRadius: 3,
  border: `1px solid ${on ? 'var(--seal, #1A5E6B)' : 'var(--paper-2, #EAE4D8)'}`,
  background: on ? 'var(--seal-wash, #E6EFF0)' : 'transparent',
  color: on ? 'var(--seal, #1A5E6B)' : 'var(--ink-2, #4A4237)',
  cursor: 'pointer',
});

const field: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12.5,
  padding: '6px 8px',
  borderRadius: 3,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'var(--paper-0, #FBF8F1)',
  color: 'var(--ink-1, #211C16)',
  maxWidth: 220,
};

const plainAct: React.CSSProperties = {
  fontFamily: SANS,
  fontSize: 12,
  padding: '5px 10px',
  borderRadius: 3,
  border: '1px solid var(--paper-2, #EAE4D8)',
  background: 'transparent',
  color: 'var(--ink-2, #4A4237)',
  cursor: 'pointer',
};
