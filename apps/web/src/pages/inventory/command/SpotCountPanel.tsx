/**
 * Spot count entry (decisions E40-E46) — a floor-level "walk the shelf and
 * count" screen, distinct from the desk-side "Manual adjust" bar already in
 * RowExpansion. Two input aids, neither of which is ever allowed to write
 * stock on its own:
 *
 * - Voice (Web Speech API): fills the quantity field. Confirm-before-commit
 *   (E45) — a misheard "forty" as "fourteen" must not move stock unattended,
 *   so recognition only ever sets the number shown on screen.
 * - Photo: uploads to a vision estimate endpoint that returns a suggestion
 *   (E46), which — same as voice — only fills the field. The actual write is
 *   always the explicit "Submit count" tap below, through the same
 *   recordSpotCount path apply_stock_movement(reconciliation/mobile_count).
 *
 * Submission goes through spotCountOutbox so a dead cellar signal doesn't
 * cost the count — it queues and syncs when connectivity returns.
 *
 * ── THE HOUSE SHAPE (ADR 0112, census 102 row "Spot count") ───────────────
 * SHAPE: `Sheet` · the seal. One bottle's count is ONE RECORD — an object the
 * counter opens from the row they were already looking at (RowExpansion.tsx:384),
 * so it arrives from the right and the register stays visible behind it. And
 * recording a count writes a `stock_counts` row and, on a variance, a stock
 * movement: a ledger write, which is the act ADR 0112's ration names, so it
 * ends in `HoldToApprove` rather than a button labelled Submit.
 *
 * Three things the legacy branch could not say, all of which the endpoint was
 * already telling it:
 *
 *  1. **How far the record actually got.** `submitSpotCount` returns
 *     `synced: false` for a queued count, and the legacy branch toasted "Count
 *     saved — will sync" and closed. A tick that means "written on this phone"
 *     and a tick that means "the house has it" cannot be the same tick
 *     (sketch 103 `2e`). The house branch draws the ladder — written here ·
 *     sent · the house has it · on the book — and leaves the unreached steps
 *     visibly unreached.
 *  2. **What the count bound.** ADR 0078 returns the count id, the book's
 *     expected figure, the variance and the stamped time on every write
 *     (`stock-count-result.ts:36`); the client's response type dropped it. It
 *     is carried through now, and read back on the sheet.
 *  3. **Where a suggested number came from.** Voice and photo only ever fill
 *     the field, and the legacy branch said so in one line of small print at
 *     the bottom. The house branch keeps the engine's number GREY and beside
 *     the field until the counter takes it, so a proposal cannot be mistaken
 *     for a reading (sketch 103 `2c`).
 *
 * The legacy branch below is frozen and renders byte-for-byte as it shipped.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Mic, Camera, Loader2, Check } from 'lucide-react'
import { useNotificationStore } from '../../../stores'
import { estimateCountFromPhoto, type SpotCountRecord } from '../../../services/api/inventory'
import { submitSpotCount, newClientCountId } from '../../../lib/spotCountOutbox'
import { cn } from '../../../lib/utils'
import type { InventoryItem } from '../useInventoryPage'
import { SCAN_ACCEPT, resolveMimeType } from '../../../lib/uploadAccept'
import { Sheet } from '../../../components/mudavym/Sheet'
import { HoldToApprove } from '../../../components/mudavym/HoldToApprove'
import { useMudavymShell } from '../../../lib/mudavym/shellGround'
import '../../../components/inventory/inventory-mudavym.css'

interface SpotCountPanelProps {
  item: InventoryItem
  onClose: () => void
  onCommitted: () => void
}

// ---------------------------------------------------------------------------
// Spoken-number parsing — small enough not to need a library. Bottle counts
// are almost always under a few hundred, so this covers the practical range.
// ---------------------------------------------------------------------------
const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
}

function parseSpokenNumber(transcript: string): number | null {
  const digitMatch = transcript.match(/\d+/)
  if (digitMatch) return parseInt(digitMatch[0], 10)

  const words = transcript.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean)
  let total: number | null = null
  let pendingTens = 0
  for (const w of words) {
    if (w === 'hundred') {
      total = (total ?? 0) === 0 && pendingTens === 0 ? 100 : ((total ?? 0) + pendingTens) * 100
      pendingTens = 0
      continue
    }
    const n = WORD_NUMBERS[w]
    if (n === undefined) continue
    if (n < 10 && pendingTens > 0) {
      total = (total ?? 0) + pendingTens + n
      pendingTens = 0
    } else if (n >= 20 && n % 10 === 0) {
      pendingTens = n
    } else {
      total = (total ?? 0) + n
    }
  }
  if (pendingTens > 0) total = (total ?? 0) + pendingTens
  return total
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

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

/** How far the record got. Four states, each unmistakable (sketch 103 `2e`). */
type Reach = 'written' | 'sent' | 'received' | 'booked'
const REACH_ORDER: Reach[] = ['written', 'sent', 'received', 'booked']

/** A number the engine proposed, kept apart from the number a person wrote. */
interface Proposal {
  qty: number
  from: 'voice' | 'photo'
  detail: string
}

export function SpotCountPanel({ item, onClose, onCommitted }: SpotCountPanelProps) {
  const toast = useNotificationStore()
  const shell = useMudavymShell()
  const inventoryId = item.inventoryId || ''
  const fileRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const qtyRef = useRef<HTMLInputElement>(null)

  const [qty, setQty] = useState<string>(item.liveStock != null ? String(item.liveStock) : '')
  const [listening, setListening] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoNote, setPhotoNote] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const voiceSupported = !!getSpeechRecognition()
  /* House-branch state. The legacy render below never reads any of it, so the
     flag-off tree is byte-identical. */
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [reach, setReach] = useState<Reach | null>(null)
  const [record, setRecord] = useState<SpotCountRecord | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const readAt = useMemo(() => new Date(), [item.inventoryId, item.liveStock])

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  const startListening = () => {
    const SpeechRecognitionCtor = getSpeechRecognition()
    if (!SpeechRecognitionCtor) {
      toast.error('Voice not supported', 'This browser has no Web Speech API.')
      return
    }
    const recognition = new SpeechRecognitionCtor()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? ''
      const parsed = parseSpokenNumber(transcript)
      if (parsed != null) {
        // Never commits — only fills the field (decision E45).
        setQty(String(parsed))
        setProposal({ qty: parsed, from: 'voice', detail: `heard “${transcript}”` })
        toast.info('Heard a number', `"${transcript}" → ${parsed}. Review before submitting.`)
      } else {
        toast.error('Could not parse a number', `Heard: "${transcript}"`)
      }
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  const stopListening = () => {
    recognitionRef.current?.stop()
    setListening(false)
  }

  const handlePhoto = async (file: File) => {
    setPhotoBusy(true)
    setPhotoNote(null)
    try {
      const base64 = await toBase64(file)
      setPhotoPreview(`data:${resolveMimeType(file)};base64,${base64}`)
      const estimate = await estimateCountFromPhoto(inventoryId, base64)
      setPhotoNote(estimate.note)
      if (estimate.suggestedQty != null) {
        // Never commits — only fills the field (decision E46).
        setQty(String(estimate.suggestedQty))
        setProposal({
          qty: estimate.suggestedQty,
          from: 'photo',
          detail: `confidence ${estimate.confidence}`,
        })
        toast.info(
          `Photo suggests ${estimate.suggestedQty}`,
          `Confidence: ${estimate.confidence}. Review before submitting.`,
        )
      } else {
        toast.error('No confident count from photo', estimate.note)
      }
    } catch (e: any) {
      toast.error('Photo estimate failed', e?.response?.data?.message || e?.message)
    } finally {
      setPhotoBusy(false)
    }
  }

  const handleSubmit = async () => {
    const countedQty = parseInt(qty, 10)
    if (!Number.isFinite(countedQty) || countedQty < 0) {
      toast.error('Enter a valid count', 'Quantity must be zero or a positive whole number.')
      return
    }
    setSubmitting(true)
    setFailure(null)
    setDenied(false)
    /* The number is on this device the moment the hold completes. That is the
       first rung and the only one we can claim without an answer. */
    if (shell.on) setReach('written')
    try {
      if (shell.on) setReach('sent')
      const { synced, record: receipt } = await submitSpotCount({
        itemId: inventoryId,
        itemLabel: item.name,
        body: {
          countedQty,
          clientCountId: newClientCountId(),
          reason: 'Spot count',
        },
      })
      toast.success(
        synced ? 'Count recorded' : 'Count saved — will sync',
        synced ? `${item.name}: ${countedQty} bottles` : 'No signal right now; it will sync automatically.',
      )
      if (shell.on) {
        /* `synced` means the house answered. `receipt.countId` means it wrote a
           row and said so. Neither is assumed from the other, and a queued
           count reaches neither rung — queued is never confirmed. */
        if (synced) setReach(receipt?.countId ? 'booked' : 'received')
        setRecord(receipt ?? null)
        onCommitted()
        return
      }
      onCommitted()
      onClose()
    } catch (e: any) {
      const message = e?.response?.data?.message || e?.message
      toast.error('Count failed', message)
      if (shell.on) {
        setReach(null)
        setDenied(e?.response?.status === 403 || e?.response?.status === 401)
        setFailure(message || 'the request did not complete')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const parsedQty = parseInt(qty, 10)
  const countIsValid = Number.isFinite(parsedQty) && parsedQty >= 0
  const book = item.liveStock
  const variance = countIsValid && book != null ? parsedQty - book : null

  /* ── the house shape ─────────────────────────────────────────────────────
     The title IS the contract sentence and IS the accessible name: what this
     asks, what sealing writes, what leaving costs (sketch 103 `1e`). */
  if (shell.on) {
    const act = `Count ${item.name} on the shelf`
    const contract = `${act}. Sealing writes the count to the book. Leaving writes nothing.`
    const reachIndex = reach ? REACH_ORDER.indexOf(reach) : -1
    const steps: { key: Reach; t: string; sub: string }[] = [
      {
        key: 'written',
        t: 'Written here',
        sub: 'The number is on this device.',
      },
      {
        key: 'sent',
        t: 'Sent',
        sub: 'The request left this device.',
      },
      {
        key: 'received',
        t: 'The house has it',
        sub: 'The gateway answered.',
      },
      {
        key: 'booked',
        t: 'On the book',
        sub: record?.countId
          ? `Count ${record.countId.slice(0, 8)} recorded.`
          : 'A count row was written and named.',
      },
    ]

    return (
      <Sheet
        open
        onClose={onClose}
        label={contract}
        eyebrow="Spot count"
        title={act}
        initialFocusRef={qtyRef}
        closeLabel={reach ? 'Done' : 'Close'}
        zIndex={110}
        footer={
          <span>
            Voice and a photo only ever propose a number. Nothing reaches the book until you hold
            the seal.
          </span>
        }
      >
        <div className="mdv-form">
          {/* The contract, before anything else on the paper. */}
          <p className="mdv-contract">
            This asks one thing: how many bottles are on the shelf. Holding the seal writes the
            count to the book. Leaving writes nothing.
          </p>

          {failure && (
            <div className="mdv-alert" role="alert">
              <p className="mdv-alert__head">{denied ? 'Not permitted' : 'Not recorded'}</p>
              <p>
                {denied
                  ? 'This account is not permitted to record counts. Nothing was written; the book is unchanged.'
                  : `The count was not recorded — ${failure}. The book still reads ${
                      book ?? 'a figure nobody has counted'
                    }. Nothing was written.`}
              </p>
            </div>
          )}

          {reach ? (
            <>
              <div className="mdv-panelbox">
                <p className="mdv-alert__head">How far the record got</p>
                <ul className="mdv-steps">
                  {steps.map((st, i) => (
                    <li
                      key={st.key}
                      className="mdv-step"
                      data-reached={i <= reachIndex ? 'true' : undefined}
                    >
                      <span className="mdv-step__mark" aria-hidden />
                      <span>
                        <b>{st.t}</b>
                        <span className="mdv-line__sub">
                          {i <= reachIndex
                            ? st.sub
                            : st.key === 'received'
                              ? 'Not yet — there was no signal, so it is queued on this device.'
                              : 'Not yet.'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <span className="mdv-prov">
                  {record
                    ? `Counted ${record.countedQty ?? parsedQty} · the book expected ${
                        record.expectedQty ?? 'no figure'
                      } · variance ${
                        record.varianceQty == null
                          ? 'not returned'
                          : record.varianceQty > 0
                            ? `+${record.varianceQty}`
                            : String(record.varianceQty)
                      }${record.replayed ? ' · this count had already landed once' : ''}${
                        record.countedAt
                          ? ` · stamped ${new Date(record.countedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`
                          : ''
                      }`
                    : 'The house has not answered, so there is no receipt to show. It will sync on its own.'}
                </span>
              </div>
              {reach !== 'booked' && (
                <p className="mdv-consequence">
                  Queued is not counted. Until the house answers, the book still reads{' '}
                  <strong>{book ?? 'a figure nobody has counted'}</strong> — this device is holding
                  your number, not the ledger.
                </p>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="mdv-label" htmlFor="mdv-spot-count">
                  Bottles on the shelf
                </label>
                <input
                  id="mdv-spot-count"
                  ref={qtyRef}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="mdv-count"
                  placeholder="0"
                />
                <span className="mdv-prov">
                  {book == null
                    ? 'The book holds no count for this bottle — that is an absence, not a zero.'
                    : `The book says ${book}${
                        item.shadowStock ? ` live · ${item.shadowStock} shadow` : ''
                      } · read ${readAt.toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`}
                  {variance != null && variance !== 0
                    ? ` · your count is ${variance > 0 ? `+${variance}` : variance}`
                    : ''}
                </span>
              </div>

              {/* The engine proposes; a person applies. Grey, beside the field,
                  never inside it — and the grey stays after it is taken. */}
              {proposal && (
                <div className="mdv-panelbox">
                  <p className="mdv-alert__head">The engine</p>
                  <span className="mdv-grey">
                    {proposal.from === 'voice' ? 'Voice' : 'The photo'} proposes {proposal.qty} —{' '}
                    {proposal.detail}.{' '}
                    {String(proposal.qty) === qty
                      ? 'You took it; the seal is still yours to give.'
                      : 'You have not taken it.'}
                  </span>
                  {String(proposal.qty) !== qty && (
                    <div className="mdv-actions" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="mdv-btn"
                        onClick={() => setQty(String(proposal.qty))}
                      >
                        Take {proposal.qty}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div>
                <span className="mdv-head">
                  <span>Two ways to fill the field</span>
                </span>
                <div className="mdv-seg">
                  <button
                    type="button"
                    className="mdv-seg__opt"
                    aria-pressed={listening}
                    onClick={listening ? stopListening : startListening}
                    disabled={!voiceSupported}
                  >
                    {listening ? 'Listening…' : 'Say the count'}
                  </button>
                  <button
                    type="button"
                    className="mdv-seg__opt"
                    onClick={() => fileRef.current?.click()}
                    disabled={photoBusy}
                  >
                    {photoBusy ? 'Reading the photo…' : 'Photograph the shelf'}
                  </button>
                </div>
                {!voiceSupported && (
                  <p className="mdv-hintline">
                    This browser has no speech recognition, so the voice path is not offered here.
                    Typing and the photo both still work.
                  </p>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept={SCAN_ACCEPT}
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) void handlePhoto(f)
                  }}
                />
              </div>

              {photoPreview && (
                <div className="mdv-panelbox">
                  <span className="mdv-grey">{photoNote ?? 'The photo returned no note.'}</span>
                </div>
              )}

              <HoldToApprove
                onApprove={() => void handleSubmit()}
                disabled={submitting || !countIsValid}
                label={
                  submitting
                    ? 'Recording…'
                    : countIsValid
                      ? `Hold to record ${parsedQty} on the shelf`
                      : 'Enter a count first'
                }
                approvedLabel="Recorded"
              />
            </>
          )}
        </div>
      </Sheet>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Spot count</h3>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">{item.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="text-center">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full text-center text-4xl font-mono font-bold text-gray-900 border border-gray-200 rounded-xl py-4 focus:outline-none focus:ring-2 focus:ring-wine-500"
              placeholder="0"
            />
            <p className="text-[11px] text-gray-400 mt-1.5">
              Currently on hand: {item.liveStock ?? 'unknown'} bottles
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={listening ? stopListening : startListening}
              disabled={!voiceSupported}
              className={cn(
                'flex items-center justify-center gap-2 h-11 rounded-xl text-xs font-bold border',
                listening
                  ? 'bg-rose-50 border-rose-200 text-rose-600'
                  : 'border-gray-200 text-gray-700 hover:bg-gray-50',
                !voiceSupported && 'opacity-40 cursor-not-allowed',
              )}
              title={voiceSupported ? 'Say a number' : 'Not supported in this browser'}
            >
              <Mic className="w-4 h-4" />
              {listening ? 'Listening…' : 'Say count'}
            </button>

            <button
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy}
              className="flex items-center justify-center gap-2 h-11 rounded-xl text-xs font-bold border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              {photoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {photoBusy ? 'Reading…' : 'Photo count'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept={SCAN_ACCEPT}
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handlePhoto(f)
              }}
            />
          </div>

          {photoPreview && (
            <div className="flex items-center gap-2.5 bg-gray-50 border border-gray-100 rounded-xl p-2.5">
              {photoPreview.startsWith('data:application/pdf') ? (
                <div className="w-12 h-12 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-[9px] font-bold text-gray-500">
                  PDF
                </div>
              ) : (
                <img src={photoPreview} alt="Count reference" className="w-12 h-12 object-cover rounded-lg" />
              )}
              <p className="text-[11px] text-gray-500 leading-snug">{photoNote}</p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || qty === ''}
            className="w-full h-11 bg-wine-600 hover:bg-wine-700 text-white text-sm font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Submit count
          </button>
          <p className="text-[10.5px] text-gray-400 text-center leading-relaxed">
            Voice and photo only suggest a number — nothing is saved until you tap Submit.
          </p>
        </div>
      </div>
    </div>
  )
}
