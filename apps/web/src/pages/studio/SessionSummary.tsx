import { Database, Loader2 } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { useStudioSessionStore } from '../../stores/useStudioSessionStore'

export function SessionSummary() {
  const { sessionId, records, isExtracting, clearSession } = useStudioSessionStore()
  if (!sessionId) return null

  return (
    <div className="flex items-center gap-3 py-2 text-sm text-slate-600">
      <Database className="w-4 h-4 text-slate-400 flex-shrink-0" />
      <span className="text-xs font-mono text-slate-400">{sessionId.slice(0, 12)}</span>
      <Badge variant="secondary">{records.length} records</Badge>
      {isExtracting ? (
        <Badge variant="warning" className="flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Extracting
        </Badge>
      ) : (
        <Badge variant="success">Complete</Badge>
      )}
      <button
        onClick={() => clearSession()}
        className="text-xs text-slate-400 hover:text-red-600 underline cursor-pointer ml-auto"
      >
        Clear session
      </button>
    </div>
  )
}
