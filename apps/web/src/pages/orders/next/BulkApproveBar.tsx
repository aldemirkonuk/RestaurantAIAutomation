/**
 * Bulk approve — the dry emboss (sketch 063 sig-03).
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
import { animate, pour, stamp, tuck, useReducedMotion } from '@/lib/mudavym/motion';
import { useApproveOrder } from '@/hooks/queries/useOrderQueries';
import * as ordersApi from '@/services/api/orders';
import { MONO, SANS, fmtMoney } from './format';
import type { OrderRowVM } from './useOrdersNextData';

export interface BulkApproveBarProps {
  selectedRows: OrderRowVM[];
  onClear: () => void;
  /** Called with ids that were actually approved, so selection can shed them. */
  onApproved: (approvedIds: string[]) => void;
  onRunningChange: (running: boolean) => void;
}

type Phase = 'idle' | 'holding' | 'armed' | 'running' | 'done';

const ARM_WINDOW_MS = 3000;

export function BulkApproveBar({ selectedRows, onClear, onApproved, onRunningChange }: BulkApproveBarProps) {
  const approve = useApproveOrder();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{
    ok: number;
    refused: number;
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
   * A mint that fails for ANY row aborts the whole run: the alternative
   * is approving the subset that happened to mint, which would make the
   * bar's count a lie about what the operator agreed to.
   */
  const sealsRef = useRef<Map<string, string> | null>(null);
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
   * Mint every seal, once per gesture. Resolves false when any of them failed,
   * and the caller then approves NOTHING.
   */
  const beginSeals = (): Promise<boolean> => {
    if (sealMintRef.current) return sealMintRef.current;
    const rows = selectedRows.map((r) => r.id);
    const mint = (async () => {
      try {
        const tokens = await Promise.all(rows.map((id) => ordersApi.mintOrderSeal(id)));
        if (tokens.some((t) => !t)) throw new Error('a seal was not issued');
        sealsRef.current = new Map(rows.map((id, i) => [id, tokens[i] as string]));
        return true;
      } catch {
        sealsRef.current = null;
        return false;
      }
    })();
    sealMintRef.current = mint;
    return mint;
  };

  /** The gesture ended without approval, so the seals it began are abandoned. */
  const abandonSeals = () => {
    sealsRef.current = null;
    sealMintRef.current = null;
  };

  const run = async () => {
    if (runningRef.current) return;
    // The seals were begun when the gesture began; this only waits for them.
    // Nothing is approved if any of them failed, and the bar says so.
    const sealed = await beginSeals();
    if (!sealed) {
      setPhase('idle');
      setFill(0);
      setSealNote('The seals could not be issued — nothing approved.');
      return;
    }
    runningRef.current = true;
    onRunningChange(true);
    setPhase('running');
    setNote(null);
    setFill(1);
    const ids = selectedRows.map((r) => r.id);
    const okIds: string[] = [];
    let refused = 0;
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
        refused += 1;
        // Only a 403 carries an explanation. A network error's message is not
        // one, and printing it as a reason would attribute a policy decision to
        // a dropped connection.
        const status = (err as { response?: { status?: number } })?.response?.status;
        const msg = (err as { message?: string })?.message;
        if (status === 403 && msg && !reasons.includes(msg)) reasons.push(msg);
      }
    }
    setProgress({ done: ids.length, total: ids.length });
    // Spent or refused, every seal from this gesture is done.
    abandonSeals();
    setResult({ ok: okIds.length, refused, reasons });
    expectedAfterDoneRef.current = refused;
    setPhase('done');
    onApproved(okIds);
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
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
    armTimerRef.current = setTimeout(() => setPhase((ph) => (ph === 'armed' ? 'idle' : ph)), ARM_WINDOW_MS);
  };

  const stepConfirm = () => {
    if (phase === 'armed') void run();
    else arm();
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
              color: 'var(--ink-3, #7C7365)',
            }}
          >
            {phase === 'done' && result
              ? result.refused > 0
                ? `${result.refused} refused by the gateway — still pending, still selected.`
                : 'The rows settle; the seal stays rationed.'
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
            color: 'var(--ink-3, #7C7365)',
            textDecoration: 'underline',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          {phase === 'done' ? 'Close' : 'Clear'}
        </button>
      </div>

      <div aria-live="polite" style={{ minHeight: 16, marginTop: 2, fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
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

export default BulkApproveBar;
