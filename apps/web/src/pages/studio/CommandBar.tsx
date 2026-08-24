import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Link2, FileText, Globe, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { useStudioSessionStore } from '../../stores/useStudioSessionStore'
import { SCAN_ACCEPT, isScannable, isPdfFile, resetFileInput } from '../../lib/uploadAccept'

type IngestionType = 'pdf' | 'url' | 'manual' | null

function detectIngestionType(value: string, hasPdfFile: boolean): IngestionType {
  if (hasPdfFile) return 'pdf'
  if (/^https?:\/\//i.test(value.trim())) return 'url'
  if (value.trim().length > 0) return 'manual'
  return null
}

export function CommandBar() {
  const { user } = useAuth()
  const { setSession, setRecords, setIsExtracting, setExtractionError, isExtracting } = useStudioSessionStore()
  const [inputValue, setInputValue] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const detectedType = detectIngestionType(inputValue, pendingFile !== null)
  const canIngest = !isExtracting && detectedType !== null

  // All studio/onboarding API calls go through Vite proxy → FastAPI (port 8000)
  // Using relative URLs avoids the VITE_API_GATEWAY_URL=4000 (NestJS) misdirection
  // Studio's endpoints live in the PYTHON orchestrator (services/agent-orchestrator/
  // main.py, with tests), not in the NestJS gateway. A relative path here goes through
  // the Vite/Vercel proxy to the gateway, which has no /studio or /onboarding module —
  // so every studio call 404'd in dev and prod despite a working backend existing.
  // Same env var CameraCapture already uses.
  const studioFetch = async (path: string, body: object) => {
    const token = localStorage.getItem('accessToken')
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
    const base = import.meta.env?.VITE_AGENT_ORCHESTRATOR_URL || ''
    const resp = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}))
      throw new Error(errData.detail || `HTTP ${resp.status}`)
    }
    return resp.json()
  }

  const handleIngest = async (overrideType?: unknown) => {
    // When called from button onClick, overrideType is a MouseEvent — ignore it
    const type = (overrideType === 'manual' ? 'manual' : null) ?? detectedType
    if (!type || isExtracting) return
    setIsExtracting(true)
    setExtractionError(null)
    try {
      if (type === 'pdf' && pendingFile) {
        const fileBase64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader()
          reader.onload = (e) => res((e.target?.result as string).split(',')[1])
          reader.onerror = rej
          reader.readAsDataURL(pendingFile)
        })
        const asPdf = isPdfFile(pendingFile)
        const sessData = await studioFetch('/api/v1/studio/sessions', {
          source_type: asPdf ? 'pdf_upload' : 'image_upload',
          source_ref: pendingFile.name,
        })
        const sessionId = sessData.session?.id ?? null

        // /api/v1/onboarding/extract takes either `pdf_base64` (native PDF
        // path) or `images` (list of page base64) — send whichever matches
        // the file actually picked, rather than forcing everything down the
        // PDF branch.
        const extractData = await studioFetch('/api/v1/onboarding/extract', {
          restaurant_id: user?.restaurantId ?? 'studio',
          ...(asPdf ? { pdf_base64: fileBase64 } : { images: [fileBase64] }),
        })

        // Claude returns each field as {value, confidence, source}.
        // Flatten: plain string values on the record, confidence data in field_confidence.
        // submission_id is the real Supabase UUID stamped by the backend on each wine.
        const wines = (extractData.wines ?? []).map((w: Record<string, unknown>, i: number) => {
          // Use the real Supabase UUID returned by the backend; fall back to a stable
          // client-generated UUID only if the backend omitted it (e.g. Supabase unavailable).
          const realSubmissionId = (typeof w.submission_id === 'string' && w.submission_id.length > 10)
            ? w.submission_id
            : crypto.randomUUID()
          const flat: Record<string, unknown> = { id: String(i), submission_id: realSubmissionId }
          const fc: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(w)) {
            if (k === 'submission_id') continue  // already handled above
            if (k === 'field_confidence') {
              Object.assign(fc, v)
            } else if (v && typeof v === 'object' && 'value' in v && 'confidence' in v) {
              flat[k] = (v as { value: unknown }).value  // plain string
              fc[k] = v                                  // {value, confidence, source}
            } else {
              flat[k] = v
            }
          }
          flat.field_confidence = fc
          return flat
        })
        setSession(sessionId, extractData.scan_session_id ?? null)
        setRecords(wines)
        try {
          localStorage.setItem('wineops_last_extraction', JSON.stringify({
            session_id: sessionId, source: pendingFile.name,
            extracted_at: new Date().toISOString(), wines,
          }))
        } catch { /* quota exceeded — non-fatal */ }
        toast.success('Extraction complete', { description: `${extractData.total_wines ?? 0} wines extracted` })

      } else if (type === 'url') {
        const sessData = await studioFetch('/api/v1/studio/sessions', {
          source_type: 'url_crawl', source_ref: inputValue.trim(),
        })
        setSession(sessData.session?.id ?? null, null)
        setRecords([])
        toast.info('Crawl queued', { description: 'URL crawler started — records will appear as they are extracted.' })

      } else if (type === 'manual') {
        const wineName = (overrideType ? '' : inputValue.trim()) || null
        const sessData = await studioFetch('/api/v1/studio/sessions', {
          source_type: 'manual_seed', source_ref: wineName ?? 'empty',
        }).catch(() => ({ session: { id: `local-${Date.now()}` } }))
        setSession(sessData.session?.id ?? `local-${Date.now()}`, null)
        setRecords([{
          id: 'new-1', submission_id: crypto.randomUUID(),
          wine_name: wineName, vintage: null, producer: null, region: null, country: null,
          grape_variety: null, color: null, primary_type: null,
          sweetness_level: null, price_bottle: null, price_glass: null,
          description: null, tasting_notes: null,
          field_confidence: null,
        }])
        toast.success('Empty record ready', { description: 'Click any cell to start filling in wine details.' })
      }
    } catch (err) {
      setExtractionError(String(err))
      toast.error('Ingestion failed', { description: String(err) })
    } finally {
      setIsExtracting(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (file && isScannable(file)) {
      setPendingFile(file)
      setInputValue(file.name)
    } else if (file) {
      toast.error(`"${file.name}" is not a PDF or image.`, {
        description: 'Drop a PDF or a photo of the list, or paste a URL.',
      })
    }
  }

  const handleBarClick = (e: React.MouseEvent) => {
    // Open native file picker when clicking the bar background (not input/button)
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.closest('button')) return
    fileInputRef.current?.click()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="w-full"
    >
      <div
        className={`flex items-center gap-3 h-16 px-4 rounded-xl border transition-all duration-150 bg-white cursor-pointer
          ${dragActive ? 'border-wine-500 bg-wine-50 border-dashed scale-[1.002]' : 'border-slate-200'}
          ${isExtracting ? 'opacity-80 cursor-wait' : ''}
          shadow-[0_1px_3px_rgb(0_0_0/0.04),0_4px_12px_rgb(0_0_0/0.06)]
          focus-within:shadow-[0_12px_40px_rgb(0_0_0/0.12)] focus-within:border-wine-500
        `}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        onClick={handleBarClick}
        title="Click to select a PDF or image from your computer"
      >
        {pendingFile ? (
          <FileText className="w-5 h-5 text-wine-600 flex-shrink-0" />
        ) : (
          <Link2 className="w-5 h-5 text-slate-400 flex-shrink-0" />
        )}
        <input
          className="flex-1 text-base bg-transparent outline-none placeholder:text-slate-400 text-slate-900 disabled:cursor-not-allowed"
          placeholder="Click to pick a PDF or photo, drag & drop, or paste a URL — auto-detected"
          value={inputValue}
          disabled={isExtracting}
          onChange={(e) => { setInputValue(e.target.value); setPendingFile(null) }}
          onKeyDown={(e) => e.key === 'Enter' && handleIngest()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept={SCAN_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f && isScannable(f)) {
              setPendingFile(f)
              setInputValue(f.name)
            } else if (f) {
              toast.error(`"${f.name}" is not a PDF or image.`)
            }
            resetFileInput(e.target)
          }}
        />
        <button
          onClick={handleIngest}
          disabled={!canIngest}
          className="flex-shrink-0 px-6 py-3 bg-wine-600 text-white text-sm font-semibold rounded-lg hover:bg-wine-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isExtracting ? <><Loader2 className="w-4 h-4 animate-spin" /> Ingesting...</> : 'Ingest'}
        </button>
      </div>

      <div className="mt-2 h-5 flex items-center gap-2">
        {detectedType === 'url' && (
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <Globe className="w-3 h-3" /> Detected: Restaurant URL — will use Gemini Flash crawler
          </span>
        )}
        {detectedType === 'pdf' && (
          <span className="text-xs text-slate-500 flex items-center gap-1">
            <FileText className="w-3 h-3" /> Detected: PDF menu — will use Claude Vision extraction
          </span>
        )}
        {dragActive && (
          <span className="text-xs text-wine-600 flex items-center gap-1">
            <Upload className="w-3 h-3" /> Drop PDF here
          </span>
        )}
        {!dragActive && !detectedType && !isExtracting && (
          <button
            onClick={() => handleIngest('manual')}
            className="text-sm text-wine-600 hover:underline cursor-pointer bg-transparent border-0 p-0"
          >
            Or start with an empty record →
          </button>
        )}
      </div>
    </motion.div>
  )
}
