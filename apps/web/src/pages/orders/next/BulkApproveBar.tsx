/**
 * Bulk approve — the dry emboss (sketch 087 sig-03).
 *
 * The rule it exists for is rationing: fourteen approvals must not land
 * fourteen wax seals, or the seal stops meaning anything. The gesture is the
 * same deliberate hold (pour fill, tuck retreat on early release), but the
 * completion is the same die with NO wax: one blind impression in the paper's
 * own colours, landing once on the group, at a fraction of the stamp's
 * energy, while the rows underneath simply settle.
 *
 * Wired to the real approve mutation, one order at a time, and honest about
 * the split: refused orders are counted, named as still pending, and stay
 * selected.
 */

import { useEffect, useRef, useState } from 'react';
import { Seal } from '@/components/mudavym';
import { animate, pour, sealTiming, stamp, tuck, useReducedMotion } from '@/lib/mudavym/motion';
import { useApproveOrder } from '@/hooks/queries/useOrderQueries';
import * as ordersApi from '@/services/api/orders';
import { MONO, SANS, fmtMoney } from './format';
import type { OrderRowVM } from './useOrdersNextData';
import { approveConflict } from '@/services/api/approveConflict';

export interface BulkApproveBarProps {
  selectedRows: OrderRowVM[];
  onClear: () => void;
  /** Called with ids that were actually approved, so selection can shed them. */
  onApproved: (approvedIds: string[]) => void;
  onRunningChange: (running: boolean) => void;
}

type Phase = 'idle' | 'holding' | 'armed' | 'running' | 'done';

const ARM_WINDOW_MS = 3000;

/**
 * The gateway's sentence, when the failure was a refusal. Only a 403 carries
 * an explanation. A network error's message is not one, and printing it as a
 * reason would attribute a policy decision to a dropped connection.
 */
function refusalReason(err: unknown): string | null {
  const status = (err as { response?: { status?: number } })?.response?.status;
  const msg = (err as { message?: string })?.message;
  return status === 403 && msg ? msg : null;
}

export function BulkApproveBar({ selectedRows, onClear, onApproved, onRunningChange }: BulkApproveBarProps) {
  const approve = useApproveOrder();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{
    ok: number;
    refused: number;
    /** Approved by someone else first (F-775): settled, so not counted as refused. */
    already: number;
    /** Refused with a 409 sentence: not approved, but not "still pending" either. */
    conflicted: number;
    /**
     * The distinct reasons the gateway gave, in the order first seen.
     *
     * A count alone taught nothing: "3 refused" reads as a bug. Since ADR 0116
     * a refusal carries a whole sentence naming the rule and the number, and a
     * bulk run over one house usually hits the SAME rule repeatedly, so the
     * distinct set is short and is the useful thing to print.
     */
    reasons: string[];
  } | null>(null);

  const fillRef = useRef<HTMLDivElement | null>(null);
  const embossRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  const progressRef = useRef(0);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the two-step confirm armed; a double-tap is not a second decision. */
  const armedAtRef = useRef(0);
  const runningRef = useRef(false);
  /** Selection size expected after a finished run (the refused stay selected). */
  const expectedAfterDoneRef = useRef(0);
  /**
   * One seal per selected order, minted when the GESTURE BEGINS.
   *
   * ===================================================================
   * WHY N SEALS AND NOT ONE
   * ===================================================================
   * The dry emboss is one impression on the GROUP, and that is a rule
   * about ritual, not about authority. Each order is still an
   * independent commitment of the house's money, and a challenge is
   * bound to (actor, order, act, that order's own total) — so a single
   * token could not name fourteen orders without meaning "whatever this
   * person selected", which is precisely the open-ended approval the
   * mechanism exists to prevent. Fourteen approvals need fourteen
   * proofs; what is rationed is the wax, not the evidence.
   *
   * A mint that fails for ANY row aborts the whole run (ADR 0116, locked:
   * "approves NOTHING if any mint fails"): approving the subset that happened
   * to mint would make the bar's count a lie about what the operator agreed
   * to. What F-416 (2026-10-09) fixes is the silence: the gateway refuses the
   * seal for everything that would refuse the approval
   * (`issueOrderSealChallenge` runs `assertApprovalAllowed` first), so an
   * order over the manager's ceiling fails at the mint with the rule's own
   * sentence. Every mint is now settled, and each refusal's sentence is
   * printed with the order it belongs to, so the operator can deselect it
   * and hold again. Approving the rest needs ADR 0116 superseded first.
   */
  const sealsRef = useRef<Map<string, string> | null>(null);
  /** Rows whose seal was refused, with the gateway's sentence when it gave one. */
  const mintRefusalsRef = useRef<Map<string, string | null>>(new Map());
  /**
   * The IN-FLIGHT mint. Held separately from the result because `run()` waits
   * for the same mint `startHold()` began: without this, the hold completing
   * before the network answered would start a SECOND set of challenges, and the
   * first set would sit unspent until it expired. One gesture, one mint.
   */
  const sealMintRef = useRef<Promise<boolean> | null>(null);
  const [sealNote, setSealNote] = useState<string | null>(null);

  const count = selectedRows.length;
  const knownTotal = selectedRows.reduce((s, r) => s + (r.total ?? 0), 0);
  const unpriced = selectedRows.filter((r) => r.total === null).length;

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
    },
    [],
  );

  // Selection changed underneath a finished run — return the die to rest.
  // (The refused rows staying selected is NOT a change; a new hand-pick is.)
  useEffect(() => {
    if (phase === 'done' && count !== expectedAfterDoneRef.current) {
      setPhase('idle');
      setResult(null);
      setNote(null);
      setFill(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  const setFill = (p: number) => {
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${p})`;
    progressRef.current = p;
  };

  /**
   * Mint every seal, once per gesture, each settled on its own so every
   * refusal keeps its sentence. Resolves false when ANY seal was not issued,
   * and the caller then approves NOTHING (ADR 0116).
   */
  const beginSeals = (): Promise<boolean> => {
    if (sealMintRef.current) return sealMintRef.current;
    const rows = selectedRows.map((r) => r.id);
    const mint = (async () => {
      const settled = await Promise.allSettled(rows.map((id) => ordersApi.mintOrderSeal(id)));
      const seals = new Map<string, string>();
      const refusals = new Map<string, string | null>();
      settled.forEach((s, i) => {
        if (s.status === 'fulfilled' && s.value) seals.set(rows[i], s.value);
        else refusals.set(rows[i], s.status === 'rejected' ? refusalReason(s.reason) : null);
      });
      sealsRef.current = seals;
      mintRefusalsRef.current = refusals;
      return refusals.size === 0 && seals.size === rows.length;
    })();
    sealMintRef.current = mint;
    return mint;
  };

  /** The gesture ended without approval, so the seals it began are abandoned. */
  const abandonSeals = () => {
    sealsRef.current = null;
    mintRefusalsRef.current = new Map();
    sealMintRef.current = null;
  };

  const run = async () => {
    if (runningRef.current) return;
    // The seals were begun when the gesture began; this only waits for them.
    // Nothing is approved if any of them failed (ADR 0116), and the bar says
    // which orders were refused and why.
    const sealed = await beginSeals();
    if (!sealed) {
      const why = [...mintRefusalsRef.current.entries()]
        .filter(([, reason]) => reason)
        .map(([id, reason]) => {
          const row = selectedRows.find((r) => r.id === id);
          return `${row?.orderNumber ?? 'One order'}: ${reason}`;
        });
      abandonSeals();
      setPhase('idle');
      setFill(0);
      setSealNote(
        why.length > 0
          ? `Nothing was approved — the house would not seal every order. ${why.join(' ')} Take ${why.length === 1 ? 'it' : 'them'} out of the selection and hold again.`
          : 'The seals could not be issued — nothing approved.',
      );
      return;
    }
    runningRef.current = true;
    onRunningChange(true);
    setPhase('running');
    setNote(null);
    setFill(1);
    const ids = selectedRows.map((r) => r.id);
    const okIds: string[] = [];
    const alreadyIds: string[] = [];
    let refused = 0;
    let conflicted = 0;
    const reasons: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      setProgress({ done: i, total: ids.length });
      try {
        await approve.mutateAsync({
          orderId: ids[i],
          challenge: sealsRef.current?.get(ids[i]) ?? null,
        });
        okIds.push(ids[i]);
      } catch (err) {
        // F-775. An order someone else approved first is settled, not refused:
        // it leaves the selection like an approved one. Any other 409 is a
        // sentence of its own and is kept apart from the "still pending" count,
        // because the order may no longer be pending at all.
        const conflict = approveConflict(err);
        if (conflict?.settled) {
          alreadyIds.push(ids[i]);
          continue;
        }
        if (conflict) {
          conflicted += 1;
          if (!reasons.includes(conflict.message)) reasons.push(conflict.message);
          continue;
        }
        refused += 1;
        const msg = refusalReason(err);
        if (msg && !reasons.includes(msg)) reasons.push(msg);
      }
    }
    setProgress({ done: ids.length, total: ids.length });
    // Spent or refused, every seal from this gesture is done.
    abandonSeals();
    setResult({ ok: okIds.length, refused, already: alreadyIds.length, conflicted, reasons });
    expectedAfterDoneRef.current = refused + conflicted;
    setPhase('done');
    onApproved([...okIds, ...alreadyIds]);
    onRunningChange(false);
    runningRef.current = false;
    // The one impression: the die pressed dry into the bar, a third of the
    // stamp's travel, no accent anywhere in it.
    requestAnimationFrame(() => {
      if (embossRef.current) {
        animate(
          embossRef.current,
          [
            { transform: 'rotate(-4deg) scale(0.94)', opacity: 0 },
            { transform: 'rotate(-4deg) scale(1)', opacity: 1 },
          ],
          stamp,
        );
      }
    });
  };

  const startHold = () => {
    setNote(null);
    setSealNote(null);
    void beginSeals();
    setPhase('holding');
    startRef.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / pour.ms);
      setFill(p);
      if (p >= 1) void run();
      else rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const releaseHold = () => {
    if (phase !== 'holding') return;
    cancelAnimationFrame(rafRef.current);
    const p = progressRef.current;
    abandonSeals();
    setPhase('idle');
    setNote(`Released at ${Math.round(p * 100)}% — nothing approved.`);
    if (fillRef.current) {
      animate(fillRef.current, [{ transform: `scaleX(${p})` }, { transform: 'scaleX(0)' }], tuck);
    }
    setFill(0);
  };

  const arm = () => {
    setSealNote(null);
    void beginSeals();
    setPhase('armed');
    armedAtRef.current = Date.now();
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => setPhase((ph) => (ph === 'armed' ? 'idle' : ph)), ARM_WINDOW_MS);
  };

  /** A second press inside the confirm gap is ignored; the bar stays armed. */
  const stepConfirm = () => {
    if (phase !== 'armed') arm();
    else if (Date.now() - armedAtRef.current >= sealTiming.confirmGapMs) void run();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (phase === 'running' || phase === 'done' || count === 0) return;
    if (reduced) {
      stepConfirm();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    startHold();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (phase === 'running' || phase === 'done' || count === 0) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) stepConfirm();
    } else if (e.key === 'Escape' && phase === 'armed') {
      // Esc disarms only — it must not travel on and close a Sheet (F-726).
      e.preventDefault();
      e.nativeEvent.stopPropagation();
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      setPhase('idle');
    }
  };

  if (count === 0 && phase !== 'done') return null;

  return (
    <div
      className="relative mb-3 rounded-xl px-4 py-3"
      style={{
        fontFamily: SANS,
        border: '1px solid var(--paper-2, #EAE4D8)',
        background: 'var(--paper-1, #F3EFE6)',
      }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div style={{ minWidth: 180 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
            {phase === 'done' && result
              ? `${result.ok} approved — one impression.`
              : `${count} pending selected`}
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: MONO,
              fontSize: 11,
              fontVariantNumeric: 'tabular-nums',
              color: 'var(--ink-4, #665D50)',
            }}
          >
            {phase === 'done' && result
              ? doneLine(result)
              : `${fmtMoney(knownTotal)} known${unpriced > 0 ? ` · ${unpriced} unpriced` : ''}`}
          </span>
          {phase === 'done' && result && result.reasons.length > 0 && (
            <span
              role="status"
              style={{
                display: 'block',
                fontFamily: SANS,
                fontSize: 11,
                lineHeight: 1.55,
                color: 'var(--ink-2, #4F473C)',
                marginTop: 3,
                maxWidth: 520,
              }}
            >
              {result.reasons.join(' ')}
            </span>
          )}
        </div>

        {phase !== 'done' && (
          <button
            type="button"
            onPointerDown={onPointerDown}
            onPointerUp={releaseHold}
            onPointerCancel={releaseHold}
            onKeyDown={onKeyDown}
            disabled={phase === 'running'}
            aria-label={`Hold to approve ${count} orders with one dry impression`}
            className="relative flex-1 overflow-hidden rounded-lg px-4"
            style={{
              minHeight: 40,
              minWidth: 220,
              border: '1px solid var(--ink-3, #7C7365)',
              background: 'var(--paper-0, #FAF7F1)',
              color: 'var(--ink-1, #211C16)',
              fontSize: 13,
              fontWeight: 600,
              cursor: phase === 'running' ? 'default' : 'pointer',
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          >
            {/* the fill is ink, not wax — a dry action carries no accent */}
            <div
              ref={fillRef}
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background: 'var(--ink-3, #7C7365)',
                opacity: 0.18,
                transform: 'scaleX(0)',
                transformOrigin: '0 50%',
                pointerEvents: 'none',
              }}
            />
            <span style={{ position: 'relative' }}>
              {phase === 'running' && progress
                ? `Approving ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                : phase === 'armed'
                  ? 'Enter again to approve all'
                  : `Hold to approve all ${count} — one impression, no wax`}
            </span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setPhase('idle');
            setResult(null);
            setNote(null);
            setProgress(null);
            setFill(0);
            onClear();
          }}
          style={{
            fontSize: 12,
            color: 'var(--ink-4, #665D50)',
            textDecoration: 'underline',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {phase === 'done' ? 'Close' : 'Clear'}
        </button>
      </div>

      <div aria-live="polite" style={{ minHeight: 16, marginTop: 2, fontSize: 11, color: 'var(--ink-4, #665D50)' }}>
        {sealNote ?? note ?? (phase === 'armed' ? 'Press Enter again to approve — Esc cancels.' : '')}
      </div>

      {/* the dry emboss — bottom-right, where a clerk stamps a batch sheet */}
      {phase === 'done' && (
        <div
          ref={embossRef}
          aria-hidden
          style={{
            position: 'absolute',
            right: 10,
            bottom: 6,
            transform: 'rotate(-4deg)',
            opacity: 0,
            pointerEvents: 'none',
            // the impression is a change in the paper: ink at low strength, no accent
            color: 'var(--ink-1, #211C16)',
          }}
        >
          <div style={{ opacity: 0.18 }}>
            <Seal size={34} pressed color="currentColor" />
          </div>
        </div>
      )}
    </div>
  );
}

/** The line under the count once a run is done: each outcome named apart. */
function doneLine(result: { refused: number; already: number; conflicted: number }): string {
  const parts: string[] = [];
  if (result.already > 0) {
    parts.push(`${result.already} already approved — nothing to do.`);
  }
  if (result.conflicted > 0) {
    parts.push(`${result.conflicted} not approved — still selected, the reason is below.`);
  }
  if (result.refused > 0) {
    parts.push(`${result.refused} refused by the gateway — still pending, still selected.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'The rows settle; the seal stays rationed.';
}

export default BulkApproveBar;
