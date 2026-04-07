import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ReasonInput } from './ReasonInput'
import { Badge } from '../../components/ui/badge'

interface FieldEntry {
  value: string | null
  confidence: number | null
  source: string | null
  verification_status?: 'pending' | 'verified' | 'rejected'
}

interface FieldCellProps {
  recordId: string
  submissionId: string
  sessionId: string | null
  field: string
  entry: FieldEntry | null
  onOverrideSuccess: (field: string, newValue: string) => void
}

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null || confidence === undefined) {
    return <Badge variant="outline" size="sm" aria-label="Confidence: unknown">—</Badge>
  }
  const pct = Math.round(confidence * 100)
  if (confidence >= 0.8) {
    return <Badge variant="success" size="sm" aria-label={`Confidence: ${pct}% — high`}>{pct}%</Badge>
  }
  if (confidence >= 0.5) {
    return <Badge variant="warning" size="sm" aria-label={`Confidence: ${pct}% — review`}>{pct}%</Badge>
  }
  return <Badge variant="destructive" size="sm" aria-label={`Confidence: ${pct}% — low`}>{pct}%</Badge>
}

function VerificationBadge({ status }: { status?: 'pending' | 'verified' | 'rejected' }) {
  if (!status || status === 'pending') {
    return <Badge variant="outline" size="sm" aria-label="Verification: pending">○</Badge>
  }
  if (status === 'verified') {
    return <Badge variant="success" size="sm" aria-label="Verification: verified">✓</Badge>
  }
  return <Badge variant="destructive" size="sm" aria-label="Verification: rejected">✕</Badge>
}

export function FieldCell({ submissionId, sessionId, field, entry, onOverrideSuccess }: FieldCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  // Coerce to string — Claude can return numbers (vintage, price) and null
  const toStr = (v: unknown) => (v != null ? String(v) : '')
  const [newValue, setNewValue] = useState(() => toStr(entry?.value))
  const [reason, setReason] = useState('')
  const [citationUrl, setCitationUrl] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // D-07: reason required when confidence >= 0.8
  const requiresReason = (entry?.confidence ?? 0) >= 0.8
  const canSave = newValue.trim().length > 0 &&
    newValue !== (entry?.value ?? '') &&
    (!requiresReason || reason.trim().length >= 5)

  const handleSave = async () => {
    if (!canSave) return
    setIsSaving(true)
    setSaveError(null)
    const token = localStorage.getItem('accessToken')
    try {
      const resp = await fetch(`/api/v1/studio/overrides`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          session_id: sessionId,
          submission_id: submissionId,
          field_name: field,
          new_value: newValue.trim(),
          reason: requiresReason ? reason.trim() : null,
          citation_url: citationUrl.trim() || null,
        }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.detail ?? 'Save failed')
      setIsEditing(false)
      onOverrideSuccess(field, newValue.trim())
      if (data.status === 'pending') {
        toast.info('Override queued for review', { description: 'A reviewer will approve your change.' })
      } else {
        toast.success('Override saved', { description: `${field} updated` })
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed. Check your connection.')
      toast.error('Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  if (!isEditing) {
    return (
      <td
        className="px-3 py-2 cursor-pointer hover:bg-slate-50 rounded-sm group min-w-[120px]"
        title="Click to edit"
        tabIndex={0}
        onClick={() => { setIsEditing(true); setNewValue(toStr(entry?.value)) }}
        onKeyDown={(e) => e.key === 'Enter' && setIsEditing(true)}
      >
        <div className="flex items-center gap-1.5">
          <span className={`text-sm ${entry?.value != null ? 'text-slate-900' : 'text-slate-400 italic'}`}>
            {entry?.value != null ? String(entry.value) : '—'}
          </span>
          <ConfidenceBadge confidence={entry?.confidence ?? null} />
          <VerificationBadge status={entry?.verification_status} />
        </div>
        {entry?.source && (
          <div className="text-xs text-slate-400 mt-0.5">
            via {entry.source === 'visible' ? 'Vision' : entry.source === 'knowledge' ? 'Haiku' : entry.source}
            {entry.confidence != null ? ` ${entry.confidence.toFixed(2)}` : ''}
          </div>
        )}
      </td>
    )
  }

  return (
    <td className="px-3 py-2 min-w-[200px] bg-wine-50/60 ring-1 ring-inset ring-wine-200">
      <AnimatePresence mode="wait">
        <motion.div
          key="edit"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          <input
            value={newValue}
            autoFocus
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setIsEditing(false)}
            className="w-full text-sm border border-slate-300 rounded-sm px-2 py-1 focus:ring-2 focus:ring-wine-500 focus:outline-none focus-visible:outline-offset-0 bg-white"
          />

          {/* D-08: reason inline below field, not modal */}
          <ReasonInput
            show={requiresReason}
            value={reason}
            onChange={setReason}
            error={requiresReason && reason.length > 0 && reason.length < 5 ? 'Min 5 characters required' : undefined}
          />

          <input
            type="url"
            value={citationUrl}
            onChange={(e) => setCitationUrl(e.target.value)}
            placeholder="https://... (optional citation URL)"
            className="mt-1 w-full text-xs font-mono border border-slate-200 rounded-sm px-2 py-1 focus:outline-none focus:ring-1 focus:ring-wine-400"
          />

          {saveError && <p className="text-xs text-red-600 mt-1">{saveError}</p>}

          <div className="mt-1.5 flex items-center gap-1">
            <button
              onClick={handleSave}
              disabled={!canSave || isSaving}
              className="text-xs font-semibold bg-wine-600 text-white px-3 py-1 rounded hover:bg-wine-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {isSaving && <Loader2 className="w-3 h-3 animate-spin" />}
              Save Override
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
            >
              ×
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </td>
  )
}
