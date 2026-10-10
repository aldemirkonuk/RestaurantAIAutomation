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
 * F-291: a count of one shelf reconciles that shelf only. When the house has
 * storage locations the counter picks where they counted (or "every shelf
 * together"); the count then carries locationId and record_stock_count compares
 * and corrects that shelf's lots only. With no locations, or "every shelf", the
 * number replaces the total across every location, and the panel says so. The
 * field opens empty (F-294): a count pre-filled with the book figure recorded
 * "the books were right" for anyone who tapped Submit without counting.
 *
 * F-645: once a count is saved the panel shows what the books said, what was
 * counted and the difference, before it closes. A queued count has no answer
 * yet, so it closes as before with "will sync".
 */
import { useEffect, useId, useRef, useState } from 'react'
import { X, Mic, Camera, Loader2, Check } from 'lucide-react'
import { useNotificationStore } from '../../../stores'
import { estimateCountFromPhoto } from '../../../services/api/inventory'
import { submitSpotCount, newClientCountId } from '../../../lib/spotCountOutbox'
import { cn } from '../../../lib/utils'
import type { InventoryItem } from '../useInventoryPage'
import type { SpotCountRecord } from '../../../services/api/inventory'
import type { StorageLocation } from '../../../hooks/useStorageLocations'
import { SCAN_ACCEPT, resolveMimeType } from '../../../lib/uploadAccept'
import { useModalDialog } from '../../../hooks/useModalDialog'
import { useHouseGroupMark } from '../../../hooks/useHouseGroupMark'
import { getHouseLocale } from '../../../lib/houseCurrency'
import { parseDecimal, type GroupMark } from '../../../lib/parseDecimal'

interface SpotCountPanelProps {
  item: InventoryItem
  /** The house's storage locations. Empty = the count is of every shelf. */
  houseLocations?: StorageLocation[]
  onClose: () => void
  onCommitted: () => void
}

/** The "every shelf together" choice in the where-counted picker. */
const EVERY_SHELF = '__every_shelf__'

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

/**
 * The one number in what was heard, `'two'` when more than one was heard, or
 * null when none was.
 *
 * F-1024 (re-hit of wave6sim locale-text #10): this took the FIRST run of
 * digits, so "1.5" was 1 and "twelve or thirteen" summed to 25. Digits are now
 * read by the house's marks (`parseDecimal`), the English words only where the
 * house speaks English, and a second number anywhere is refused rather than
 * picked — the counter says it again or types it.
 */
export function parseSpokenNumber(
  transcript: string,
  group: GroupMark | null = null,
  locale = 'en-US',
): number | null | 'two' {
  const runs = transcript.match(/\d[\d.,]*\d|\d/g) ?? []
  const words = locale.toLowerCase().startsWith('en') ? spokenWords(transcript) : null
  if (runs.length > 1 || words === 'two' || (runs.length === 1 && words !== null)) return 'two'
  if (runs.length === 1) return parseDecimal(runs[0], group)
  return words
}

/** English number words as one number, `'two'` for more than one, null for none. */
function spokenWords(transcript: string): number | null | 'two' {
  const words = transcript.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter(Boolean)
  let total = 0
  let tens = 0
  let last: 'unit' | 'teen' | 'tens' | 'hundred' | null = null
  let gap = false
  for (const w of words) {
    if (w === 'and' && last !== null) continue
    if (w === 'hundred') {
      total = (total + tens || 1) * 100
      tens = 0
      last = 'hundred'
      continue
    }
    const n = WORD_NUMBERS[w]
    if (n === undefined) {
      if (last !== null) gap = true
      continue
    }
    // "twelve or thirteen", "three four": a second number, not a bigger one.
    if (gap) return 'two'
    const fresh = last === null || last === 'hundred'
    if (n >= 20 && n % 10 === 0) {
      if (!fresh) return 'two'
      tens = n
      last = 'tens'
    } else if (n < 10 && last === 'tens') {
      total += tens + n
      tens = 0
      last = 'unit'
    } else {
      if (!fresh) return 'two'
      total += n
      last = n < 10 ? 'unit' : 'teen'
    }
  }
  return last === null ? null : total + tens
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

const bottles = (n: number) => `${n} bottle${n === 1 ? '' : 's'}`

/** The difference in the counter's words: how far off the books were. */
export function varianceSentence(c: SpotCountRecord): string {
  const v = c.varianceQty ?? 0
  if (v === 0) return 'The books were right.'
  return `${bottles(Math.abs(v))} ${v < 0 ? 'fewer' : 'more'} than the books — the books now say ${c.countedQty}.`
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

export function SpotCountPanel({ item, houseLocations = [], onClose, onCommitted }: SpotCountPanelProps) {
  const toast = useNotificationStore()
  const dialogRef = useModalDialog(true, onClose)
  const titleId = useId()
  const inventoryId = item.inventoryId || ''
  const fileRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const [qty, setQty] = useState<string>('')
  const group = useHouseGroupMark()
  const [listening, setListening] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoNote, setPhotoNote] = useState<string | null>(null)
  const [result, setResult] = useState<SpotCountRecord | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const voiceSupported = !!getSpeechRecognition()
  const shelvesHolding = (item.locations ?? []).filter((l) => l.qty > 0).length
  // F-945: a shelf count compares the number counted with that shelf's own
  // lots, so it may only be offered where those lots are everything a counter
  // standing there would see. A zone that holds other zones is not offered
  // (its racks' bottles would be counted against the zone's books alone), and
  // while any bottle of this wine is on the books with no shelf -- the door
  // books stock with no place -- or on such a zone, only a count of every
  // shelf is offered: a shelf count would book those bottles a second time.
  const parentIds = new Set(houseLocations.map((l) => l.parentId).filter(Boolean))
  const shelves = houseLocations.filter((l) => !parentIds.has(l.id))
  const shelfIds = new Set(shelves.map((l) => l.id))
  const unshelved = (item.locations ?? [])
    .filter((l) => l.qty > 0 && !(l.locationId && shelfIds.has(l.locationId)))
    .reduce((n, l) => n + l.qty, 0)
  // With shelves, the counter says where they counted before submitting:
  // '' = not chosen yet, EVERY_SHELF = the whole total, else a location id.
  const picksShelf = shelves.length > 0 && unshelved === 0
  const [where, setWhere] = useState<string>(picksShelf ? '' : EVERY_SHELF)
  const shelf = picksShelf ? (shelves.find((l) => l.id === where) ?? null) : null
  const shelfBook = shelf
    ? (item.locations ?? []).filter((l) => l.locationId === shelf.id).reduce((n, l) => n + l.qty, 0)
    : null

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
    // The house's own language (F-1024): a Turkish cellar says "on iki".
    const locale = getHouseLocale()
    recognition.lang = locale
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? ''
      const parsed = parseSpokenNumber(transcript, group, locale)
      if (parsed === 'two') {
        toast.error('Heard more than one number', `Heard: "${transcript}". Say just the count, or type it.`)
      } else if (parsed != null && (!Number.isInteger(parsed) || parsed < 0)) {
        toast.error('A count is whole bottles', `Heard: "${transcript}". Say the whole number, or type it.`)
      } else if (parsed != null) {
        // Never commits — only fills the field (decision E45).
        setQty(String(parsed))
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
    try {
      const { synced, count } = await submitSpotCount({
        itemId: inventoryId,
        itemLabel: item.name,
        body: {
          countedQty,
          clientCountId: newClientCountId(),
          reason: 'Spot count',
          ...(shelf ? { locationId: shelf.id } : {}),
        },
      })
      onCommitted()
      if (synced && count && count.expectedQty != null && count.countedQty != null) {
        setResult(count)
        return
      }
      toast.success(
        synced ? 'Count recorded' : 'Count saved — will sync',
        synced
          ? `${item.name}: ${countedQty} bottles${shelf ? ` on ${shelf.name}` : ''}`
          : 'No signal right now; it will sync automatically.',
      )
      onClose()
    } catch (e: any) {
      toast.error('Count failed', e?.response?.data?.message || e?.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 id={titleId} className="text-sm font-bold text-gray-900">{picksShelf ? 'Count bottles' : 'Count every shelf'}</h3>
            <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">{item.name}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        {result ? (
          <div className="p-5 space-y-4" data-testid="spot-count-result">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-[11px] text-gray-400">Books said</dt>
                <dd className="text-2xl font-mono font-bold text-gray-900">{result.expectedQty}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-gray-400">You counted</dt>
                <dd className="text-2xl font-mono font-bold text-gray-900">{result.countedQty}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-gray-400">Difference</dt>
                <dd
                  className={cn(
                    'text-2xl font-mono font-bold',
                    (result.varianceQty ?? 0) === 0 ? 'text-gray-900' : 'text-rose-600',
                  )}
                >
                  {(result.varianceQty ?? 0) > 0 ? '+' : ''}
                  {result.varianceQty ?? 0}
                </dd>
              </div>
            </dl>
            <p className="text-sm text-gray-700 text-center">
              {result.replayed ? 'This count was already saved. ' : 'Count saved. '}
              {varianceSentence(result)}
            </p>
            <button
              onClick={onClose}
              className="w-full h-11 bg-wine-600 hover:bg-wine-700 text-white text-sm font-bold rounded-xl"
            >
              Done
            </button>
          </div>
        ) : (
        <div className="p-5 space-y-4">
          {picksShelf && (
            <select
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              aria-label="Where you counted"
              className="w-full h-10 px-3 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-wine-500"
            >
              <option value="" disabled>
                Where did you count?
              </option>
              {shelves.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
              <option value={EVERY_SHELF}>Every shelf together</option>
            </select>
          )}
          <p className="text-xs text-gray-600 leading-relaxed" data-testid="spot-count-scope">
            {shelf ? (
              `Count every bottle of this wine on ${shelf.name}, then enter that number. Only ${shelf.name} changes; the other places stay as they are.`
            ) : where === EVERY_SHELF ? (
              <>
                Count every bottle of this wine in every room, then enter the total. It replaces the total for all of
                them, so a count of one shelf would take the others off the books.
                {shelvesHolding > 1 && ` The books have it in ${shelvesHolding} places.`}
                {shelves.length > 0 &&
                  unshelved > 0 &&
                  ` ${bottles(unshelved)} ${unshelved === 1 ? 'is' : 'are'} not on any one shelf yet, so count every shelf together until they are put on one.`}
              </>
            ) : (
              'Pick the place you counted. Only that place changes.'
            )}
          </p>
          <div className="text-center">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full text-center text-4xl font-mono font-bold text-gray-900 border border-gray-200 rounded-xl py-4 focus:outline-none focus:ring-2 focus:ring-wine-500"
              placeholder={shelf ? 'Bottles' : 'Total'}
              aria-label={shelf ? `Bottles counted on ${shelf.name}` : 'Bottles counted, every shelf'}
            />
            <p className="text-[11px] text-gray-400 mt-1.5">
              {shelf
                ? `On the books for ${shelf.name}: ${shelfBook} bottles`
                : `On the books, all shelves together: ${item.liveStock ?? 'unknown'} bottles`}
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
            disabled={submitting || qty === '' || where === ''}
            className="w-full h-11 bg-wine-600 hover:bg-wine-700 text-white text-sm font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Submit count
          </button>
          <p className="text-[10.5px] text-gray-400 text-center leading-relaxed">
            Voice and photo only suggest a number — nothing is saved until you tap Submit.
          </p>
        </div>
        )}
      </div>
    </div>
  )
}
