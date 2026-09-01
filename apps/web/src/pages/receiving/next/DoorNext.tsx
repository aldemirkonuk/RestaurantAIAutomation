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
 *     permanently failed is VISIBLY different from a sent one (the flush's
 *     `failed` count is surfaced here; the legacy page discarded it);
 *  6. who signed — initials, no ceremony.
 *
 * The one thing deliberately NOT here: a line-item editor. Line-by-line
 * belongs on /receipts at a desk; this screen hands off rather than grows.
 *
 * The page keeps the legacy screen's essence — one job, one hand, one minute,
 * full-screen outside DashboardLayout, no prices anywhere — on the Warm
 * Charcoal ground (data-ground="charcoal"; ADR 0042 gives loading-dock
 * surfaces charcoal first-class).
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, CloudOff, Loader2, X } from 'lucide-react';
import { Seal } from '@/components/mudavym';
import { animate, settle } from '@/lib/mudavym';
import { receivingApi } from '@/services/api/receiving';
import { getOrder } from '@/services/api/orders';
import {
  flushDoorOutbox,
  newIdempotencyKey,
  pendingDoorCount,
  submitDoorReceipt,
} from '@/lib/doorOutbox';
import { SCAN_ACCEPT, resolveMimeType } from '@/lib/uploadAccept';
import {
  composeDoorNotes,
  creditDraft,
  doorFacts,
  ensureDoorFraunces,
  matchLine,
  normalizeDoorOrder,
  readPaper,
  suggestOutcome,
  inWords,
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

/** Thumb-sized. 56px is the smallest a cold, gloved hand hits reliably. */
const TAP = 'min-h-[56px] min-w-[56px]';

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
  color: var(--ink-3) !important;
  -webkit-text-fill-color: var(--ink-3) !important;
}
`;

export default function DoorNext() {
  const { orderId = '' } = useParams();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('paper');

  /* ── the order — fetched live, degrading honestly (point 1) ───────────── */
  const [order, setOrder] = useState<DoorOrderVM | null>(null);
  const [orderState, setOrderState] = useState<'loading' | 'ok' | 'unreachable'>('loading');
  /* What earlier trucks on this order already brought, in boxes. Null when it
     could not be read or the pack size is not knowable — the match line then
     behaves exactly as it did before split deliveries were a thing, rather than
     treating "unknown" as "none". */
  const [priorBoxes, setPriorBoxes] = useState<number | null>(null);

  /* ── the photograph (point 2) ─────────────────────────────────────────── */
  const [uploading, setUploading] = useState(false);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [reading, setReading] = useState<PaperReading | null>(null);
  const [paperLine, setPaperLine] = useState<string | null>(null);

  /* ── the count (the loved thing) ──────────────────────────────────────── */
  const [counted, setCounted] = useState(1);
  const [broken, setBroken] = useState(0);
  const touchedRef = useRef(false); // has a human moved the count?

  /* ── outcome · reason · signature (points 3 and 6) ────────────────────── */
  const [outcomeChoice, setOutcomeChoice] = useState<DoorOutcome | null>(null);
  const [reason, setReason] = useState<RefusalReason | null>(null);
  const [initials, setInitials] = useState('');
  const [driverName, setDriverName] = useState('');

  /* ── sealing + the outbox (point 5) ───────────────────────────────────── */
  const [submitting, setSubmitting] = useState(false);
  const [queued, setQueued] = useState(false);
  const [stockIssue, setStockIssue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sealAttempt, setSealAttempt] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingQueue, setPendingQueue] = useState(0);
  const [lastFlush, setLastFlush] = useState<{ sent: number; failed: number } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  // One key per screen, not per attempt: a retry of the same delivery must
  // reuse it so a request that landed before the connection dropped cannot
  // book the stock twice (doorOutbox's whole design).
  const idem = useRef(newIdempotencyKey(orderId));

  useEffect(() => {
    ensureDoorFraunces();
  }, []);

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
      .catch(() => {
        if (alive) setOrderState('unreachable');
      });
    // Separate call, separate failure. An order that cannot say what it already
    // received must still be countable — the count stands on its own.
    receivingApi
      .doorReceivedSoFar(orderId)
      .then((r) => alive && setPriorBoxes(r.receivedBoxes))
      .catch(() => alive && setPriorBoxes(null));
    return () => {
      alive = false;
    };
  }, [orderId]);

  // The outbox, watched by hand rather than via watchDoorOutbox, because that
  // helper discards the flush result — and the `failed` count is exactly what
  // point 5 requires this page to surface. Flushing twice is safe (idempotent).
  useEffect(() => {
    let alive = true;
    const refresh = () => void pendingDoorCount().then((n) => alive && setPendingQueue(n));
    const flush = () =>
      void flushDoorOutbox().then((r) => {
        if (!alive) return;
        if (r.sent > 0 || r.failed > 0) setLastFlush(r);
        refresh();
      });
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
  }, []);

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
    setStep('count');
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
      setDocumentId(res.documentId);
      const r = readPaper(res.document);
      setReading(r);
      if (r?.boxes != null) {
        if (!touchedRef.current) {
          setCounted(r.boxes);
          setPaperLine(`The paper reads ${r.boxes} ${r.boxes === 1 ? 'box' : 'boxes'} — confirm or correct.`);
        } else {
          // A human number beats a machine number. State, don't overwrite.
          setPaperLine(`The paper reads ${r.boxes} ${r.boxes === 1 ? 'box' : 'boxes'}.`);
        }
      } else {
        setPaperLine('Paper attached — nothing legible enough to pre-fill. Count by hand.');
      }
    } catch {
      // Losing the photo is bad; blocking the delivery over it is worse.
      setPaperLine("The photo couldn't be sent — keep the paper for the desk.");
    } finally {
      setUploading(false);
    }
  }

  const match = matchLine(counted, orderState === 'ok' ? order : null, priorBoxes ?? 0);
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
    alreadyReceivedBoxes: priorBoxes ?? 0,
  });

  const initialsOk = initials.trim().length >= 2;
  const reasonOk = outcome !== 'refused' || reason !== null;
  const sealDisabled = submitting || !initialsOk || !reasonOk;
  const sealHint = !initialsOk
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
        alreadyReceivedBoxes: priorBoxes ?? 0,
      };
      const res = await submitDoorReceipt({
        orderId,
        orderLabel: order?.orderNumber ?? orderId,
        body: {
          countedQty: counted,
          countedUom: 'case',
          // Everything the door knows, each quantity carrying its unit in its
          // own name. `rejectedQty` — the unitless name — is deliberately not
          // sent: it was counted in boxes and converted as bottles, which booked
          // a refused delivery into live stock.
          ...doorFacts(facts),
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
          wherever the receiver is in the flow (point 5). */}
      {lastFlush !== null && lastFlush.failed > 0 && (
        <p
          role="alert"
          className="mx-4 mt-3 rounded-xl border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-300"
        >
          {lastFlush.failed} door {lastFlush.failed === 1 ? 'report' : 'reports'} did not send —
          tell a manager before the paper is lost.
        </p>
      )}

      {step === 'paper' && (
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
            data-ux-key="door:photo"
            className="flex w-full flex-col items-center justify-center gap-3 rounded-3xl border border-seal-ring bg-seal-tint py-14 text-lg font-bold text-inkm-1 active:bg-white/10"
          >
            <Camera className="h-10 w-10 text-seal" />
            Take photo
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

      {step === 'count' && (
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
              setCounted(v);
            }}
            label="Boxes delivered"
            uxKey="door:cases"
          />

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
                Suggested from the count — the boxes came up {inWords(Math.abs(match?.deltaBoxes ?? 0))}{' '}
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
