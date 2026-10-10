/**
 * DoorNext — the Mudavym redesign of `/receiving/:orderId/door` (ADR 0044),
 * built from the founder's 2026-08-29 verdict (KEEP+ — "the photograph step
 * and the boxes-delivered count") and the six-point door brainstorm:
 *
 *  1. the PO match runs WHILE THE DRIVER IS PRESENT — the delta live as the
 *     count is entered ("14 of 16 — two short"), because the door is the only
 *     cheap moment to resolve a short ship;
 *  2. the photograph does work — the upload's parse pre-fills the count and
 *     the receiver confirms-or-corrects; unreachable extraction degrades
 *     honestly to "count the boxes yourself";
 *  3. three outcomes, not two — accepted · short-shipped · refused (with its
 *     reason: wrong wine, broken case, temperature);
 *  4. the credit request is already drafted when a short/refusal is sealed —
 *     shown calm, explicitly unsent, a manager approves it later;
 *  5. offline is the assumption — the tap always succeeds locally ("saved on
 *     this phone, will send when you're back inside"), and a send that
 *     PERMANENTLY failed is VISIBLY different from a sent one. Since the ADR
 *     0241 amendment (2026-09-29) such a receipt is PARKED as "Not sent" and
 *     kept, and this screen says so from the queue itself — not from
 *     `failed`, which counts a retryable pass the queue will send itself;
 *  6. who signed — initials, no ceremony.
 *
 * The one thing deliberately NOT here: a line-item editor. Line-by-line
 * belongs on /receipts at a desk; this screen hands off rather than grows.
 *
 * The page keeps the legacy screen's essence — one job, one hand, one minute,
 * full-screen outside DashboardLayout, no prices anywhere — on the Warm
 * Charcoal ground. It states that ground out loud (data-ground="charcoal"),
 * which the input rules below hang off. [2026-09-19, ADR 0169: from
 * 2026-09-12 to 2026-09-19 charcoal was also the `.mudavym` default in every
 * app theme, so this attribute merely confirmed. The founder then chose paper
 * as the default with a per-person option to choose charcoal (ADR 0169), so
 * this attribute now FORCES again — this is a loading-dock kiosk, chrome-free
 * and one-handed, and its ground is this page's own decision, not the
 * person's general preference. It is unaffected by that preference either
 * way, exactly as it was already unaffected by the old default.]
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, CloudOff, Loader2, X } from 'lucide-react';
import { Seal } from '@/components/mudavym';
import { animate, settle } from '@/lib/mudavym';
import { receivingApi, type DoorFactTime } from '@/services/api/receiving';
import { getOrder } from '@/services/api/orders';
import {
  clearDroppedDoorReceipts,
  flushDoorOutbox,
  newIdempotencyKey,
  notSentDoorCount,
  pendingDoorCount,
  queuedDoorReceiptFor,
  readDroppedDoorReceipts,
  submitDoorReceipt,
  type DoorFlushResult,
  type QueuedDoorReceiptRef,
  type DroppedDoorReceipt,
} from '@/lib/doorOutbox';
import { useActiveRestaurantId } from './useReceivingNextData';
import { useAuth } from '@/contexts/AuthContext';
import {
  clearSessionDraft,
  readSessionDraft,
  useUnsavedWorkGuard,
  writeSessionDraft,
} from '@/hooks/useUnsavedWorkGuard';
import { SCAN_ACCEPT, resolveMimeType } from '@/lib/uploadAccept';
import {
  composeDoorNotes,
  creditDraft,
  doorFacts,
  matchLine,
  normalizeDoorOrder,
  readPaper,
  suggestOutcome,
  inWords,
  type PriorReading,
  priorFromReceived,
  OUTCOME_LABEL,
  REFUSAL_REASONS,
  SERIF,
  type DoorOrderVM,
  type DoorOutcome,
  type PaperReading,
  type RefusalReason,
} from './DoorModel';
import DoorSeal from './DoorSeal';
import DoorCount from './DoorCount';
import DoorMatch from './DoorMatch';
import DoorCredit from './DoorCredit';

type Step = 'paper' | 'count' | 'done';

/**
 * What the porter has done so far, kept for this tab, this house and this
 * order (F-712) — a refresh or a swipe-back no longer throws the count away.
 * The idempotency key travels with it: a seal that went out just before the
 * page died must not book the stock twice when it is sent again.
 */
interface DoorDraft {
  step: Step;
  counted: number;
  broken: number;
  touched: boolean;
  /** The count still stands as the paper read it, untouched by a person (F-744). */
  paperHeld?: boolean;
  outcomeChoice: DoorOutcome | null;
  reason: RefusalReason | null;
  initials: string;
  driverName: string;
  documentId: string | null;
  reading: PaperReading | null;
  paperLine: string | null;
  idem: string;
}

/** Thumb-sized. 56px is the smallest a cold, gloved hand hits reliably. */
const TAP = 'min-h-[56px] min-w-[56px]';

/**
 * Which clock dated the delivery, in one quiet sentence, when that is not the
 * ordinary case. The phone's time is the delivery's when it is no more than 72
 * hours old, or older on an owner's or a manager's word, marked back-dated;
 * otherwise the server's. A sent time inside the window says nothing: it is
 * what the receiver expects. Times read in this phone's own locale and clock.
 */
function datedSentence(factTime: DoorFactTime | undefined): string | null {
  if (!factTime) return null;
  const sent = factTime.sentAt ? new Date(factTime.sentAt) : null;
  const when = sent && Number.isFinite(sent.getTime()) ? sent.toLocaleString() : null;
  switch (factTime.reason) {
    case 'back_dated':
      return when
        ? `Dated ${when}, more than 72 hours ago — marked back-dated.`
        : 'Dated more than 72 hours ago — marked back-dated.';
    case 'too_old':
      return when
        ? `This phone took it at ${when}, more than 72 hours ago. Only an owner or a manager can keep a time that old, so it is dated when it reached us.`
        : null;
    case 'ahead':
      return "This phone's clock is ahead, so it is dated by ours.";
    default:
      return null;
  }
}

/**
 * Page-scoped CSS: the settle expansion (+ its reduced-motion collapse), and
 * the door's text inputs. The inputs need their own !important block because
 * styles/globals.css paints EVERY input white with gray-800 text (its own
 * !important "visibility fix") — which on the charcoal ground makes cream
 * initials invisible on a white pill. This selector is more specific and
 * later in the document, so it wins without touching the shared stylesheet.
 */
const DOOR_CSS = `
.door-settle-rows { transition: grid-template-rows 320ms cubic-bezier(0.16, 1, 0.3, 1); }
@media (prefers-reduced-motion: reduce) { .door-settle-rows { transition: none; } }
.mudavym[data-ground="charcoal"] input.door-input {
  background-color: rgba(255, 255, 255, 0.06) !important;
  color: var(--ink-1) !important;
  -webkit-text-fill-color: var(--ink-1) !important;
  caret-color: var(--seal) !important;
  color-scheme: dark !important;
}
.mudavym[data-ground="charcoal"] input.door-input::placeholder {
  color: var(--ink-4) !important;
  -webkit-text-fill-color: var(--ink-4) !important;
}
`;

export default function DoorNext() {
  const { orderId = '' } = useParams();
  const navigate = useNavigate();
  // The house this delivery is taken at: stamped onto the queued receipt, and
  // the scope of the drop record. A door tablet is shared between houses.
  const rid = useActiveRestaurantId();
  const { availableRestaurants } = useAuth();
  const houseName = availableRestaurants?.find((r) => r.id === rid)?.name ?? null;
  const draftKey = `mdv:door-draft:${rid}:${orderId}`;
  const [kept] = useState(() => readSessionDraft<DoorDraft>(draftKey));

  const [step, setStep] = useState<Step>(kept?.step === 'count' ? 'count' : 'paper');

  /* ── the order — fetched live, degrading honestly (point 1) ───────────── */
  const [order, setOrder] = useState<DoorOrderVM | null>(null);
  /* `missing` is the gateway's 404: no such order in THIS house (another
     house's, removed, or mistyped). It is not a blip — nothing here can be
     recorded against it, so the screen stops before the count (F-711). */
  const [orderState, setOrderState] = useState<'loading' | 'ok' | 'unreachable' | 'missing'>(
    'loading',
  );
  /* What earlier trucks on this order already brought, in BOTTLES with the pack
     beside them (ADR 0192) — never a rounded box count. `null` while loading;
     `'unread'` when the read failed, which the match line and the credit letter
     SAY rather than treating "unknown" as "none". */
  const [prior, setPrior] = useState<PriorReading>(null);

  /* ── the photograph (point 2) ─────────────────────────────────────────── */
  const [uploading, setUploading] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(kept?.documentId ?? null);
  const [reading, setReading] = useState<PaperReading | null>(kept?.reading ?? null);
  const [paperLine, setPaperLine] = useState<string | null>(kept?.paperLine ?? null);

  /* ── the count (the loved thing) ──────────────────────────────────────── */
  const [counted, setCounted] = useState(kept?.counted ?? 1);
  const [broken, setBroken] = useState(kept?.broken ?? 0);
  const touchedRef = useRef(kept?.touched ?? false); // has a human moved the count?
  // The count was put there by the paper and no person has stood by it yet.
  // A machine reading is not a count, so the seal waits for a touch (F-744).
  const [paperHeld, setPaperHeld] = useState(kept?.paperHeld ?? false);

  /* ── outcome · reason · signature (points 3 and 6) ────────────────────── */
  const [outcomeChoice, setOutcomeChoice] = useState<DoorOutcome | null>(kept?.outcomeChoice ?? null);
  const [reason, setReason] = useState<RefusalReason | null>(kept?.reason ?? null);
  const [initials, setInitials] = useState(kept?.initials ?? '');
  const [driverName, setDriverName] = useState(kept?.driverName ?? '');

  /* ── sealing + the outbox (point 5) ───────────────────────────────────── */
  const [submitting, setSubmitting] = useState(false);
  const [queued, setQueued] = useState(false);
  const [stockIssue, setStockIssue] = useState<string | null>(null);
  const [dated, setDated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sealAttempt, setSealAttempt] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingQueue, setPendingQueue] = useState(0);
  const [lastFlush, setLastFlush] = useState<DoorFlushResult | null>(null);
  /**
   * Receipts on this phone the server refused for good, PARKED as "Not sent"
   * (ADR 0241 amendment, 2026-09-29). Read from the queue, which holds only
   * this session's person and house, so another house's are never counted.
   * Said quietly: nothing is lost — each can be sent again or discarded from
   * Receiving — but nothing will send them on its own either.
   */
  const [notSent, setNotSent] = useState(0);
  /**
   * Receipts the outbox GAVE UP ON — read from the outbox's own durable
   * record, not counted up here.
   *
   * This used to be a `useState(0)` counter, which is the defect the durability
   * fix was written to remove and then left in place on the page that is
   * actually live: the count died on the navigate that Finish triggers, so the
   * only trace of a permanent loss vanished at the exact moment the porter
   * walked away. The record survives the remount, names the order, is keyed on
   * the queue id so one loss cannot be counted twice, and belongs to this
   * house rather than to whatever tablet took it.
   *
   * It is the ONLY thing the red banner is allowed to fire on. `failed` counts
   * a retryable pass too — the receipt is still queued and will send itself —
   * so alarming on it sends a receiver to find a manager about a delivery that
   * is about to land on the server by itself.
   */
  const [drops, setDrops] = useState<DroppedDoorReceipt[]>(() =>
    readDroppedDoorReceipts(rid),
  );

  const fileRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  // One key per screen, not per attempt: a retry of the same delivery must
  // reuse it so a request that landed before the connection dropped cannot
  // book the stock twice (doorOutbox's whole design).
  const idem = useRef(kept?.idem ?? newIdempotencyKey(orderId));
  /**
   * A receipt for THIS order already on this phone, unsent (F-247). A fresh
   * mount makes a fresh key, and the server books a new key as a new delivery;
   * so while one waits here the door reuses its key and does not seal a
   * second one. Re-read on every outbox pass: once it sends, the door frees.
   */
  const [onPhone, setOnPhone] = useState<QueuedDoorReceiptRef | null>(null);
  const readOnPhone = useCallback(() => {
    void queuedDoorReceiptFor(orderId)
      .then((ref) => {
        if (ref?.idempotencyKey) idem.current = ref.idempotencyKey;
        setOnPhone(ref);
      })
      .catch(() => setOnPhone(null));
  }, [orderId]);
  useEffect(() => {
    readOnPhone();
  }, [readOnPhone]);

  // One quiet entrance for the header — settle, 6px, once.
  useEffect(() => {
    if (!headRef.current) return;
    animate(
      headRef.current,
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      settle,
    );
  }, []);

  // The real order, so the match can run at the door. Failure is a stated
  // fact ("the count stands on its own"), never a blocked screen.
  useEffect(() => {
    let alive = true;
    setOrderState('loading');
    getOrder(orderId)
      .then((raw) => {
        if (!alive) return;
        const vm = normalizeDoorOrder(raw);
        setOrder(vm);
        setOrderState(vm ? 'ok' : 'unreachable');
      })
      .catch((e) => {
        if (!alive) return;
        // A 404 is an answer, not a failure to get one (F-711).
        const status = (e as { response?: { status?: number } })?.response?.status;
        setOrderState(status === 404 ? 'missing' : 'unreachable');
      });
    // Separate call, separate failure. An order that cannot say what it already
    // received must still be countable — the count stands on its own.
    receivingApi
      .doorReceivedSoFar(orderId)
      // Refusals on earlier trucks come off what is still owed (F-813).
      .then((r) => alive && setPrior(priorFromReceived(r)))
      .catch(() => alive && setPrior('unread'));
    return () => {
      alive = false;
    };
  }, [orderId]);

  // The outbox, watched by hand rather than via watchDoorOutbox.
  //
  // NOT because that helper discards the flush result — it no longer does; it
  // hands the `DoorFlushResult` to its callback (lib/doorOutbox.ts,
  // `onChange?.(result)`) with its `failed`/`parked` split. The reason is the `offline`/`online` pair below:
  // this screen RENDERS connectivity, and watchDoorOutbox listens for `online`
  // without exposing it and has no `offline` handler at all. Flushing twice is
  // safe (idempotent).
  //
  // (This used to add "and its returned cleanup detaches only the `online`
  // listener — not the `visibilitychange` one". True the hour it was written,
  // and false by the next commit on this same branch: `e93f368c` named both
  // handlers so the cleanup could remove both — see the `return () =>` at the
  // end of `watchDoorOutbox`, lib/doorOutbox.ts. The listener leak is gone; the
  // connectivity reason above is the whole reason now.)
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void pendingDoorCount().then((n) => alive && setPendingQueue(n));
      void notSentDoorCount().then((n) => alive && setNotSent(n));
      // Both records re-read on every pass rather than patched from the
      // result: this is also what makes the `[rid]` note below true, since a
      // lazy `useState` initializer does not re-run on a house switch.
      setDrops(readDroppedDoorReceipts(rid));
      readOnPhone();
    };
    /**
     * The pass already accounted for.
     *
     * `onOnline` and `onVis` below fire in the SAME tick on the dock-to-office
     * walk, and the outbox hands both callers the one in-flight pass
     * (lib/doorOutbox.ts, `inFlight`). This no longer guards a miscount — both
     * loss counts are read from storage now, so reporting one pass twice
     * cannot inflate them — it just stops the same result doing the same two
     * reads twice. A genuinely later flush is a different promise.
     */
    let counted: Promise<DoorFlushResult> | null = null;
    const flush = () => {
      const pass = flushDoorOutbox();
      if (pass === counted) return;
      counted = pass;
      void pass.then((r) => {
        if (!alive) return;
        if (r.sent > 0 || r.failed > 0) setLastFlush(r);
        // A discarded receipt leaves the queue exactly as a delivered one does,
        // so `pendingQueue` falls by one either way. What tells them apart is
        // on disk — the drop record and the parked queue entry — so the pass
        // result is not consulted for either; the reads are.
        refresh();
      });
    };
    const onOnline = () => {
      setOnline(true);
      flush();
    };
    const onOffline = () => setOnline(false);
    const onVis = () => {
      // The walk from the dock to the office is when signal returns.
      if (document.visibilityState === 'visible') flush();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVis);
    flush();
    return () => {
      alive = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVis);
    };
    // `rid` is a dependency because the record is scoped by it. In practice a
    // door screen is one order at one house, so this does not re-subscribe
    // mid-delivery; a switch re-reads that house's record rather than leaving
    // the previous one on screen.
  }, [rid, readOnPhone]);

  /**
   * The photograph does work (point 2) — but NEVER blocks the count. The
   * screen moves on immediately; the parse arrives when it arrives and
   * pre-fills only a count no human has touched yet. Offline or failed, the
   * affordance degrades honestly to manual counting, in words.
   *
   * THE OFFLINE BRANCH SAYS WHAT ACTUALLY HAPPENS. It used to say "the paper
   * will be read later" while the `File` went out of scope and was discarded —
   * a promise nothing in the app could keep.
   *
   * Queueing the bytes instead was the better answer and was measured as unsafe
   * here: the door outbox is `offlineStorage`'s pending-mutation queue, whose
   * localStorage fallback serialises EVERY pending mutation into one
   * `${store}_all` key (`offline-storage.ts:189-210`) and swallows a quota
   * failure with a `console.error`. A multi-megabyte base64 photo written into
   * that store on the old iPads a receiving desk actually has would take the
   * RECEIPT down with it — losing the delivery to save the picture of it. So the
   * photo is not queued, and the screen no longer claims it was.
   */
  async function handlePhoto(file: File) {
    if (orderState === 'loading' || orderState === 'missing') return;
    setStep('count');
    // The paper is filed under the order it names, so it is only sent once
    // this house has confirmed that order exists (F-711, F-309).
    if (orderState === 'unreachable') {
      setPaperLine(
        'The order could not be checked, so this photo is not sent. Keep the paper for the desk, and count the boxes yourself.',
      );
      return;
    }
    if (!navigator.onLine) {
      setPaperLine(
        'No signal — this photo cannot be sent and is not saved. Keep the paper for the desk, and count the boxes yourself.',
      );
      return;
    }
    setUploading(true);
    try {
      const base64 = await toBase64(file);
      const res = await receivingApi.uploadDocument({
        contentBase64: base64,
        filename: file.name,
        mimeType: resolveMimeType(file),
        orderId,
        source: 'photo',
      });
      // The paper names another order or another vendor (F-745): it is on
      // file, but not with this delivery, and nothing on it is used here.
      if (res.orderLink && !res.orderLink.linked) {
        setDocumentId(null);
        setReading(null);
        setPaperLine(
          `${res.orderLink.conflict ?? 'This paper was not filed to this order.'} Count the boxes yourself.`,
        );
        return;
      }
      setDocumentId(res.documentId);
      const r = readPaper(res.document);
      setReading(r);
      // The same paper again (F-747): say it was already here, and where it is filed now.
      const onFile = res.duplicate
        ? `This paper is already on file, now filed to ${order?.orderNumber ?? 'this order'}. `
        : '';
      const boxesWord = (n: number) => `${n} ${n === 1 ? 'box' : 'boxes'}`;
      if (r?.boxes != null && r.prefill) {
        if (!touchedRef.current) {
          setCounted(r.boxes);
          setPaperHeld(true);
          setPaperLine(`${onFile}The paper reads ${boxesWord(r.boxes)}. Count them, then confirm or correct.`);
        } else {
          // A human number beats a machine number. State, don't overwrite.
          setPaperLine(`${onFile}The paper reads ${boxesWord(r.boxes)}.`);
        }
      } else if (r?.boxes != null) {
        // A hint, never a count: a credit note, lines not in boxes, or a
        // reading with doubts (F-744).
        setPaperLine(`${onFile}The paper may read ${boxesWord(r.boxes)}, but ${r.doubt} — count them yourself.`);
      } else {
        setPaperLine(
          onFile
            ? `${onFile}Nothing on it was legible enough to pre-fill. Count by hand.`
            : 'Paper attached — nothing legible enough to pre-fill. Count by hand.',
        );
      }
    } catch {
      // Losing the photo is bad; blocking the delivery over it is worse.
      setPaperLine("The photo couldn't be sent — keep the paper for the desk.");
    } finally {
      setUploading(false);
    }
  }

  const match = matchLine(counted, orderState === 'ok' ? order : null, prior);
  const suggested = suggestOutcome(match);
  const outcome: DoorOutcome = outcomeChoice ?? suggested;
  // THE CREDIT LETTER MAY ONLY CLAIM AN ATTACHMENT THAT EXISTS. This was
  // `photoTaken`, set the instant the camera returned a file — so on the offline
  // branch and on the upload-failure branch the draft told a vendor that
  // paperwork "is attached" to a document the server had never received. A
  // documentId is the only proof the upload landed.
  const hasPhoto = documentId !== null;
  const draft = creditDraft({
    outcome,
    reason,
    counted,
    order,
    hasPhoto,
    driverName,
    initials,
    alreadyReceived: prior,
  });

  const initialsOk = initials.trim().length >= 2;
  const reasonOk = outcome !== 'refused' || reason !== null;
  const sealDisabled = submitting || !initialsOk || !reasonOk || paperHeld || onPhone !== null;
  const sealHint = onPhone
    ? onPhone.parked
      ? 'This delivery is already counted on this phone and was not sent. Open Receiving to send it again or discard it.'
      : 'This delivery is already counted on this phone. It sends by itself when the signal is back.'
    : paperHeld
      ? "Count the boxes yourself, then tap \u201cThat's my count\u201d or change the number. The paper's number is a reading, not a count."
      : !initialsOk
        ? 'Add your initials first — when a case goes missing, who signed is the question.'
        : !reasonOk
          ? 'Say why it was refused — the reason is what the credit stands on.'
          : undefined;

  async function seal() {
    setSubmitting(true);
    setError(null);
    try {
      const facts = {
        outcome,
        reason,
        counted,
        broken,
        order,
        match,
        hasPhoto,
        driverName,
        initials,
        alreadyReceived: prior,
      };
      const res = await submitDoorReceipt({
        orderId,
        orderLabel: order?.orderNumber ?? orderId,
        restaurantId: rid,
        body: {
          countedQty: counted,
          countedUom: 'case',
          // Everything the door knows, each quantity carrying its unit in its
          // own name. `rejectedQty` — the unitless name — is deliberately not
          // sent: it was counted in boxes and converted as bottles, which booked
          // a refused delivery into live stock.
          ...doorFacts(facts),

          // ADR 0059. The paper's own reading, and whether this receiver stood
          // by it. Both undefined when the paper offered nothing — there was no
          // proposal, so there is nothing to grade, and sending `false` would
          // claim the receiver overrode a number that never existed.
          suggestedQtyInCountedUom: reading?.boxes ?? undefined,
          suggestionAccepted:
            reading?.boxes == null ? undefined : counted === reading.boxes,
          documentId: documentId ?? undefined,
          idempotencyKey: idem.current,
          clientCapturedAt: new Date().toISOString(),
          notes: composeDoorNotes(facts),
        },
      });
      setQueued(!res.synced);
      // The delivery can be recorded while the shelf count is not — an order
      // with no inventory link books nothing. Say so rather than showing the
      // ordinary "someone will count the bottles" ending.
      setStockIssue(res.synced && res.stockBooked === false ? (res.stockIssue ?? null) : null);
      // Said only when the server answered while this screen is open. A
      // receipt that sends later from the queue is said by the bell instead.
      setDated(res.synced ? datedSentence(res.factTime) : null);
      setStep('done');
    } catch (e) {
      // A gateway refusal resets the die, with the refusal stated in place —
      // the server's own sentence when it gave one, never a bare status code.
      const server = (e as { response?: { data?: { message?: string | string[] } } })?.response
        ?.data?.message;
      const said = Array.isArray(server) ? server.join(' ') : server;
      setError(
        said ??
          (e as Error)?.message ??
          'Could not record this delivery. Try again, or tell a manager.',
      );
      setSealAttempt((n) => n + 1);
    } finally {
      setSubmitting(false);
      void pendingDoorCount().then(setPendingQueue);
    }
  }

  // Keep the draft while the count is open; drop it once the delivery is
  // recorded or the order turned out not to be in this house.
  useEffect(() => {
    if (step === 'done' || orderState === 'missing') {
      clearSessionDraft(draftKey);
      return;
    }
    if (step !== 'count') return;
    writeSessionDraft(draftKey, {
      step,
      counted,
      broken,
      touched: touchedRef.current,
      paperHeld,
      outcomeChoice,
      reason,
      initials,
      driverName,
      documentId,
      reading,
      paperLine,
      idem: idem.current,
    } satisfies DoorDraft);
  }, [draftKey, step, orderState, counted, broken, paperHeld, outcomeChoice, reason, initials, driverName, documentId, reading, paperLine]);

  useUnsavedWorkGuard(
    orderState !== 'missing' && (step === 'count' || submitting),
    'This delivery is not recorded yet. Leave anyway? The count stays on this phone until you come back to it.',
  );

  const orderLabel = order?.wineName ?? order?.orderNumber ?? 'Delivery';

  return (
    <div
      className="mudavym flex min-h-screen flex-col bg-paper-0 text-inkm-1"
      data-ground="charcoal"
      style={{ fontFamily: '"Plus Jakarta Sans", "DM Sans", system-ui, sans-serif' }}
    >
      <style>{DOOR_CSS}</style>

      {/* ── chrome: only what a receiver needs to know about the app ─────── */}
      <div ref={headRef} className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Cancel"
          data-ux-key="door:cancel"
          className={`${TAP} flex items-center justify-center rounded-xl text-inkm-3`}
        >
          <X className="h-6 w-6" />
        </button>
        <span className="max-w-[55%] truncate text-sm font-semibold text-inkm-2">
          {orderLabel}
        </span>
        <div className="flex items-center gap-2 text-xs" aria-live="polite">
          {!online && (
            <span className="flex items-center gap-1 text-amber-300">
              <CloudOff className="h-4 w-4" /> Offline
            </span>
          )}
          {pendingQueue > 0 && <span className="text-inkm-3">{pendingQueue} to send</span>}
        </div>
      </div>


      {/* A send that permanently failed is NOT a sent one — said loudly,
          wherever the receiver is in the flow (point 5). Loud is reserved for
          `dropped`: the app has given up, and the person holding the paper is
          the only one who can still act on it. Read from the outbox's durable
          record, so it survives the Finish navigate and names the orders. */}
      {drops.length > 0 && (
        <div
          role="alert"
          data-ux-key="door:dropped"
          className="mx-4 mt-3 rounded-xl border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
        >
          <p>
            {drops.length === 1
              ? `Delivery ${drops[0].orderLabel} was saved on this phone and never sent.`
              : `${drops.length} deliveries saved on this phone were never sent.`}{' '}
            {/* Only a remedy the cause supports. A stored `auth` record means
                an account the server turned away: a 403 since ADR 0241 retries a
                401 instead of dropping it (the gateway's 403s on this route are
                a house the account is not in, no house chosen, or an email not
                yet verified), and possibly a 401 in a record written before
                that. So it claims no narrower cause. So it must NOT say
                "signed out" or send the porter to sign in again; the remedy is
                the paperwork and a manager. Mixed or anything else: no cause
                is claimed at all. (These are records written before the ADR
                0241 amendment; a refusal is now parked, not dropped.) */}
            {drops.every((d) => d.reason === 'auth')
              ? 'The server turned this account away, so it was never recorded. Keep the paperwork and tell a manager: the count is not on the server.'
              : 'The app has given up. Keep the paperwork and tell a manager: the count is not on the server.'}
          </p>
          {drops.length > 1 && (
            <ul className="mt-2 space-y-1 text-rose-300/90">
              {drops.map((d) => (
                <li key={d.id}>{d.orderLabel}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            data-ux-key="door:dropped-ack"
            onClick={() => {
              // Clears the NOTICE, not the fact. The receipt is gone and
              // nothing here brings it back; the alternative is a red strip on
              // a shared dock phone that can never be dismissed, which is a
              // strip nobody reads by the third delivery.
              clearDroppedDoorReceipts(rid);
              setDrops([]);
            }}
            className="mt-2 min-h-[44px] w-full rounded-lg bg-white/10 text-xs font-semibold active:bg-white/20"
          >
            I have the paperwork
          </button>
        </div>
      )}

      {/* A retryable failure is not a loss — the receipt is still queued and
          the next flush sends it. Said quietly, in the chrome's own voice, so
          it never reads as the alarm above. */}
      {/* `failed` counts only receipts still waiting since the ADR 0241
          amendment: a refusal is `parked`, not failed, and said below. */}
      {lastFlush !== null && lastFlush.failed > 0 && (
        <p data-ux-key="door:retrying" className="mx-4 mt-2 text-xs text-inkm-3">
          {lastFlush.failed} {lastFlush.failed === 1 ? 'report' : 'reports'} did not send yet —
          still on this phone, still trying.
        </p>
      )}

      {/* Refused by the server and kept, not lost: quiet, because nothing is
          gone and nothing has to happen at the door. */}
      {notSent > 0 && (
        <p data-ux-key="door:not-sent" className="mx-4 mt-2 text-xs text-inkm-3">
          {/* Counts every parked receipt: most were refused by the server, but a
              very old one may name no one to send it as. So no cause is claimed
              here; the Receiving rail names each one's reason and offers only
              the actions that reason allows. */}
          {notSent === 1
            ? '1 delivery report on this phone was not sent.'
            : `${notSent} delivery reports on this phone were not sent.`}{' '}
          {notSent === 1 ? 'It is' : 'They are'} kept here as “Not sent” — Receiving shows why,
          and lets you send {notSent === 1 ? 'it' : 'them'} again where that is possible, or discard{' '}
          {notSent === 1 ? 'it' : 'them'}.
        </p>
      )}

      {orderState === 'missing' && step !== 'done' && (
        <Panel
          title={houseName ? `This order is not in ${houseName}` : 'This order is not in this house'}
          hint="It may belong to another house, it may have been removed, or the link is mistyped. Nothing has been counted or sent."
        >
          <p data-ux-key="door:order-missing" className="mb-5 text-sm text-inkm-2">
            Check the order number on the driver's paper. If the order belongs to another house,
            switch to that house and open the delivery from Receiving there.
          </p>
          <button
            type="button"
            onClick={() => navigate('/receiving')}
            data-ux-key="door:order-missing-back"
            className={`${TAP} w-full rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-inkm-1 active:bg-white/10`}
          >
            Back to Receiving
          </button>
        </Panel>
      )}

      {/* This order's own receipt, still on the phone (F-247): said before the
          count starts, so nobody counts the same boxes a second time. Not
          while `done` — the receipt this screen just saved is said there. */}
      {onPhone && orderState !== 'missing' && step !== 'done' && (
        <p
          role="status"
          data-ux-key="door:already-on-phone"
          className="mx-4 mt-2 rounded-xl border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200"
        >
          {onPhone.parked
            ? 'This delivery is already counted on this phone, but it was not sent. Open Receiving to send it again or discard it — do not count it twice.'
            : 'This delivery is already counted on this phone and waiting to send. It sends by itself when the signal is back — no need to count it again.'}
        </p>
      )}

      {orderState !== 'missing' && step === 'paper' && (
        <Panel
          title="Photograph the paper"
          hint="Whatever the driver handed you. If it reads clean, it will count the boxes for you."
        >
          <input
            ref={fileRef}
            type="file"
            accept={SCAN_ACCEPT}
            // Rear camera directly — one less tap, and their hands are full.
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handlePhoto(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            // The paper is filed under this order, so the order is found first.
            disabled={orderState === 'loading'}
            data-ux-key="door:photo"
            className="flex w-full flex-col items-center justify-center gap-3 rounded-3xl border border-seal-ring bg-seal-tint py-14 text-lg font-bold text-inkm-1 active:bg-white/10 disabled:opacity-50"
          >
            {orderState === 'loading' ? (
              <Loader2 className="h-10 w-10 animate-spin text-seal" />
            ) : (
              <Camera className="h-10 w-10 text-seal" />
            )}
            {orderState === 'loading' ? 'Finding the order…' : 'Take photo'}
          </button>

          {/* An escape hatch, because sometimes there genuinely is no paper. */}
          <button
            type="button"
            onClick={() => setStep('count')}
            data-ux-key="door:skip-photo"
            className={`${TAP} mt-4 w-full text-sm text-inkm-3 underline`}
          >
            No paper with this delivery
          </button>
        </Panel>
      )}

      {orderState !== 'missing' && step === 'count' && (
        <Panel title="How many boxes" hint="Count the boxes, not the bottles. Someone opens them later, at a desk.">
          {/* what the photograph is doing / did — honest at every stage */}
          {(uploading || paperLine) && (
            <p
              className={`mb-5 flex items-center gap-2 text-sm ${
                uploading ? 'text-inkm-3' : documentId ? 'text-seal' : 'text-amber-300'
              }`}
              aria-live="polite"
            >
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
              {uploading ? 'Reading the paper…' : paperLine}
            </p>
          )}

          <DoorCount
            value={counted}
            onChange={(v) => {
              touchedRef.current = true;
              setPaperHeld(false);
              setCounted(v);
            }}
            label="Boxes delivered"
            uxKey="door:cases"
          />
          {paperHeld && (
            <button
              type="button"
              onClick={() => {
                touchedRef.current = true;
                setPaperHeld(false);
              }}
              data-ux-key="door:confirm-paper-count"
              className={`${TAP} mt-4 w-full rounded-2xl border border-white/15 text-sm font-semibold text-inkm-1`}
            >
              That's my count — {counted} {counted === 1 ? 'box' : 'boxes'}
            </button>
          )}

          {/* the match, live, while the driver is still here (point 1) */}
          <DoorMatch match={match} orderUnreachable={orderState === 'unreachable'} />

          {/* visibly broken — moot when the whole delivery is refused */}
          <div
            className="door-settle-rows grid"
            style={{ gridTemplateRows: outcome === 'refused' ? '0fr' : '1fr' }}
            aria-hidden={outcome === 'refused'}
          >
            <div className="overflow-hidden">
              <div className="mt-7">
                <DoorCount
                  value={broken}
                  onChange={setBroken}
                  label="Anything visibly broken?"
                  tone="warn"
                  uxKey="door:damaged"
                  compact
                />
                {broken > 0 && (
                  <p className="mt-2 text-sm text-amber-300/90">
                    Photograph the damage if you can. A manager sorts out what it is.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* three outcomes, not two (point 3) */}
          <div className="mt-7">
            <p className="mb-3 text-sm font-semibold text-inkm-2">How does it stand?</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Outcome">
              {(['accepted', 'short', 'refused'] as const).map((o) => {
                const selected = outcome === o;
                return (
                  <button
                    key={o}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setOutcomeChoice(o);
                      if (o !== 'refused') setReason(null);
                    }}
                    data-ux-key={`door:outcome-${o}`}
                    className={`${TAP} rounded-2xl border px-2 py-3 text-sm font-bold leading-tight transition-colors duration-150 ${
                      selected
                        ? 'border-seal bg-seal-tint text-inkm-1'
                        : 'border-white/10 bg-white/5 text-inkm-3'
                    }`}
                  >
                    {OUTCOME_LABEL[o]}
                  </button>
                );
              })}
            </div>
            {outcomeChoice === null && suggested === 'short' && (
              <p className="mt-2 text-xs text-inkm-3" aria-live="polite">
                Suggested from the count —{' '}
                {match?.deltaBoxes != null
                  ? `the boxes came up ${inWords(Math.abs(match.deltaBoxes))}`
                  : `the count came up ${match?.deltaWords ?? 'some'}`}{' '}
                short. Tap to change.
              </p>
            )}
          </div>

          {/* the refusal's reason — the state that costs the most money */}
          <div
            className="door-settle-rows grid"
            style={{ gridTemplateRows: outcome === 'refused' ? '1fr' : '0fr' }}
            aria-hidden={outcome !== 'refused'}
          >
            <div className="overflow-hidden">
              <div className="mt-4">
                <p className="mb-2 text-sm font-semibold text-inkm-2">Refused because —</p>
                <div className="flex flex-wrap gap-2">
                  {REFUSAL_REASONS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setReason(r.id)}
                      data-ux-key={`door:reason-${r.id}`}
                      className={`min-h-[48px] rounded-xl border px-4 text-sm font-semibold ${
                        reason === r.id
                          ? 'border-seal bg-seal-tint text-inkm-1'
                          : 'border-white/10 bg-white/5 text-inkm-3'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* the credit, already drafted, calm and unsent (point 4) */}
          <DoorCredit draft={draft} driverName={driverName} onDriverName={setDriverName} />

          {/* who signed (point 6) — initials, no ceremony */}
          <label className="mt-7 block">
            <span className="text-sm font-semibold text-inkm-2">Who signed — initials</span>
            <input
              type="text"
              value={initials}
              onChange={(e) => setInitials(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="e.g. AK"
              autoComplete="off"
              autoCapitalize="characters"
              enterKeyHint="done"
              className="door-input mt-2 w-full min-h-[56px] rounded-2xl border border-white/10 px-4 text-center text-2xl font-bold tracking-[0.3em] placeholder:tracking-normal placeholder:text-base placeholder:font-normal focus:border-seal-ring focus:outline-none"
              style={{ fontFamily: SERIF }}
              data-ux-key="door:initials"
            />
          </label>

          {error && (
            <p className="mt-5 text-sm text-rose-300" role="alert">
              {error}
            </p>
          )}

          {/* the door-seal ceremony — forgiving past 60% (sig-a lineage) */}
          <DoorSeal
            key={sealAttempt}
            onSeal={() => void seal()}
            label={
              outcome === 'accepted'
                ? `Hold to seal — ${counted} ${counted === 1 ? 'box' : 'boxes'} in`
                : outcome === 'short'
                  ? 'Hold to seal — short-shipped'
                  : 'Hold to seal — refused'
            }
            sealedLabel={submitting ? 'Saving…' : 'Sealed'}
            disabled={sealDisabled}
            disabledHint={sealHint}
            className="mt-8"
          />

          {/* the DON'T, honoured: hand line-by-line to a desk, never grow it */}
          {reading !== null && reading.lineCount > 1 && (
            <button
              type="button"
              onClick={() => navigate('/receipts')}
              data-ux-key="door:handoff-receipts"
              className={`${TAP} mt-4 w-full text-sm text-inkm-3 underline`}
            >
              {reading.lineCount} lines read from the paper — line-by-line happens in Receipts, not
              here.
            </button>
          )}
        </Panel>
      )}

      {step === 'done' && (
        <Panel title={queued ? 'Saved on this phone' : 'Recorded'}>
          <div className="flex flex-col items-center gap-4 py-8">
            <Seal size={80} pressed={!queued} title={queued ? 'Saved locally' : 'Recorded'} />
            <p className="text-lg font-bold text-inkm-1" style={{ fontFamily: SERIF }}>
              {OUTCOME_LABEL[outcome]}
              {outcome === 'refused' && reason
                ? ` — ${REFUSAL_REASONS.find((r) => r.id === reason)?.label.toLowerCase()}`
                : ''}
            </p>
            <p className="max-w-xs text-center text-inkm-2" aria-live="polite">
              {queued
                ? // True, and all they need: their next action is walking away.
                  'It will send itself when you are back inside. Nothing is lost.'
                : 'Someone will count the bottles and check it against the invoice at a desk.'}
            </p>
            {/* Recorded is not the same as booked. The server says which, in
                words, and the receiver reads the words rather than a seal that
                means two different things. */}
            {stockIssue !== null && (
              <p
                role="alert"
                className="max-w-xs rounded-xl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-center text-sm text-amber-200"
              >
                {stockIssue}
              </p>
            )}
            {/* Which clock dated it, when it was not the phone's within 72
                hours. A record, not an alarm: nothing for the receiver to do. */}
            {dated !== null && (
              <p data-ux-key="door:dated" className="max-w-xs text-center text-sm text-inkm-3">
                {dated}
              </p>
            )}
            {draft !== null && (
              <p className="max-w-xs text-center text-sm text-inkm-3">
                The credit request rides with it — drafted, unsent. A manager approves it.
              </p>
            )}
            {queued && pendingQueue > 0 && (
              <p className="text-sm text-inkm-3">
                {pendingQueue} {pendingQueue === 1 ? 'report' : 'reports'} waiting on this phone.
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate('/orders')}
              data-ux-key="door:finish"
              className={`${TAP} mt-3 rounded-2xl border border-seal-ring bg-seal-tint px-8 font-semibold text-inkm-1`}
            >
              Finish
            </button>
            <button
              type="button"
              onClick={() => navigate('/receipts')}
              data-ux-key="door:handoff-receipts-done"
              className={`${TAP} text-sm text-inkm-3 underline`}
            >
              Sort it line by line at a desk — Receipts
            </button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-10 pt-7">
      {/* Explicit ink colour — a global stylesheet sets h1 to gray-900, which
          on charcoal renders the heading invisible, outdoors, in daylight. */}
      <h1
        className="text-[26px] leading-tight text-inkm-1"
        style={{ fontFamily: SERIF, fontWeight: 480 }}
      >
        {title}
        <span className="text-seal">.</span>
      </h1>
      {hint && <p className="mt-2 text-sm text-inkm-2">{hint}</p>}
      <div className="mt-6 flex-1">{children}</div>
    </div>
  );
}

/** File to bare base64 (no data: prefix, which the API does not want). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
