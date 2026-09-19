/**
 * RcVerdictLedger — the append-only verdict ledger, drawn as sketch 107's
 * "line sheet" (ADR 0112 `Sheet`, 440px): one line's full history — who,
 * when, verdict, quantity, what it took from — with the derivation printed
 * beneath it, and the append form the founder approved: "concise and it
 * gives you everything, plus the hold to send money sender" (ADR 0160 §107).
 *
 * Rules this draws from `.planning/sketches/107-receiving-structure/README.md`
 * ("The derivation rule") and ADR 0149 row 23:
 * - one verdict word, one quantity, one unit — the unit the person counted
 *   in, NEVER re-multiplied here;
 * - a row that is taken from is drawn struck through and kept, never edited
 *   or hidden;
 * - "current" is the DERIVATION the server computed, not the latest row;
 * - the append picker starts empty — no verdict, no quantity, no unit, no
 *   takes-from chosen for the person — and the hold is disabled until a
 *   reason is written;
 * - the append is itself a write nothing can undo (the table refuses
 *   UPDATE/DELETE from any role), so it goes behind the same hold-to-seal
 *   ceremony as a credit request (`HoldToApprove`), never a plain click;
 * - "page or group, never grow without end" (the founder's scale question):
 *   history pages via `before`/`hasEarlier` rather than rendering unboundedly.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HoldToApprove, Sheet } from '@/components/mudavym';
import type { LineVerdictRow, LineVerdictWord } from '@/services/api/receiving';
import { ORDER_UNIT_TYPES } from '@/services/api/receiving';
import { EM, MONO, SANS, capStyle, fmtDate, fmtUnits } from './rc-format';
import { useAppendLineVerdict, useLineVerdicts } from './useReceivingNextData';

const VERDICT_LABEL: Record<LineVerdictWord, string> = {
  accepted: 'Accepted',
  short: 'Short',
  refused: 'Refused',
  damaged: 'Damaged',
};

const VERDICT_ORDER: LineVerdictWord[] = ['accepted', 'short', 'refused', 'damaged'];

/** Verdict words are words, one chromatic colour, never colour alone
 * (sketch 107): accepted plain, short outlined, refused solid ink, damaged
 * dashed. Applied to a rendered ledger entry's own chip, not the picker. */
function verdictChipStyle(v: LineVerdictWord): CSSProperties {
  const base: CSSProperties = {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    borderRadius: 4,
    padding: '2px 7px',
    display: 'inline-block',
  };
  switch (v) {
    case 'accepted':
      return { ...base, color: 'var(--ink-1, #211C16)', border: '1px solid transparent' };
    case 'short':
      return {
        ...base,
        color: 'var(--seal-deep, #14515C)',
        border: '1px solid var(--seal-ring, rgba(26,94,107,.45))',
      };
    case 'refused':
      return {
        ...base,
        color: 'var(--paper-0, #FAF7F1)',
        background: 'var(--ink-1, #211C16)',
      };
    case 'damaged':
      return {
        ...base,
        color: 'var(--ink-1, #211C16)',
        border: '1px dashed var(--ink-3, #7C7365)',
      };
  }
}

function unitLabel(qty: number, uom: string): string {
  // fmtUnits only knows the plural table for the order's own unit vocabulary
  // (rc-format.ts) — the same vocabulary a verdict row is written in.
  return fmtUnits(qty, uom);
}

interface EntryRowProps {
  entry: LineVerdictRow;
  index: number;
  /** True when a later row names this one in `supersedes` — struck through, kept. */
  superseded: boolean;
  /** Display label for `entry.supersedes`, or null when it names a row not loaded on this page. */
  supersedesLabel: string | null;
}

function EntryRow({ entry, index, superseded, supersedesLabel }: EntryRowProps) {
  const evidenceNote =
    entry.evidence && typeof entry.evidence === 'object' && 'note' in (entry.evidence as any)
      ? String((entry.evidence as any).note ?? '')
      : null;
  return (
    <li
      style={{
        padding: '9px 0',
        borderBottom: '1px solid var(--paper-2, #EAE4D8)',
        opacity: superseded ? 0.62 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ ...capStyle, flex: 'none' }}>v{index}</span>
        <span style={verdictChipStyle(entry.verdict)}>{VERDICT_LABEL[entry.verdict]}</span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12.5,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: 'var(--ink-1, #211C16)',
            textDecoration: superseded ? 'line-through' : 'none',
          }}
        >
          {unitLabel(entry.qty, entry.uom)}
        </span>
        {entry.beyondOrder && (
          <span style={{ ...capStyle, color: 'var(--seal-deep, #14515C)' }}>Beyond order</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
          {entry.recordedByName ?? (entry.recordedByNameUnavailable ? 'name unavailable' : EM)} ·{' '}
          {fmtDate(entry.recordedAt)}
        </span>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)', margin: '4px 0 0' }}>
        {entry.reason}
      </p>
      {entry.supersedes && (
        <p style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', margin: '3px 0 0' }}>
          takes{' '}
          {entry.supersedesQtyBottles == null
            ? 'all of'
            : // supersedesQtyBottles is contractually always a BOTTLE count
              // (services/api/receiving.ts: "In bottles — the named row's own
              // comparison unit"), never the superseded row's own unit — a
              // prior version relabelled this number with the target row's
              // uom (e.g. "case") without converting it, so "2" bottles taken
              // from a case-uom row printed as "2 cases" (confirmer review,
              // 2026-09-18, STUB-11). Printing it as bottles, unconditionally,
              // matches the value's own contract and the page's "never
              // re-multiplied" rule — no pack-size conversion is invented here.
              `${unitLabel(entry.supersedesQtyBottles, 'bottle')} of`}{' '}
          {supersedesLabel ?? 'an earlier entry not shown on this page — Load earlier to see it'}
        </p>
      )}
      {evidenceNote && (
        <p style={{ fontSize: 11, color: 'var(--ink-4, #665D50)', margin: '3px 0 0' }}>
          evidence: {evidenceNote}
        </p>
      )}
    </li>
  );
}

export interface RcVerdictLedgerProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  orderLabel: string;
  vendorName?: string | null;
}

export function RcVerdictLedger({
  open,
  onClose,
  orderId,
  orderLabel,
  vendorName,
}: RcVerdictLedgerProps) {
  const [before, setBefore] = useState<string | null>(null);
  const [entries, setEntries] = useState<LineVerdictRow[]>([]);

  // The append picker's own state — starts empty, nothing chosen for the person.
  const [verdict, setVerdict] = useState<LineVerdictWord | null>(null);
  const [qty, setQty] = useState('');
  const [uom, setUom] = useState('');
  const [beyondOrder, setBeyondOrder] = useState(false);
  const [reason, setReason] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');
  const [supersedes, setSupersedes] = useState('');
  const [supersedesQtyBottles, setSupersedesQtyBottles] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Minted once per composed entry, not per hold (fixer review, 2026-09-18):
  // a `Date.now()+random()` key regenerated on every call meant a hold that
  // succeeded on the server but lost its response could never be retried
  // safely — the retry would mint a new key and write a second, permanent
  // row. Reused across retries until the append lands (`reset()` below
  // clears it) or the person edits the composed entry (the effect below
  // clears it then too, since it is then a different entry).
  const idempotencyKeyRef = useRef<string | null>(null);
  const verdictButtonRefs = useRef<Partial<Record<LineVerdictWord, HTMLButtonElement | null>>>({});
  useEffect(() => {
    idempotencyKeyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdict, qty, uom, beyondOrder, reason, evidenceNote, supersedes, supersedesQtyBottles]);

  const { ledger, isLoading, isError, failure, refetch } = useLineVerdicts(
    open ? orderId : null,
    { before },
  );
  const append = useAppendLineVerdict(orderId);

  useEffect(() => {
    setBefore(null);
    setEntries([]);
  }, [orderId, open]);

  useEffect(() => {
    if (!ledger) return;
    setEntries((prev) => {
      if (before === null) return ledger.entries;
      const seen = new Set(prev.map((e) => e.id));
      const toAdd = ledger.entries.filter((e) => !seen.has(e.id));
      return [...toAdd, ...prev];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledger]);

  const supersededIds = useMemo(
    () => new Set(entries.filter((e) => e.supersedes).map((e) => e.supersedes as string)),
    [entries],
  );

  // v-numbers are stable identities across pages (sketch 107), not a loaded
  // row's position in this browser's array. With `hasEarlier`, the newest
  // ten rows loaded first are NOT v1..v10 — they are the last ten of
  // `totalEntries`. `idToOrdinal` anchors every loaded row against the
  // server's own count instead of the array index, so "Load earlier" never
  // renumbers a v-label a caption or a picker option already cited.
  const totalCount = ledger?.totalEntries ?? entries.length;
  const idToOrdinal = useMemo(() => {
    const m = new Map<string, number>();
    const base = totalCount - entries.length; // ordinal of entries[0], minus 1
    entries.forEach((e, i) => m.set(e.id, base + i + 1));
    return m;
  }, [entries, totalCount]);
  const idToLabel = (id: string) => {
    const n = idToOrdinal.get(id);
    return n ? `v${n}` : null;
  };
  const orderedSentence =
    ledger && ledger.orderedQty != null && ledger.orderedBottles != null
      ? `ordered ${fmtUnits(ledger.orderedQty, ledger.orderedUnitType)} = ${ledger.orderedBottles} bottles · the pack size is the order's, stated once`
      : ledger
        ? 'this order carries no stated quantity yet'
        : null;

  const canSubmit =
    !!verdict && qty.trim() !== '' && Number(qty) > 0 && uom !== '' && reason.trim() !== '';

  const reset = () => {
    setVerdict(null);
    setQty('');
    setUom('');
    setBeyondOrder(false);
    setReason('');
    setEvidenceNote('');
    setSupersedes('');
    setSupersedesQtyBottles('');
    setSubmitError(null);
    idempotencyKeyRef.current = null;
  };

  // Same pattern as RcCreditDrafts' hold-to-approve die: the seal itself is
  // the gesture completing, not proof the write landed. A refusal is
  // surfaced below and the die remounts at rest (`attempt`) so the same
  // hold can be repeated rather than staying stuck on a sealed face over a
  // write that did not happen.
  const onHold = () => {
    if (!canSubmit) return;
    setSubmitError(null);
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `${orderId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    append.mutate(
      {
        verdict: verdict as LineVerdictWord,
        qty: Number(qty),
        uom,
        beyondOrder,
        reason: reason.trim(),
        evidence: evidenceNote.trim() ? { note: evidenceNote.trim() } : undefined,
        supersedes: supersedes || undefined,
        supersedesQtyBottles: supersedesQtyBottles ? Number(supersedesQtyBottles) : undefined,
        idempotencyKey: idempotencyKeyRef.current,
      },
      {
        onSuccess: () => {
          reset();
          // The active page may be pinned to an earlier `before` cursor
          // (the person pressed "Load earlier"). Refetching that cursor's
          // page would only ever fetch OLDER rows — the row just appended
          // is newer than it, so it would never appear even though
          // `current` already counts it. Returning to the first page is
          // the review's own prescribed fix.
          setBefore(null);
          setAttempt((n) => n + 1);
        },
        onError: (e: any) => {
          const status = e?.response?.status ?? null;
          const msg =
            e?.response?.data?.message ??
            e?.message ??
            'The gateway refused this append — nothing was written.';
          setSubmitError(status ? `${msg} (HTTP ${status})` : msg);
          setAttempt((n) => n + 1);
        },
      },
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      label={`Verdict ledger — ${orderLabel}`}
      eyebrow="Receiving verdict ledger · append-only"
      title={orderLabel}
    >
      {/* `.mdv-ovl__body` carries no padding of its own (sheet.css) — a Sheet
          whose content is a form pads it, the way `.mdv-form` does (12px 16px). */}
      <div style={{ fontFamily: SANS, padding: '12px 16px 18px' }}>
        {vendorName && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-2, #4F473C)', margin: '0 0 4px' }}>
            {vendorName}
          </p>
        )}
        {orderedSentence && (
          <p
            style={{
              fontFamily: MONO,
              fontSize: 11,
              color: 'var(--ink-4, #665D50)',
              margin: '0 0 12px',
            }}
          >
            {orderedSentence}
          </p>
        )}

        {isError && (
          <p role="alert" style={{ fontSize: 12.5, color: 'var(--ink-1, #211C16)' }}>
            {failure?.forbidden
              ? 'This account is not permitted to see this ledger.'
              : `The ledger could not be loaded (${failure?.message ?? 'request failed'}).`}{' '}
            <button
              type="button"
              onClick={() => refetch()}
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--seal-deep, #14515C)',
                cursor: 'pointer',
                fontSize: 12.5,
                textDecoration: 'underline',
              }}
            >
              Try again
            </button>
          </p>
        )}

        {!isError && isLoading && entries.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-4, #665D50)' }}>Reaching the gateway…</p>
        )}

        {!isError && !isLoading && entries.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-4, #665D50)', fontStyle: 'italic' }}>
            No verdict yet — the first entry appended below starts this line's ledger.
          </p>
        )}

        {entries.length > 0 && (
          <>
            <ul style={{ listStyle: 'none', margin: '0 0 4px', padding: 0 }}>
              {entries.map((e, i) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  index={idToOrdinal.get(e.id) ?? i + 1}
                  superseded={supersededIds.has(e.id)}
                  supersedesLabel={e.supersedes ? idToLabel(e.supersedes) : null}
                />
              ))}
            </ul>

            {ledger?.hasEarlier && (
              <button
                type="button"
                onClick={() => ledger.earliestCursor && setBefore(ledger.earliestCursor)}
                disabled={isLoading}
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'var(--seal-deep, #14515C)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px 0',
                }}
              >
                {isLoading ? 'Loading…' : 'Load earlier entries'}
              </button>
            )}

            <p
              style={{
                fontFamily: MONO,
                fontSize: 10.5,
                color: 'var(--ink-4, #665D50)',
                margin: '4px 0 12px',
              }}
            >
              {ledger?.totalEntries ?? entries.length} total entr
              {(ledger?.totalEntries ?? entries.length) === 1 ? 'y' : 'ies'}
              {entries.length < (ledger?.totalEntries ?? entries.length) ? ` · ${entries.length} shown` : ''}
            </p>

            <div
              style={{
                borderTop: '1px solid var(--paper-2, #EAE4D8)',
                paddingTop: 8,
                marginBottom: 16,
              }}
            >
              <span style={capStyle}>Current · derived</span>
              {ledger && ledger.current.length === 0 && (
                <p style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--ink-4, #665D50)', margin: '4px 0 0' }}>
                  no verdict stands after taking into account
                </p>
              )}
              {ledger &&
                ledger.current.map((c) => (
                  <div key={`${c.verdict}-${c.beyondOrder}-${c.currentUnit}`} style={{ margin: '4px 0 0' }}>
                    <p
                      style={{
                        fontFamily: MONO,
                        fontSize: 12.5,
                        fontVariantNumeric: 'tabular-nums',
                        color: 'var(--ink-1, #211C16)',
                        margin: 0,
                      }}
                    >
                      {VERDICT_LABEL[c.verdict]}
                      {c.beyondOrder ? ' (beyond order)' : ''}{' '}
                      {/* A keg or a litre is never converted to "btl" — see document-types.ts toBottles. */}
                      {fmtUnits(c.currentQty, c.currentUnit === 'bottle' ? 'bottle' : c.currentUnit)}
                      <span style={{ color: 'var(--ink-4, #665D50)', fontWeight: 400 }}>
                        {' '}
                        · {c.entryCount} entr{c.entryCount === 1 ? 'y' : 'ies'}
                      </span>
                    </p>
                    {/* The server's own arithmetic — this figure opens to its
                        sources rather than asking a manager to trust it
                        (fixer review, 2026-09-18). */}
                    {c.arithmetic && (
                      <p
                        style={{
                          fontFamily: MONO,
                          fontSize: 10.5,
                          color: 'var(--ink-4, #665D50)',
                          margin: '1px 0 0',
                        }}
                      >
                        {c.arithmetic}
                      </p>
                    )}
                  </div>
                ))}
              {ledger && ledger.notCountedBottles != null && (
                <p
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: 'var(--ink-4, #665D50)',
                    margin: '6px 0 0',
                  }}
                >
                  not counted {ledger.notCountedBottles} btl
                  <span style={{ color: 'var(--ink-4, #665D50)', fontWeight: 400 }}>
                    {' '}
                    · against {ledger.orderedBottles} btl ordered
                  </span>
                </p>
              )}
            </div>
          </>
        )}

        {/* An append is a write nothing can undo (the table refuses UPDATE and
            DELETE from every role), and the "takes from" picker is built from
            the history. With the read failed there is no history and no picker,
            so the form is not offered — not merely disabled — until the read
            lands. What the person already typed stays in state and comes back. */}
        {isError && (
          <p
            data-testid="ledger-append-paused"
            style={{
              borderTop: '1px solid var(--paper-2, #EAE4D8)',
              paddingTop: 12,
              fontSize: 12,
              color: 'var(--ink-2, #4F473C)',
              margin: 0,
            }}
          >
            Appending is paused until the ledger loads. An entry cannot be undone, so it is not
            offered without the history it would sit beside.
          </p>
        )}

        {!isError && (
        <form
          onSubmit={(e) => e.preventDefault()}
          style={{ borderTop: '1px solid var(--paper-2, #EAE4D8)', paddingTop: 12 }}
        >
          <span style={capStyle}>Append an entry</span>

          <div
            style={{ display: 'flex', gap: 6, margin: '8px 0' }}
            role="radiogroup"
            aria-label="Verdict"
            onKeyDown={(e) => {
              if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
              e.preventDefault();
              const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
              const from = Math.max(0, VERDICT_ORDER.indexOf(verdict ?? VERDICT_ORDER[0]));
              const next = VERDICT_ORDER[(from + (forward ? 1 : -1) + VERDICT_ORDER.length) % VERDICT_ORDER.length];
              setVerdict(next);
              verdictButtonRefs.current[next]?.focus();
            }}
          >
            {VERDICT_ORDER.map((v) => {
              const on = verdict === v;
              return (
                <button
                  key={v}
                  ref={(el) => {
                    verdictButtonRefs.current[v] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  // Roving tabindex: only the checked radio (or the first,
                  // when nothing is chosen yet) sits in the tab order — the
                  // arrow keys move focus among the rest (fixer review,
                  // 2026-09-18).
                  tabIndex={on || (!verdict && v === VERDICT_ORDER[0]) ? 0 : -1}
                  onClick={() => setVerdict(v)}
                  style={{
                    flex: 1,
                    fontFamily: SANS,
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: '7px 4px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: on
                      ? '1px solid var(--seal, #1A5E6B)'
                      : '1px solid var(--paper-2, #EAE4D8)',
                    background: 'transparent',
                    color: on ? 'var(--seal-deep, #14515C)' : 'var(--ink-2, #4F473C)',
                    textDecoration: on ? 'underline' : 'none',
                  }}
                >
                  {VERDICT_LABEL[v]}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <label style={{ flex: 1, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
              Quantity
              <input
                type="number"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="—"
                className="mdv-input"
                style={{ marginTop: 2, fontFamily: MONO }}
              />
            </label>
            <label style={{ flex: 1, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
              Unit — as counted
              <select
                value={uom}
                onChange={(e) => setUom(e.target.value)}
                className="mdv-select"
                style={{ marginTop: 2 }}
              >
                <option value="">Choose…</option>
                {ORDER_UNIT_TYPES.map((u) => (
                  <option key={u} value={u}>
                    {u.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={beyondOrder}
              onChange={(e) => setBeyondOrder(e.target.checked)}
              style={{ accentColor: 'var(--seal, #1A5E6B)' }}
            />
            This portion arrived beyond what was ordered
          </label>

          <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-4, #665D50)', marginBottom: 8 }}>
            Reason — required
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="Why, in your own words"
              className="mdv-input"
              style={{ marginTop: 2, resize: 'vertical' }}
            />
          </label>

          <label style={{ display: 'block', fontSize: 11, color: 'var(--ink-4, #665D50)', marginBottom: 8 }}>
            Evidence note — optional, a reference not a file
            <input
              type="text"
              value={evidenceNote}
              onChange={(e) => setEvidenceNote(e.target.value)}
              placeholder="e.g. photo filed with the driver's slip"
              className="mdv-input"
              style={{ marginTop: 2 }}
            />
          </label>

          {entries.length > 0 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <label style={{ flex: 1, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                Takes from — optional
                <select
                  value={supersedes}
                  onChange={(e) => setSupersedes(e.target.value)}
                  className="mdv-select"
                  style={{ marginTop: 2 }}
                >
                  <option value="">Nothing — a new portion</option>
                  {entries.map((e) => (
                    <option key={e.id} value={e.id}>
                      v{idToOrdinal.get(e.id) ?? '?'} · {VERDICT_LABEL[e.verdict]} · {unitLabel(e.qty, e.uom)}
                    </option>
                  ))}
                </select>
              </label>
              {supersedes && (
                <label style={{ flex: 1, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
                  How much, in bottles — blank = all of it
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={supersedesQtyBottles}
                    onChange={(e) => setSupersedesQtyBottles(e.target.value)}
                    className="mdv-input"
                    style={{ marginTop: 2, fontFamily: MONO }}
                  />
                </label>
              )}
            </div>
          )}

          <HoldToApprove
            key={`verdict-append-${orderId}-${attempt}`}
            label={
              canSubmit
                ? `Hold to append — ${VERDICT_LABEL[verdict as LineVerdictWord]} ${unitLabel(Number(qty), uom)}`
                : 'Hold to append — choose a verdict, a quantity, a unit and a reason first'
            }
            approvedLabel="Appended — the ledger below now includes it"
            disabled={!canSubmit || append.isPending}
            onApprove={onHold}
          />
          {submitError && (
            <p role="alert" style={{ fontSize: 11.5, color: 'var(--ink-1, #211C16)', margin: '6px 0 0' }}>
              {submitError}
            </p>
          )}
          <p style={{ fontSize: 10.5, color: 'var(--ink-4, #665D50)', margin: '8px 0 0' }}>
            Appending here does not yet change this order&rsquo;s own match verdict or the
            dollars-at-risk figure above — the two are not reconciled yet.
          </p>
        </form>
        )}
      </div>
    </Sheet>
  );
}

export default RcVerdictLedger;
