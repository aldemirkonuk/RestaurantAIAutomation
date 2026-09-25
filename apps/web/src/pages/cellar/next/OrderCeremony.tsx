/**
 * The order-hold ceremony a house's setting chooses (ADR 0160 sec110 item 6).
 *
 * ADR 0160's corrected text names TWO modes, not three, and the hold is "the
 * one deliberate act in both" — they differ only in what happens right after
 * it completes:
 *
 *   hold — DEFAULT. The existing press-and-hold gesture, `HoldToApprove`,
 *          unchanged — plus one more question after it lands: "Send it?".
 *          Only a "Yes" on that question fires the real write; a "Cancel"
 *          (or a failed write) returns the gesture to a fresh, re-armable
 *          start. Its own reduced-motion path is ALREADY a two-step
 *          arm-then-confirm (HoldToApprove.tsx:16-18) for the HOLD itself —
 *          this component's own extra question is a SEPARATE, second step on
 *          top of that, not a substitute for it.
 *   auto — the SAME press-and-hold gesture, wired straight to the write: the
 *          moment the hold completes, the write fires — no follow-up
 *          question.
 *
 * FIXED 2026-09-19 (cellar re-verification, two BLOCKING findings). Before
 * this fix there were three shapes here — `hold` (a bare press-and-hold, no
 * follow-up), `confirm` (one click arms an "are you sure?" ask, a second
 * click sends — NO hold gesture at all), and `auto` (one click sends
 * immediately — NO hold, NO question). That vocabulary was transcribed from
 * the founder's PRE-correction dictation; ADR 0160 sec110 item 6 itself names
 * it wrong ("the original line gave three modes ... his words give two") and
 * its answered open question is explicit that the hold never drops out:
 * "Auto = hold, no confirm — the hold stays the one deliberate act in both
 * modes." The shipped `auto` (a plain `<button>`, no hold at all) was exactly
 * the design that same answer rules out ("an order with no human hold at
 * all, which would bypass ADR 0112's seal on a money act"). `confirm` and the
 * old `auto` are both removed; the two ceremonies below are the corrected two
 * modes, and BOTH open with `HoldToApprove` — the only difference is whether
 * a "Send it?" question sits between the hold completing and the write
 * firing.
 *
 * This is a single small component rather than a change to `HoldToApprove`
 * itself: that primitive is called from other pages this build does not own
 * (ADR 0112's shared modal/overlay primitives), and giving it a new ceremony
 * mode would be a change with a blast radius well past `/cellar`. The two
 * shapes below are local to the one place in this page that sends money
 * (`BottleLeaf`'s "Order more" — the only `HoldToApprove` call site under
 * `pages/cellar/next`, confirmed by grep before this was written).
 *
 * THE SENT STATE IS THE MUTATION'S, NOT THE CLICK'S (fixed 2026-09-18,
 * reconfirmed under the two-mode rebuild). `pending`/`sent`/`errorMessage`
 * below come from the CALLER's mutation object (`order.isPending`/
 * `order.isSuccess`/`order.error`), never from a local click flag — and a
 * `sent` prop of `true` now short-circuits BEFORE either ceremony renders
 * (below), rather than only covering the ceremonies that used to lack their
 * own sealed state. `hold`'s own extra "Send it?" step does not call the
 * real write (the caller's `onApprove`) until the person answers it; the
 * promise handed to `HoldToApprove` settles only once that write itself has
 * answered, so `HoldToApprove` still seals ONLY when the gateway has
 * actually confirmed — the same invariant the 2026-09-18 fix established,
 * now extended to cover the extra question in between.
 */

import { useEffect, useRef, useState } from 'react';
import { HoldToApprove } from '@/components/mudavym';
import type { HoldCeremony } from './useCellarNextData';

export interface OrderCeremonyProps {
  ceremony: HoldCeremony;
  label: string;
  approvedLabel: string;
  /**
   * The real write. Returning its own promise is not optional for either
   * ceremony: both open with `HoldToApprove`, which seals only once the
   * promise it is holding resolves — see the file header.
   */
  onApprove: () => void | Promise<unknown>;
  /** True while the order POST is in flight. */
  pending: boolean;
  /** True only once the gateway has confirmed the order — never before. */
  sent: boolean;
  /** Non-null when the last attempt failed; lets the person try again. */
  errorMessage?: string | null;
  disabled?: boolean;
}

/** `hold`'s own extra step, shown on `HoldToApprove`'s own (inert) face. */
const ASK_PENDING_COPY = 'Held — confirm below';
const SENDING_COPY = 'Sending…';
/** Covers both a deliberate Cancel and a real write failure — the specific
 *  reason for a failure comes from `errorNote` alongside this, never here. */
const NOTHING_SENT_COPY = 'Nothing was sent. Try again when ready.';

export default function OrderCeremony({
  ceremony,
  label,
  approvedLabel,
  onApprove,
  pending,
  sent,
  errorMessage = null,
  disabled = false,
}: OrderCeremonyProps) {
  // `hold`'s own extra step: true from the moment the hold completes until
  // the person answers "Send it?", or the gesture is remounted away.
  const [asking, setAsking] = useState(false);
  // True once "Yes, order" has been pressed and the real write is awaited —
  // distinct from the caller's own `pending` prop, which only turns true a
  // tick after the click (once `onApprove` has actually been called and the
  // caller's mutation hook has re-rendered).
  const [confirmSending, setConfirmSending] = useState(false);
  // Bumped on every failed attempt AND every deliberate cancel, under either
  // ceremony. Even though `HoldToApprove` already returns itself to `phase:
  // 'idle'` on a rejected write (its own `refuse()`), the confirmer asked for
  // an explicit remount so a retry never depends on that internal behaviour
  // staying correct — a fresh instance is a fresh, provably clean slate
  // regardless of what state the previous one was left in.
  const [holdAttempt, setHoldAttempt] = useState(0);
  const yesRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Settles the promise `hold` handed to `HoldToApprove` when the hold first
   * completed — resolved once the real write (called from "Yes, order")
   * succeeds, rejected on Cancel or on that write failing. Cleared once
   * settled so a stale settle from an abandoned gesture can never resolve a
   * LATER one.
   */
  const askSettleRef = useRef<{ resolve: () => void; reject: (err: unknown) => void } | null>(null);

  // A failed attempt returns the ceremony to its starting point, remounted,
  // rather than leaving it stuck mid-send. This is a second, independent
  // guarantee alongside the immediate resets in `handleYes`'s own reject
  // branch below (that one clears `asking` the moment the write itself
  // rejects; this one is the safety net if `errorMessage` is the only signal
  // that ever arrives).
  useEffect(() => {
    if (errorMessage) {
      setAsking(false);
      setConfirmSending(false);
      askSettleRef.current = null;
      setHoldAttempt((n) => n + 1);
    }
  }, [errorMessage]);

  // Focus follows the control that just appeared, since the ask row swaps in
  // under a keyboard or screen-reader user rather than merely changing a
  // label.
  useEffect(() => {
    if (asking) yesRef.current?.focus();
  }, [asking]);

  const errorNote = errorMessage ? (
    <p role="alert" className="cl-note" style={{ margin: '6px 0 0' }} data-testid="order-ceremony-error">
      Nothing was sent — {errorMessage}. Try again when ready.
    </p>
  ) : null;

  // A confirmed send is a confirmed send under EITHER ceremony — checked
  // before either branch below renders, so a stale or remounted control can
  // never show a re-armable hold once the caller's own mutation has already
  // succeeded.
  if (sent) {
    return (
      <button type="button" className="cl-btn cl-focus" disabled data-testid="order-ceremony-sent">
        {approvedLabel}
      </button>
    );
  }

  if (ceremony === 'hold') {
    // DEFAULT (ADR 0160 sec110 item 6, corrected): the hold, then one more
    // question before the write fires. `HoldToApprove`'s own `onApprove`
    // (`holdCommitted`) is NOT the real write — it parks a promise on
    // `askSettleRef` and flips to the ask row; only "Yes, order" below calls
    // the caller's real `onApprove`, and THAT write's own outcome is what
    // finally settles the parked promise. So `HoldToApprove` seals exactly
    // when the gateway has answered — never when the hold completes, never
    // on the "Yes" click itself.
    const holdCommitted = (): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        askSettleRef.current = { resolve, reject };
        setAsking(true);
      });

    const handleYes = () => {
      setConfirmSending(true);
      let result: void | Promise<unknown>;
      try {
        result = onApprove();
      } catch (err) {
        askSettleRef.current?.reject(err);
        askSettleRef.current = null;
        setAsking(false);
        setConfirmSending(false);
        return;
      }
      Promise.resolve(result).then(
        () => {
          askSettleRef.current?.resolve();
          askSettleRef.current = null;
          // Resolved locally ahead of the caller's own `sent` prop catching
          // up — `HoldToApprove` is already sealed by this point (its own
          // promise just settled), so dropping the ask row now cannot show
          // a gap where neither the ask nor the seal is on screen.
          setAsking(false);
        },
        (err) => {
          askSettleRef.current?.reject(err);
          askSettleRef.current = null;
          // Cleared immediately rather than waiting on `errorMessage`
          // (below): that prop only updates once the caller's mutation hook
          // re-renders, and a stale ask row sitting next to an
          // already-refused, freshly re-armable `HoldToApprove` would be a
          // visible, if brief, contradiction.
          setAsking(false);
          setConfirmSending(false);
        },
      );
    };

    const handleCancel = () => {
      askSettleRef.current?.reject(new Error('cancelled'));
      askSettleRef.current = null;
      setAsking(false);
      setConfirmSending(false);
      setHoldAttempt((n) => n + 1);
    };

    return (
      <>
        <HoldToApprove
          key={holdAttempt}
          label={label}
          approvedLabel={approvedLabel}
          onApprove={holdCommitted}
          copy={{
            pending: confirmSending ? SENDING_COPY : ASK_PENDING_COPY,
            unconfirmed: NOTHING_SENT_COPY,
          }}
          disabled={disabled || pending || asking}
        />
        {asking ? (
          <span
            style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginTop: 6 }}
            data-testid="order-ceremony-asking"
          >
            <span className="cl-said" style={{ fontSize: 12.5 }} role="status">
              Send it?
            </span>
            <button
              ref={yesRef}
              type="button"
              className="cl-btn cl-focus"
              data-seal="true"
              disabled={confirmSending}
              onClick={handleYes}
              data-testid="order-ceremony-confirm-yes"
            >
              {confirmSending ? 'Sending…' : 'Yes, order'}
            </button>
            <button type="button" className="cl-btn cl-focus" disabled={confirmSending} onClick={handleCancel}>
              Cancel
            </button>
          </span>
        ) : null}
        {errorNote}
      </>
    );
  }

  // ceremony === 'auto': the same hold gesture, wired straight to the real
  // write — no question after it.
  //
  // FIXED 2026-09-18 (cellar confirmer MAJOR, carried over from the
  // pre-correction `hold` shape this replaces). This used to hand
  // `HoldToApprove` a fire-and-forget `onApprove` (`BottleLeaf.tsx` passed
  // `order.mutate(...)`, whose return value is `undefined`), so
  // `HoldToApprove` had no promise to wait on and sealed — showing
  // `approvedLabel`, "Order sent" — the instant the HOLD GESTURE finished,
  // before the gateway had been asked anything; a refusal left it sealed
  // regardless, since nothing ever told it otherwise. `BottleLeaf.tsx` now
  // passes `order.mutateAsync(...)`, which returns the real write promise.
  // `HoldToApprove` is built for exactly this (`HoldToApprove.tsx:242-253`):
  // it seals ONLY once that promise resolves, and a rejection calls its own
  // `refuse()` — phase back to `idle`, nothing sealed, the reader told
  // rather than left staring at a claim the gateway never made. `disabled`
  // also covers `pending` so the gesture cannot be re-armed while the first
  // attempt is still in flight, and the error line joins hold's own release
  // note rather than being the only place a hold failure was silent.
  return (
    <>
      <HoldToApprove
        key={holdAttempt}
        label={label}
        approvedLabel={approvedLabel}
        onApprove={onApprove}
        disabled={disabled || pending}
      />
      {errorNote}
    </>
  );
}
