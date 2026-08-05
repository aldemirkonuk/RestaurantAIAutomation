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
 */
import { useEffect, useRef, useState } from 'react'
import { X, Mic, Camera, Loader2, Check } from 'lucide-react'
import { useNotificationStore } from '../../../stores'
import { estimateCountFromPhoto } from '../../../services/api/inventory'
import { submitSpotCount, newClientCountId } from '../../../lib/spotCountOutbox'
import { cn } from '../../../lib/utils'
import type { InventoryItem } from '../useInventoryPage'

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

export function SpotCountPanel({ item, onClose, onCommitted }: SpotCountPanelProps) {
  const toast = useNotificationStore()
  const inventoryId = item.inventoryId || ''
  const fileRef = useRef<HTMLInputElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)

  const [qty, setQty] = useState<string>(item.liveStock != null ? String(item.liveStock) : '')
  const [listening, setListening] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoNote, setPhotoNote] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const voiceSupported = !!getSpeechRecognition()

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
      setPhotoPreview(`data:${file.type || 'image/jpeg'};base64,${base64}`)
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
      const { synced } = await submitSpotCount({
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
      onCommitted()
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
              accept="image/*"
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
              <img src={photoPreview} alt="Count reference" className="w-12 h-12 object-cover rounded-lg" />
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
