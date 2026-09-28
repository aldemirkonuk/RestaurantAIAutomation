import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Camera, Check, CloudOff, Loader2, Minus, Plus, X } from 'lucide-react'
import { receivingApi } from '../../services/api/receiving'
import {
  clearDroppedDoorReceipts,
  newIdempotencyKey,
  pendingDoorCount,
  readDroppedDoorReceipts,
  submitDoorReceipt,
  watchDoorOutbox,
  type DroppedDoorReceipt,
} from '../../lib/doorOutbox'
import { useAuth } from '../../contexts/AuthContext'
import { cn } from '../../lib/utils'
import { SCAN_ACCEPT, resolveMimeType } from '../../lib/uploadAccept'

/**
 * DoorReceipt — what happens when the truck arrives.
 *
 * Designed against the actual scene rather than a desk: the driver is
 * double-parked with six more stops, the person receiving is a porter or a prep
 * cook because the manager is not in until ten, it is a sidewalk or a stairwell,
 * hands are cold and possibly gloved, the phone is at 12%, and there is no signal
 * in the walk-in. Cases are shrink-wrapped and nobody opens fourteen of them.
 *
 * So this screen asks three things and nothing else:
 *   1. a photo of whatever paper the driver handed over
 *   2. how many boxes
 *   3. was anything obviously broken
 *
 * NO PRICES ANYWHERE. Line cost is not floor-staff information, it invites an
 * argument with a driver who has no authority to settle it, and it is the single
 * biggest source of hesitation at the door.
 *
 * NO "DOES THIS MATCH THE ORDER?" The person holding the hand truck cannot
 * answer that, and a wrong answer becomes a wrong claim against a distributor.
 * The bottle count and the four-way match happen later, at a desk.
 *
 * THE TAP ALWAYS SUCCEEDS. A receiver who watches a spinner fail has learned the
 * app costs them time, and they go back to the clipboard permanently. Offline,
 * it queues and says "Saved" — which is true, and their next action is walking
 * away from the door.
 */

type Step = 'photo' | 'count' | 'done'

/** Thumb-sized. 56px is the smallest a cold, gloved hand hits reliably. */
const TAP = 'min-h-[56px] min-w-[56px]'

export default function DoorReceipt() {
  const { orderId = '' } = useParams()
  const navigate = useNavigate()
  /**
   * The house this delivery is being taken at. Stamped onto the queued receipt
   * and used to read the drop record, because the record is per-restaurant: a
   * shared door tablet switches houses, and a global record showed one house's
   * order label to the next.
   */
  const { activeRestaurantId, user } = useAuth()
  const rid = activeRestaurantId || user?.restaurantId || ''

  const [step, setStep] = useState<Step>('photo')
  const [cases, setCases] = useState(1)
  const [damaged, setDamaged] = useState(0)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [photoTaken, setPhotoTaken] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [queued, setQueued] = useState(false)
  const [pending, setPending] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const [error, setError] = useState<string | null>(null)
  /**
   * Receipts the outbox gave up on — read from the outbox's own record, not
   * counted up here.
   *
   * It used to be a counter in this component's state, which meant the only
   * trace of a permanent loss lived on one screen and died the moment the
   * porter tapped Finish (:navigate below unmounts this). It also double-counted
   * a single loss when two flush triggers overlapped, because each pass
   * reported the same drop and both were added.
   *
   * Both are the same mistake — a count where a record belongs. The outbox
   * writes each dropped receipt down, keyed on its queue id, so this survives a
   * remount, names the order, and cannot count one loss twice. Nothing removes
   * an entry except the porter acknowledging it: a later successful send does
   * not make an earlier loss untrue.
   */
  const [drops, setDrops] = useState<DroppedDoorReceipt[]>(() =>
    readDroppedDoorReceipts(rid),
  )

  const fileRef = useRef<HTMLInputElement>(null)
  // Generated once per screen, not per attempt: retrying the same delivery must
  // reuse the key so a request that landed before the connection dropped cannot
  // book the stock a second time.
  const idempotencyKey = useRef(newIdempotencyKey(orderId))

  useEffect(() => {
    const refresh = () => {
      void pendingDoorCount().then(setPending)
      // Re-read, never patched from the pass result. This is also what re-seeds
      // both records on a house switch — a lazy `useState` initializer does not
      // re-run when `rid` changes, so the previous house's loss stayed on screen.
      setDrops(readDroppedDoorReceipts(rid))
    }
    const stop = watchDoorOutbox(() => {
      // A discarded receipt leaves the queue exactly as a delivered one does,
      // so `pending` falls by one either way. What tells them apart is ASKED
      // FOR rather than inferred from the pass result: the drop RECORD, read
      // back from storage. There is deliberately nothing to read for a receipt
      // the outbox gave up on but could not record — ADR 0140 — because the
      // fact to be recorded is that recording failed. That one stays in the
      // queue and shows on the rail as what it is: a receipt still here.
      refresh()
    })
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    refresh()
    return () => {
      stop()
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [rid])

  /**
   * Send the photograph for classification.
   *
   * Deliberately never blocks progress. The paper is usually a packing slip
   * rather than an invoice, extraction takes seconds we do not have, and the
   * photo itself is the artifact that matters — a disputed credit is settled by
   * producing the document. If the upload fails the count still goes through.
   */
  async function handlePhoto(file: File) {
    setPhotoTaken(true)
    setUploading(true)
    setError(null)
    try {
      const base64 = await toBase64(file)
      const res = await receivingApi.uploadDocument({
        contentBase64: base64,
        filename: file.name,
        mimeType: resolveMimeType(file),
        orderId,
        source: 'photo',
      })
      setDocumentId(res.documentId)
    } catch {
      // Swallowed on purpose. Losing the photo is bad; blocking the delivery
      // over it is worse, and the receiver cannot fix an upload error anyway.
    } finally {
      setUploading(false)
      setStep('count')
    }
  }

  /**
   * The porter saying they have the paper in hand. It clears the NOTICE, not
   * the fact: the receipt was deleted from the queue by the flush and nothing
   * here brings it back. The alternative is a red strip that can never be
   * dismissed on a shared dock phone, which is a strip nobody reads by the
   * third delivery — and an unread warning is the same loss, later.
   */
  function acknowledgeDrops() {
    clearDroppedDoorReceipts(rid)
    setDrops([])
  }

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await submitDoorReceipt({
        orderId,
        orderLabel: orderId,
        restaurantId: rid,
        body: {
          countedQty: cases,
          countedUom: 'case',
          rejectedQty: damaged,
          documentId: documentId ?? undefined,
          idempotencyKey: idempotencyKey.current,
          clientCapturedAt: new Date().toISOString(),
        },
      })
      setQueued(!res.synced)
      setStep('done')
    } catch (e) {
      setError(
        (e as Error)?.message ??
          'Could not record this delivery. Try again, or tell a manager.',
      )
    } finally {
      setSubmitting(false)
      void pendingDoorCount().then(setPending)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Chrome: only what a receiver needs to know about the app itself. */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Cancel"
          data-ux-key="door:cancel"
          className={cn(TAP, 'flex items-center justify-center rounded-xl text-gray-400')}
        >
          <X className="w-6 h-6" />
        </button>
        <span className="text-sm font-semibold text-gray-300">Delivery</span>
        <div className="flex items-center gap-2 text-xs">
          {!online && (
            <span className="flex items-center gap-1 text-amber-400">
              <CloudOff className="w-4 h-4" /> Offline
            </span>
          )}
          {pending > 0 && (
            <span className="text-gray-400">{pending} to send</span>
          )}
        </div>
      </div>

      {/*
        Receipts the outbox gave up on. Outside the step panels on purpose, so
        it is on screen wherever the porter is in the flow, and it stays there:
        a strip, not a modal — this is a phone held one-handed on a dock, and a
        dialog they have to dismiss to keep working is a dialog they dismiss
        without reading. It names the orders and the one thing they can still do
        about them, which is only true while they are standing there with the
        paperwork.
      */}
      {drops.length > 0 && (
        <div
          role="alert"
          data-ux-key="door:dropped"
          className="mx-4 mt-3 rounded-xl border border-rose-400/50 bg-rose-500/10 px-3 py-2 text-sm text-rose-200"
        >
          <p>
            {drops.length === 1
              ? `Delivery ${drops[0].orderLabel} was saved on this phone and never sent.`
              : `${drops.length} deliveries saved on this phone were never sent.`}{' '}
            {/*
              The remedy, and only a remedy the cause supports. An expired
              session is the one cause this screen can tell apart (the outbox
              records a 401/403 drop as `auth`), and it is the one where "tell a
              manager" sends the porter up a flight of stairs for something they
              could fix at the door in ten seconds. When the drops are mixed or
              the cause is anything else, no cause is claimed at all.
            */}
            {drops.every((d) => d.reason === 'auth')
              ? 'The app was signed out. Sign in again before recording another — and keep the paperwork: the count is not on the server.'
              : 'The app has given up. Keep the paperwork and tell a manager: the count is not on the server.'}
          </p>
          {drops.length > 1 && (
            <ul className="mt-2 space-y-1 text-rose-200/90">
              {drops.map((d) => (
                <li key={d.id}>
                  {d.orderLabel} · {shortTime(d.droppedAt)}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={acknowledgeDrops}
            data-ux-key="door:dropped-ack"
            className={cn(
              TAP,
              'mt-2 w-full rounded-lg bg-white/10 active:bg-white/20 text-xs font-semibold',
            )}
          >
            I have the paperwork
          </button>
        </div>
      )}

      {step === 'photo' && (
        <Panel
          title="Photograph the paperwork"
          hint="Whatever the driver handed you. It does not matter which document it is."
        >
          <input
            ref={fileRef}
            type="file"
            accept={SCAN_ACCEPT}
            // Opens the rear camera directly on a phone rather than a file
            // browser — one less tap, and the receiver's hands are full.
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handlePhoto(f)
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            data-ux-key="door:photo"
            disabled={uploading}
            className={cn(
              'w-full rounded-3xl bg-wine-600 active:bg-wine-700 disabled:opacity-70',
              'flex flex-col items-center justify-center gap-3 py-14 font-bold text-lg',
            )}
          >
            {uploading ? (
              <Loader2 className="w-10 h-10 animate-spin" />
            ) : (
              <Camera className="w-10 h-10" />
            )}
            {uploading ? 'Reading…' : 'Take photo'}
          </button>

          {/* An escape hatch, because sometimes there genuinely is no paper. */}
          <button
            type="button"
            onClick={() => setStep('count')}
            data-ux-key="door:skip-photo"
            className={cn(TAP, 'w-full mt-4 text-sm text-gray-400 underline')}
          >
            No paperwork with this delivery
          </button>
        </Panel>
      )}

      {step === 'count' && (
        <Panel
          title="How many boxes?"
          hint="Count the boxes, not the bottles. Someone will open them later."
        >
          {photoTaken && (
            <p
              className={cn(
                'mb-6 text-sm flex items-center gap-2',
                documentId ? 'text-emerald-300' : 'text-amber-300',
              )}
            >
              <Check className="w-4 h-4" />
              {documentId
                ? 'Paperwork attached.'
                : // The photo was taken but did not upload. Worth saying, because
                  // the receiver may still have the paper in their hand and can
                  // put it somewhere a manager will find it.
                  'Photo taken but not sent yet — keep the paper for now.'}
            </p>
          )}

          <Stepper
            value={cases}
            onChange={setCases}
            label="Boxes delivered"
            uxKey="door:cases"
          />

          <div className="mt-8">
            <Stepper
              value={damaged}
              onChange={setDamaged}
              label="Anything visibly broken?"
              tone="warn"
              uxKey="door:damaged"
            />
            {damaged > 0 && (
              <p className="mt-3 text-sm text-amber-300/90">
                {/* Not asked to classify it: a receiver cannot tell corked from
                    broken from wrong-SKU, and the question costs forty seconds
                    and yields the word "damage". */}
                Photograph the damage if you can. A manager will sort out what it is.
              </p>
            )}
          </div>

          {error && (
            <p className="mt-6 text-sm text-rose-300" role="alert">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting}
            data-ux-key="door:submit"
            className={cn(
              'w-full mt-10 rounded-2xl bg-emerald-600 active:bg-emerald-700',
              'py-6 text-lg font-bold disabled:opacity-70 flex items-center justify-center gap-2',
            )}
          >
            {submitting ? <Loader2 className="w-6 h-6 animate-spin" /> : null}
            {submitting ? 'Saving…' : 'Done'}
          </button>
        </Panel>
      )}

      {step === 'done' && (
        <Panel title="Saved">
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="w-20 h-20 rounded-full bg-emerald-600 flex items-center justify-center">
              <Check className="w-10 h-10" />
            </div>
            <p className="text-center text-gray-300 max-w-xs">
              {queued
                ? drops.length > 0
                  ? // Still "saved", because it is — but the unqualified promise
                    // that it sends itself cannot stand on a phone that has
                    // already had one thrown away. Which receipt was dropped is
                    // not knowable from here, so this does not claim it was
                    // this one.
                    'Saved on this phone. A delivery on this phone has already been given up on, so keep the paperwork until a manager confirms this one landed.'
                  : // True, and the only thing they need to know. Saying "failed"
                    // here would send them back to the clipboard for good.
                    'Saved on this phone. It will send itself when you have signal.'
                : 'Recorded. Someone will count the bottles and check it against the invoice.'}
            </p>
            <button
              type="button"
              onClick={() => navigate('/orders')}
              data-ux-key="door:finish"
              className={cn(TAP, 'mt-4 px-8 rounded-2xl bg-white/10 font-semibold')}
            >
              Finish
            </button>
          </div>
        </Panel>
      )}
    </div>
  )
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex-1 flex flex-col px-5 pt-8 pb-10 max-w-md w-full mx-auto">
      {/*
        text-white is explicit, not inherited. A global stylesheet sets h1 to
        gray-900, which on this near-black panel renders the heading invisible —
        and this screen is used outdoors, in daylight, by someone in a hurry.
      */}
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      {hint && <p className="mt-2 text-sm text-gray-300">{hint}</p>}
      <div className="mt-8 flex-1">{children}</div>
    </div>
  )
}

/**
 * Big stepper.
 *
 * Buttons rather than a numeric keypad: a keypad on a phone in a stairwell means
 * a typo of ten times the real number, and there is no second person to catch it.
 */
function Stepper({
  value,
  onChange,
  label,
  tone = 'default',
  uxKey,
}: {
  value: number
  /**
   * A setState, not a plain callback, so the handlers can update functionally.
   * Reading `value` from the closure loses taps: two presses landing in one
   * render both compute from the same stale number, so 1 + 1 + 1 = 2. On a
   * laggy phone with a cold thumb that is a mis-recorded delivery.
   */
  onChange: React.Dispatch<React.SetStateAction<number>>
  label: string
  tone?: 'default' | 'warn'
  uxKey?: string
}) {
  return (
    <div data-ux-key={uxKey}>
      <p className="text-sm font-semibold text-gray-300 mb-3">{label}</p>
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange((v) => Math.max(0, v - 1))}
          className={cn(
            TAP,
            'flex-1 h-20 rounded-2xl bg-white/10 active:bg-white/20 flex items-center justify-center',
          )}
        >
          <Minus className="w-8 h-8" />
        </button>
        <span
          className={cn(
            'w-24 text-center text-5xl font-bold tabular-nums',
            tone === 'warn' && value > 0 ? 'text-amber-400' : 'text-white',
          )}
          aria-live="polite"
        >
          {value}
        </span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => onChange((v) => v + 1)}
          className={cn(
            TAP,
            'flex-1 h-20 rounded-2xl bg-white/10 active:bg-white/20 flex items-center justify-center',
          )}
        >
          <Plus className="w-8 h-8" />
        </button>
      </div>
    </div>
  )
}

/** Clock time only. The date is noise: a drop the porter can still act on
 *  happened during the shift they are standing in. */
function shortTime(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? 'time not recorded'
    : at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** File to bare base64 (no data: prefix, which the API does not want). */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
