/**
 * OneTapPanel — the one-tap actions desk, on the dashboard rail directly under
 * "Waiting on you".
 *
 * WHY IT LIVES HERE (founder's decision, 2026-09-03). One-tap actions were
 * built inside `/notifications` in the p4 first pass. They do not belong
 * there: the day-book is a RECORD — lines the house wrote, worked downwards
 * until the account is ruled off — and a standing action is not a line, it is
 * a piece of work with a next step. The rail already holds the page's
 * work-to-do column ("Waiting on you" → approvals), so an action the house
 * raised sits one panel below the approvals it is a cousin of, and the
 * day-book goes back to being only a book. The two other homes considered and
 * the cost of each are argued in `.planning/06-pages/notifications.md` §1b.
 *
 * SELF-CONTAINED BY CONSTRUCTION. It takes a restaurant id and nothing else:
 * its own read, its own writes, its own view models, its own honesty states.
 * Nothing here imports from `pages/notifications/**` (pages do not import
 * across pages) and nothing here needs the dashboard spine.
 *
 * THE CALM CONTRACT it keeps. A card the house raised is VISUALLY INCAPABLE of
 * looking like something that was carried out: the edge is dashed, the chip
 * names the author, and the line underneath says what has NOT happened.
 * `createSystemAction` inserts no `user_id`
 * (`one-tap-actions.service.ts:366-382`) while `POST /one-tap-actions` stamps
 * the caller (`:150-152`), so an absent author is the STRUCTURAL proof that
 * the house raised the row rather than a person here — not a tone.
 *
 * THE FIRST REAL ACTION (founder, 2026-09-05): "extend the seal to it when the
 * first real action lands, but RUN the ecosystem to run the first real action."
 * `triggerWorkflow` was three `// TODO` branches and a default log, called
 * AFTER the row was stamped `completed` — so the die reported success for a
 * reorder that had not happened. It is now a census with three outcomes, and
 * the card renders the one its type deserves (`one-tap-acts.ts`):
 *
 *   * CONFIRM A DELIVERY is real. The hold mints a one-time seal bound to this
 *     manager, the ORDER the card points at, the act `deliver` and the stock
 *     about to move; the gateway redeems it BEFORE calling
 *     `ProcurementService.markDelivered`, and the card then says how much was
 *     booked. It is the first because it is the only act whose backend exists
 *     end to end and neither spends money nor posts a letter — the reorder
 *     path would have done both (`one-tap-workflow.ts` carries the census).
 *   * A WRITTEN NOTE is a record, and its closing control is now being TRIED
 *     BOTH WAYS (the founder, 2026-09-05: "lets try both, 80 percent simple 20
 *     percent signature"). Eighty per cent of houses get the plain button this
 *     card shipped with; twenty get the hold. The arm comes from the gateway,
 *     per house, and is never chosen here — `note-close-experiment.ts`.
 *
 *     The die on a note is a GESTURE, NOT A SEAL, and the card says so in
 *     words: no `onChallenge` is passed, nothing is minted, nothing is
 *     redeemed. The original objection stands and is what the experiment is
 *     for — a die that means "recorded" beside a die that means "done" is how
 *     the seal stops meaning anything — so the two are told apart in the copy
 *     while the counts are gathered. ADR 0127; ADR 0116 addendum's 2026-09-05
 *     status line.
 *   * EVERYTHING ELSE is disabled and says, in one line, what is not built.
 *     ADR 0083: a control may not claim a write it never makes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Hand, Lock, PenLine, Undo2, UserRound } from 'lucide-react';
import { HoldToApprove } from '@/components/mudavym';
import { apiClient, getErrorMessage } from '@/services/api/client';
import { alreadyDeliveredRefusal, alreadyDeliveredWords } from '@/services/api/orders';
import { DELIVERY_WITHOUT_ORDER, dispositionOf } from './one-tap-acts';
import {
  armToDraw,
  recordNoteCloseEvent,
  useNoteCloseArm,
  type ArmRegister,
} from './note-close-experiment';
import { timeAgo } from './format';
import OneTapSheet, {
  EMPTY_DRAFT,
  draftHasWords,
  draftOf,
  markFor,
  type OneTapDraft,
} from './OneTapSheet';

const MONO = "'JetBrains Mono', ui-monospace, monospace";
const DASHED = '1.5px dashed var(--seal-ring)';

/* ── shapes ──────────────────────────────────────────────────────────────── */

export type OneTapStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'expired';

/** `OneTapActionResponseDto`, as it reaches the browser. */
export interface OneTapAction {
  id: string;
  restaurantId: string;
  /** The AUTHOR. Absent ⇒ the house raised it (see the header note). */
  userId?: string | null;
  actionType: string;
  title: string;
  description?: string;
  actionUrl?: string;
  priority: string;
  /** The MARK the card wears. `OneTapSheet.markFor` falls back rather than blanking. */
  icon?: string | null;
  status: OneTapStatus;
  /** The order a delivery card is about. Absent means there is nothing to book. */
  relatedOrderId?: string | null;
  createdAt: string;
  executedAt?: string;
  expiresAt?: string;
  /** What the execution actually did, as the gateway recorded it. */
  executionResult?: Record<string, unknown> | null;
}

export interface CreateOneTapInput {
  title: string;
  description?: string;
  actionUrl?: string;
  priority: 'low' | 'medium' | 'high';
  /** A name from `ONE_TAP_MARKS`. The gateway's own default is `Zap`. */
  icon?: string;
}

export interface FailureVM {
  status: number | null;
  message: string;
  /** 403/401 — understood and refused. Retrying changes nothing. */
  forbidden: boolean;
}

/**
 * loading — the request is genuinely in flight
 * unreadable — refused (403/401) or broken; the panel SAYS WHICH
 * ready — a real answer, including a real empty desk
 */
export type Register =
  | { state: 'loading' }
  | { state: 'unreadable'; failure: FailureVM }
  | { state: 'ready'; rows: OneTapAction[] };

function failureOf(error: unknown): FailureVM {
  const raw = (error as { response?: { status?: unknown } } | null)?.response?.status;
  const status = typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  return { status, message: getErrorMessage(error), forbidden: status === 403 || status === 401 };
}

function rowsOf(payload: unknown): OneTapAction[] {
  if (Array.isArray(payload)) return payload as OneTapAction[];
  const p = payload as { actions?: unknown; data?: unknown } | null;
  for (const candidate of [p?.actions, p?.data]) {
    if (Array.isArray(candidate)) return candidate as OneTapAction[];
  }
  return [];
}

/* ── the read, tenant-keyed ──────────────────────────────────────────────── */

export interface OneTapDesk {
  register: Register;
  /** The last thing that did not happen, in words. Cleared on the next try. */
  failureNote: string | null;
  refresh: () => void;
  /**
   * Mint the seal for a real act, at the moment the hold begins. Resolves null
   * when the gateway would not issue one — and null is what stops the write.
   */
  mintSeal: (id: string) => Promise<string | null>;
  execute: (id: string, challenge?: string | null) => Promise<OneTapAction | null>;
  cancel: (id: string) => Promise<void>;
  create: (input: CreateOneTapInput) => Promise<void>;
  /** Change an action already on the rail. `PUT /one-tap-actions/:id`. */
  update: (id: string, input: CreateOneTapInput) => Promise<void>;
  /** Take one off the rail for good. `DELETE /one-tap-actions/:id` (a soft delete). */
  remove: (id: string) => Promise<void>;
}

/**
 * Every read and write is keyed by `restaurantId`, and a response that arrives
 * after the restaurant has been switched is discarded rather than rendered —
 * a tenant switch must never leave the previous house's actions on screen.
 */
export function useOneTapActions(restaurantId: string | null): OneTapDesk {
  const [register, setRegister] = useState<Register>({ state: 'loading' });
  const [failureNote, setFailureNote] = useState<string | null>(null);
  const tenant = useRef<string | null>(restaurantId);
  const alive = useRef(true);

  useEffect(() => {
    tenant.current = restaurantId;
    setRegister({ state: 'loading' });
    setFailureNote(null);
  }, [restaurantId]);

  const read = useCallback(async () => {
    if (!restaurantId) return; // identity still resolving — stay loading
    const forTenant = restaurantId;
    try {
      const res = await apiClient.get('/one-tap-actions', {
        params: { restaurantId: forTenant },
      });
      if (!alive.current || tenant.current !== forTenant) return;
      setRegister({ state: 'ready', rows: rowsOf(res.data) });
    } catch (err) {
      if (!alive.current || tenant.current !== forTenant) return;
      setRegister({ state: 'unreadable', failure: failureOf(err) });
    }
  }, [restaurantId]);

  useEffect(() => {
    alive.current = true;
    void read();
    return () => {
      alive.current = false;
    };
  }, [read]);

  /**
   * Mint the proof, once, when the gesture begins.
   *
   * A refusal here is not a failure of the network: the gateway refuses to
   * issue a seal for an act it would refuse anyway (already delivered, no
   * order, not your house), and that sentence is the useful one. It is shown as
   * itself for a 400/403 and framed only for something that carries no
   * decision.
   */
  const mintSeal = useCallback(async (id: string): Promise<string | null> => {
    setFailureNote(null);
    try {
      const res = await apiClient.post<{ challenge?: string }>(
        `/one-tap-actions/${id}/seal-challenge`,
        {},
      );
      const challenge = res.data?.challenge ?? null;
      if (!challenge) {
        setFailureNote('The seal was not issued, so nothing was confirmed. Hold it again.');
        return null;
      }
      return challenge;
    } catch (err) {
      // The mint refuses an already-arrived order too, and now with the same
      // 409 body as the write (`one-tap-actions.service.ts`). Shown as the
      // delivery it is: the seal was withheld because there is nothing left to
      // seal, which is a fact about the order, not about the seal.
      const refused = alreadyDeliveredRefusal(err);
      if (refused) {
        setFailureNote(alreadyDeliveredWords(refused));
        return null;
      }
      const failure = failureOf(err);
      setFailureNote(
        failure.status === 400 || failure.status === 403
          ? failure.message
          : `The seal could not be issued (${failure.message}) — nothing was confirmed.`,
      );
      return null;
    }
  }, []);

  /**
   * Carry it out, carrying the seal back in the header the way an order
   * approval does. The gateway's refusal is a whole sentence since it names
   * which rule fired, so a 400 or 403 is printed as itself; anything else keeps
   * the generic framing, because a dropped connection explains nothing.
   */
  const execute = useCallback(
    async (id: string, challenge?: string | null): Promise<OneTapAction | null> => {
      setFailureNote(null);
      try {
        const res = await apiClient.post<OneTapAction>(
          `/one-tap-actions/${id}/execute`,
          {},
          challenge ? { headers: { 'X-Seal-Challenge': challenge } } : undefined,
        );
        await read();
        return res.data ?? null;
      } catch (err) {
        // ALREADY DELIVERED IS ANSWERED, NOT FRAMED AS A FAILURE.
        //
        // Founder, 2026-09-05 (batch 46): the refusal is a 409 so this rail can
        // *"tell 'already done' from 'you sent nonsense' and show the earlier
        // delivery instead of an error."* Before that it could not — the branch
        // below printed the gateway's sentence for a 400 or a 403 and dressed
        // everything else as "Marking it done was refused", so a manager whose
        // colleague had already booked the truck in read a failure notice
        // instead of who took it in and when.
        const refused = alreadyDeliveredRefusal(err);
        if (refused) {
          setFailureNote(alreadyDeliveredWords(refused));
          throw err;
        }
        const failure = failureOf(err);
        setFailureNote(
          failure.status === 400 || failure.status === 403
            ? failure.message
            : `Marking it done was refused (${failure.message}) — the action is unchanged.`,
        );
        throw err;
      }
    },
    [read],
  );

  const cancel = useCallback(
    async (id: string) => {
      setFailureNote(null);
      try {
        await apiClient.post(`/one-tap-actions/${id}/cancel`, {});
        await read();
      } catch (err) {
        setFailureNote(
          `Ruling it out was refused (${failureOf(err).message}) — the action is unchanged.`,
        );
        throw err;
      }
    },
    [read],
  );

  const create = useCallback(
    async (input: CreateOneTapInput) => {
      setFailureNote(null);
      try {
        // No restaurantId and no author in the body on purpose: the gateway
        // takes both from the token (`one-tap-actions.controller.ts:146`), and
        // an id sent from a browser is an id a browser could change.
        await apiClient.post('/one-tap-actions', {
          title: input.title,
          description: input.description || undefined,
          actionUrl: input.actionUrl || undefined,
          actionType: 'custom',
          priority: input.priority,
          icon: input.icon || undefined,
        });
        await read();
      } catch (err) {
        setFailureNote(`The action was not saved (${failureOf(err).message}) — nothing was created.`);
        throw err;
      }
    },
    [read],
  );

  /**
   * Change one already on the rail.
   *
   * The refusal names what did NOT happen and, crucially, that the row is
   * unchanged — a "could not save" that leaves an operator unsure whether half
   * of it landed is the failure this house calls a lie by omission.
   */
  const update = useCallback(
    async (id: string, input: CreateOneTapInput) => {
      setFailureNote(null);
      try {
        await apiClient.put(`/one-tap-actions/${id}`, {
          title: input.title,
          description: input.description ?? '',
          actionUrl: input.actionUrl ?? '',
          priority: input.priority,
          icon: input.icon || undefined,
        });
        await read();
      } catch (err) {
        const failure = failureOf(err);
        setFailureNote(
          failure.forbidden
            ? `This account may not change actions on this rail (${failure.status}). The action is unchanged.`
            : `The change was not saved (${failure.message}) — the action is unchanged.`,
        );
        throw err;
      }
    },
    [read],
  );

  const remove = useCallback(
    async (id: string) => {
      setFailureNote(null);
      try {
        await apiClient.delete(`/one-tap-actions/${id}`);
        await read();
      } catch (err) {
        const failure = failureOf(err);
        setFailureNote(
          failure.forbidden
            ? `This account may not take actions off this rail (${failure.status}). It is still there.`
            : `Taking it off the rail was refused (${failure.message}) — it is still there.`,
        );
        throw err;
      }
    },
    [read],
  );

  return {
    register,
    failureNote,
    refresh: () => void read(),
    mintSeal,
    execute,
    cancel,
    create,
    update,
    remove,
  };
}

/* ── the card ────────────────────────────────────────────────────────────── */

function CalmChip({ children, icon: Icon }: { children: string; icon: typeof Hand }) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{
        fontFamily: MONO,
        fontSize: 8.5,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--seal-deep)',
        border: DASHED,
        borderRadius: 3,
        padding: '2px 6px',
      }}
    >
      <Icon size={10} strokeWidth={1.75} aria-hidden />
      {children}
    </span>
  );
}

/**
 * The words a delivery card says after the act, built from what the GATEWAY
 * recorded rather than from what the browser asked for. A count the client
 * assumed would be a number nobody measured.
 */
function deliveryWords(result: Record<string, unknown> | null | undefined): string {
  const booked = result?.bottlesBooked ?? result?.quantityBooked;
  const orderNumber = result?.orderNumber;
  const named = typeof orderNumber === 'string' && orderNumber.trim() !== ''
    ? ` on ${orderNumber}`
    : '';
  if (typeof booked === 'number' && Number.isFinite(booked)) {
    return `Delivery confirmed${named} — ${booked} ${booked === 1 ? 'bottle' : 'bottles'} booked into stock.`;
  }
  // The write happened; the count did not come back. An em dash, never a zero.
  return `Delivery confirmed${named} — the quantity booked came back as —.`;
}

export function ActionCard({
  action,
  byHouse,
  noteArm,
  onMintSeal,
  onExecute,
  onCancel,
  onEdit,
}: {
  action: OneTapAction;
  byHouse: boolean;
  /** Which closing control a written note gets here. See `note-close-experiment.ts`. */
  noteArm: ArmRegister;
  onMintSeal: (id: string) => Promise<string | null>;
  onExecute: (id: string, challenge?: string | null) => Promise<OneTapAction | null>;
  onCancel: (id: string) => Promise<void>;
  /** Re-open a person-written action in the sheet. Absent on a house-raised one. */
  onEdit?: (action: OneTapAction) => void;
}) {
  // Bumped after a refusal so the die remounts at rest rather than staying sealed.
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const disposition = dispositionOf(action.actionType);
  const sealable = disposition.kind === 'workflow' && !!action.relatedOrderId;
  const blocked =
    disposition.kind === 'unbuilt'
      ? disposition.sentence
      : disposition.kind === 'workflow' && !action.relatedOrderId
        ? DELIVERY_WITHOUT_ORDER
        : null;

  /* ── the experiment on how a note is closed ────────────────────────────
   * The founder, 2026-09-05: "lets try both, 80 percent simple 20 percent
   * signature". The arm is the gateway's, per house, never chosen here.
   *
   * NOTHING IS RECORDED WHEN THE ARM COULD NOT BE READ. The card falls back to
   * the plain control and says so, but the server would stamp the event with
   * this house's STORED arm — which may be the die. Filing a plain exposure
   * under the die is worse than not counting it, so a failed read counts
   * nothing and the report says the counts are a floor. */
  const isNote = disposition.kind === 'record';
  const drawnArm = isNote ? armToDraw(noteArm) : null;
  const measurable = isNote && noteArm.state === 'assigned';
  const exposedAt = useRef<number | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    if (!measurable || drawnArm === null || exposedAt.current !== null) return;
    exposedAt.current = Date.now();
    recordNoteCloseEvent({ event: 'exposed', actionId: action.id });
  }, [measurable, drawnArm, action.id]);

  useEffect(
    () => () => {
      // Left standing. Recorded on unmount — a tenant switch, a navigation, the
      // card dropping out of `pending` for any reason other than this person
      // closing it. A tab closed outright records nothing (the web app may not
      // reach the gateway with a keepalive fetch), which is why the report line
      // calls the abandon count a floor. Both arms lose the same cases.
      if (exposedAt.current !== null && !settled.current)
        recordNoteCloseEvent({ event: 'abandoned', actionId: action.id });
    },
    [action.id],
  );

  /** Closing the note, for either arm. One path, so the two cannot diverge. */
  const closeTheNote = useCallback(() => {
    setRunning(true);
    void onExecute(action.id)
      .then(() => {
        settled.current = true;
        if (exposedAt.current !== null)
          recordNoteCloseEvent({
            event: 'completed',
            actionId: action.id,
            durationMs: Date.now() - exposedAt.current,
          });
      })
      .catch(() => undefined)
      .finally(() => setRunning(false));
  }, [action.id, onExecute]);

  /** What this card's "done" is, said before it is pressed rather than after. */
  const promise =
    disposition.kind === 'workflow'
      ? 'Confirming this books the delivery into stock through the order it names. The hold mints a seal the write has to carry back, so an order edited in the meantime is refused rather than booked.'
      : drawnArm === 'die'
        ? // The die on a note is a GESTURE, NOT A SEAL, and the card has to say
          // so. ADR 0116's addendum made an order approval a REDEEMED seal —
          // minted when the hold begins, spent by the write. Nothing is minted
          // here and nothing is redeemed, and a wax impression that looked the
          // same in both places would empty the word.
          'Holding records the decision against your name. Nothing else moves, and this die is a gesture rather than a seal — nothing is minted and nothing is redeemed.'
        : drawnArm === 'plain'
          ? 'Marking it done records the decision against your name. Nothing else moves — a written action has no workflow behind it, and the plain button says so.'
          : null;

  return (
    <li
      className="rounded-md px-3 py-2.5"
      style={{
        border: byHouse ? DASHED : '1px solid var(--paper-2)',
        background: 'var(--paper-1)',
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <CalmChip icon={byHouse ? Hand : UserRound}>
          {byHouse ? 'Raised by the house · not done' : 'Raised by a person here'}
        </CalmChip>
        <span style={{ fontFamily: MONO, fontSize: 10.5 }} className="text-inkm-4">
          {timeAgo(action.createdAt)}
        </span>
      </div>
      <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-inkm-1">
        {/* The mark the writer chose. Never nothing: `markFor` falls back to the
            gateway's own default rather than leaving a hole where a glyph was. */}
        {(() => {
          const Mark = markFor(action.icon);
          return <Mark size={13} strokeWidth={1.75} aria-hidden />;
        })()}
        {action.title}
      </p>
      {action.description && (
        <p className="mt-0.5 text-[11.5px] text-inkm-4">{action.description}</p>
      )}
      {promise && <p className="mt-1 text-[11px] text-inkm-4">{promise}</p>}
      {blocked && (
        <p className="mt-1 text-[11px] text-inkm-2">{blocked}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {action.actionUrl && (
          <Link
            to={action.actionUrl.startsWith('/') ? action.actionUrl : `/${action.actionUrl}`}
            className="dn-ink inline-flex items-center gap-1.5 rounded border border-seal-ring px-2 py-1 text-[11px] text-seal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          >
            Go and do it
            <ArrowRight size={12} strokeWidth={1.75} aria-hidden />
          </Link>
        )}
        {onEdit && (
          <button
            type="button"
            onClick={() => onEdit(action)}
            data-testid="one-tap-edit"
            className="dn-ink inline-flex items-center gap-1.5 rounded border border-paper-2 px-2 py-1 text-[11px] text-inkm-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          >
            <PenLine size={12} strokeWidth={1.75} aria-hidden />
            Change it
          </button>
        )}
        <button
          type="button"
          onClick={() => void onCancel(action.id).catch(() => undefined)}
          className="dn-ink inline-flex items-center gap-1.5 rounded border border-paper-2 px-2 py-1 text-[11px] text-inkm-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
        >
          <Undo2 size={12} strokeWidth={1.75} aria-hidden />
          Undo — rule it out
        </button>

        {/* The one act that really happens gets the wax. */}
        {sealable && (
          <div className="min-w-[180px] flex-1">
            <HoldToApprove
              key={attempt}
              label="Hold to confirm the delivery"
              approvedLabel="Booked in"
              disabled={running}
              onChallenge={() => onMintSeal(action.id)}
              onApprove={(challenge) => {
                setRunning(true);
                setOutcome(null);
                void onExecute(action.id, challenge)
                  .then((updated) => {
                    setOutcome(deliveryWords(updated?.executionResult));
                  })
                  .catch(() => {
                    // The desk's failureNote carries the gateway's sentence; the
                    // die returns to rest so it never reads "Booked in" over an
                    // order that is still waiting.
                    setAttempt((a) => a + 1);
                  })
                  .finally(() => setRunning(false));
              }}
            />
          </div>
        )}

        {/* The note's closing control, tried both ways (the founder, 2026-09-05).
            Both arms run `closeTheNote` — one write, one recorded outcome, so
            the two arms cannot come to mean different things. */}
        {isNote && drawnArm === 'plain' && (
          <button
            type="button"
            disabled={running}
            data-note-arm="plain"
            onClick={closeTheNote}
            className="dn-ink inline-flex items-center gap-1.5 rounded border border-seal-ring bg-seal-tint px-2 py-1 text-[11px] font-semibold text-seal disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
          >
            <Check size={12} strokeWidth={1.75} aria-hidden />
            {running ? 'Writing it down…' : 'Mark it done'}
          </button>
        )}
        {isNote && drawnArm === 'die' && (
          <div className="min-w-[180px] flex-1" data-note-arm="die">
            {/* No `onChallenge`. That is the difference between this and the
                delivery card above it: there is no seal to mint for a row that
                only records a decision, and passing one would be a ceremony
                over nothing. */}
            <HoldToApprove
              label="Hold to write it down"
              approvedLabel="Written down"
              disabled={running}
              onApprove={closeTheNote}
            />
          </div>
        )}
        {isNote && drawnArm === null && (
          <p className="text-[11px] italic text-inkm-4">
            Reading which closing control this house is on.
          </p>
        )}

        {/* Nothing to press. Disabled, and the sentence above says why. */}
        {blocked && (
          <button
            type="button"
            disabled
            aria-disabled="true"
            title={blocked}
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded border border-paper-2 px-2 py-1 text-[11px] text-inkm-4 opacity-60"
          >
            <Lock size={12} strokeWidth={1.75} aria-hidden />
            Not built yet
          </button>
        )}
      </div>
      {/* A failed read is never dressed as an assignment. The control below is
          the plain one because plain is the product as built, and this line
          says that is a fallback rather than what this house was given. */}
      {isNote && noteArm.state === 'unreadable' && (
        <p role="status" className="mt-1.5 text-[11px] text-inkm-4">
          Which closing control this house should see could not be read (
          {noteArm.message}), so this is the plain one — a fallback, not an
          assignment. Nothing about this card is being counted.
        </p>
      )}
      {outcome && (
        <p role="status" className="mt-1.5 text-[11.5px] text-inkm-2">
          {outcome}
        </p>
      )}
    </li>
  );
}

/* ── the panel ───────────────────────────────────────────────────────────── */

export interface OneTapPanelProps {
  restaurantId: string | null;
}

export function OneTapPanel({ restaurantId }: OneTapPanelProps) {
  const desk = useOneTapActions(restaurantId);
  /* Read ONCE for the panel rather than per card: two cards in one house are
     one house, and a per-card read would ask the same question five times and
     could answer it differently if one of them failed. */
  const noteArm = useNoteCloseArm(restaurantId);
  const [open, setOpen] = useState(false);
  /* THE STUB (sketch 103, 1b). The draft lives HERE, not in the sheet, so Esc
     tears the sheet off rather than binning the words: the rail says it is
     holding them and re-opening finds them where they were left. */
  const [draft, setDraft] = useState<OneTapDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<OneTapAction | null>(null);
  const [saving, setSaving] = useState(false);

  const rows = desk.register.state === 'ready' ? desk.register.rows : [];
  const pending = rows.filter((a) => a.status === 'pending');
  const byHouse = pending.filter((a) => !a.userId);
  const byPeople = pending.filter((a) => !!a.userId);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (a: OneTapAction) => {
    setEditing(a);
    setDraft(draftOf(a));
    setOpen(true);
  };

  /* Leaving an EDIT keeps nothing: the words on the rail are the action's own,
     and a half-typed change to somebody else's row is not a stub, it is a
     confusion. Only a NEW action leaves one. */
  const leave = () => {
    setOpen(false);
    if (editing) {
      setEditing(null);
      setDraft(EMPTY_DRAFT);
    }
  };

  const save = async (d: OneTapDraft, editingId: string | null) => {
    if (saving) return;
    setSaving(true);
    try {
      const input = {
        title: d.title.trim(),
        description: d.description.trim(),
        actionUrl: d.actionUrl.trim(),
        priority: d.priority,
        icon: d.mark,
      };
      if (editingId) await desk.update(editingId, input);
      else await desk.create(input);
      // Cleared only after the gateway accepted it. A form emptied on the way
      // out would lose the words to a refusal (ADR 0020).
      setDraft(EMPTY_DRAFT);
      setEditing(null);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await desk.remove(id);
      setDraft(EMPTY_DRAFT);
      setEditing(null);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const stubHeld = !editing && draftHasWords(draft);

  return (
    <section
      className="rounded-lg border border-paper-2 bg-paper-0 p-4"
      aria-label="One-tap actions"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="inline-flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-inkm-1">
          <Hand size={13} strokeWidth={1.75} aria-hidden />
          One-tap actions
        </h2>
        <span className="text-[11px] uppercase tracking-[0.1em] text-inkm-4" style={{ fontFamily: MONO }}>
          {desk.register.state === 'ready' ? pending.length : '—'}
        </span>
      </div>

      <div className="mt-3">
        {desk.register.state === 'loading' && (
          <div className="space-y-2">
            <div className="dn-skel h-9" aria-hidden />
            <div className="dn-skel h-9 w-4/5" aria-hidden />
          </div>
        )}

        {desk.register.state === 'unreadable' && (
          <p role="status" className="text-[12px] text-inkm-2">
            {desk.register.failure.forbidden
              ? `The one-tap register refused this account (${desk.register.failure.status ?? 'refused'}). Nothing is listed because nothing could be read — an owner or manager account can read it.`
              : `The one-tap register could not be read (${desk.register.failure.message}). Nothing is listed because nothing could be read — this is not an empty desk.`}
          </p>
        )}

        {desk.register.state === 'ready' && pending.length === 0 && (
          <p className="text-[12px] italic text-inkm-4">
            Nothing standing. Actions the house raises for itself land here, dashed and unsent,
            until a person decides.
          </p>
        )}

        {pending.length > 0 && (
          <ul className="space-y-2">
            {byHouse.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                byHouse
                noteArm={noteArm}
                onMintSeal={desk.mintSeal}
                onExecute={desk.execute}
                onCancel={desk.cancel}
              />
            ))}
            {byPeople.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                byHouse={false}
                noteArm={noteArm}
                onMintSeal={desk.mintSeal}
                onExecute={desk.execute}
                onCancel={desk.cancel}
                onEdit={openEdit}
              />
            ))}
          </ul>
        )}

        {desk.failureNote && (
          <p role="status" className="mt-2 text-[11.5px] text-inkm-2">
            {desk.failureNote}
          </p>
        )}

        <button
          type="button"
          onClick={openNew}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-testid="one-tap-open-sheet"
          className="dn-ink mt-3 inline-flex items-center gap-1.5 rounded border border-seal-ring px-2 py-1 text-[11px] text-seal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal"
        >
          <PenLine size={12} strokeWidth={1.75} aria-hidden />
          Write a new one
        </button>
        {/* The stub. Torn off, not thrown away — the words are still here. */}
        {stubHeld && (
          <p data-testid="one-tap-stub" className="mt-1.5 text-[11px] italic text-inkm-4">
            Held here, unwritten: “{draft.title.trim() || draft.description.trim() || draft.actionUrl.trim()}”
          </p>
        )}

        <OneTapSheet
          open={open}
          onClose={leave}
          draft={draft}
          onDraft={setDraft}
          editing={editing}
          onSave={save}
          onRemove={remove}
          busy={saving}
          failureNote={desk.failureNote}
          register={desk.register}
        />

        <p className="mt-3 border-t border-paper-2 pt-2 text-[11px] text-inkm-4">
          One act on this desk is real: confirming a delivery books the stock through the order it
          names, and it is the only control here that carries a SEAL — minted when the hold begins
          and spent by the write. A written action is recorded against your name and nothing else
          moves; how it is closed is being tried both ways, and where that is a hold it is a
          gesture rather than a seal. Every other kind of action is disabled and says what is not
          built — no control here sends a mail or places an order.
        </p>
      </div>
    </section>
  );
}

export default OneTapPanel;
