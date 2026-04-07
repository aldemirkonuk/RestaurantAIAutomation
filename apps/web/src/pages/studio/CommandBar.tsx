import { useState, useRef } from 'react'
import { motion } from 'framer-motion'
import { Link2, FileText, Globe, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import { useStudioSessionStore } from '../../stores/useStudioSessionStore'

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

  const handleIngest = async () => {
    if (!canIngest) return
    setIsExtracting(true)
    setExtractionError(null)
    const token = localStorage.getItem('accessToken')
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
    const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'
    try {
      if (detectedType === 'pdf' && pendingFile) {
        const base64 = await new Promise<string>((res, rej) => {
          const reader = new FileReader()
          reader.onload = (e) => res((e.target?.result as string).split(',')[1])
          reader.onerror = rej
          reader.readAsDataURL(pendingFile)
        })
        const sessResp = await fetch(`${API_URL}/api/v1/studio/sessions`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_type: 'pdf_upload', source_ref: pendingFile.name }),
        })
        const sessData = await sessResp.json()
        const sessionId = sessData.session?.id ?? null

        const extractResp = await fetch(`${API_URL}/api/v1/onboarding/extract`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ restaurant_id: user?.restaurantId ?? 'studio', images: [base64] }),
        })
        const extractData = await extractResp.json()
        setSession(sessionId, extractData.scan_session_id ?? null)
        setRecords((extractData.wines ?? []).map((w: Record<string, unknown>, i: number) => ({
          id: String(i),
          submission_id: String(i),
          ...w,
        })))
        toast.success('Extraction complete', { description: `${extractData.total_wines ?? 0} wines extracted` })
      } else if (detectedType === 'url') {
        const sessResp = await fetch(`${API_URL}/api/v1/studio/sessions`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_type: 'url_crawl', source_ref: inputValue.trim() }),
        })
        const sessData = await sessResp.json()
        setSession(sessData.session?.id ?? null, null)
        setRecords([])
        toast.info('Crawl queued', { description: 'URL crawler started — records will appear as they are extracted.' })
      } else if (detectedType === 'manual') {
        const sessResp = await fetch(`${API_URL}/api/v1/studio/sessions`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_type: 'manual_seed', source_ref: inputValue.trim() }),
        })
        const sessData = await sessResp.json()
        setSession(sessData.session?.id ?? null, null)
        setRecords([{
          id: 'new-1',
          submission_id: 'new-1',
          wine_name: inputValue.trim() || null,
          vintage: null, producer: null, region: null, country: null,
          grape_variety: null, color: null, primary_type: null,
          sweetness_level: null, price_bottle: null, price_glass: null,
          field_confidence: null,
        }])
      }
    } catch (err) {
      setExtractionError(String(err))
      toast.error('Ingestion failed', { description: 'Check your connection and try again.' })
    } finally {
      setIsExtracting(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files[0]
    if (file?.name.toLowerCase().endsWith('.pdf')) {
      setPendingFile(file)
      setInputValue(file.name)
    } else {
      toast.error('Only PDF files are supported for drag-and-drop.')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="w-full"
    >
      <div
        className={`flex items-center gap-3 h-16 px-4 rounded-xl border transition-all duration-150 bg-white
          ${dragActive ? 'border-wine-500 bg-wine-50 border-dashed scale-[1.002]' : 'border-slate-200'}
          ${isExtracting ? 'opacity-80' : ''}
          shadow-[0_1px_3px_rgb(0_0_0/0.04),0_4px_12px_rgb(0_0_0/0.06)]
          focus-within:shadow-[0_12px_40px_rgb(0_0_0/0.12)] focus-within:border-wine-500
        `}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true) }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {pendingFile ? (
          <FileText className="w-5 h-5 text-wine-600 flex-shrink-0" />
        ) : (
          <Link2 className="w-5 h-5 text-slate-400 flex-shrink-0" />
        )}
        <input
          className="flex-1 text-base bg-transparent outline-none placeholder:text-slate-400 text-slate-900 disabled:cursor-not-allowed"
          placeholder="Paste a URL or drop a PDF — we'll auto-detect and start ingestion"
          value={inputValue}
          disabled={isExtracting}
          onChange={(e) => { setInputValue(e.target.value); setPendingFile(null) }}
          onKeyDown={(e) => e.key === 'Enter' && handleIngest()}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) { setPendingFile(f); setInputValue(f.name) }
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
            onClick={() => setInputValue('manual')}
            className="text-sm text-wine-600 hover:underline cursor-pointer bg-transparent border-0 p-0"
          >
            Or start with an empty record →
          </button>
        )}
      </div>
    </motion.div>
  )
}
