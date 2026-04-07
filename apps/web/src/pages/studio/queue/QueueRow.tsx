import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, X, ExternalLink, ArrowRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '../../../components/ui/badge'
import { TrustProgress } from './TrustProgress'

export interface QueueItem {
  id: string
  submission_id: string
  actor_id: string
  field_name: string
  old_value: string | null
  new_value: string
  old_confidence: number | null
  reason: string | null
  citation_url: string | null
  promotion_status: string
  created_at: string
  actor_email?: string
  actor_role?: string
  trust_count?: number
  wine_name?: string
  vintage?: string
}

interface QueueRowProps {
  item: QueueItem
  onDecide: (id: string, decision: 'approved' | 'rejected', note?: string) => Promise<void>
}

export function QueueRow({ item, onDecide }: QueueRowProps) {
  const [isRejecting, setIsRejecting] = useState(false)
  const [rejectNote, setRejectNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleApprove = async () => {
    setIsSubmitting(true)
    try { await onDecide(item.id, 'approved') } finally { setIsSubmitting(false) }
  }

  const handleConfirmReject = async () => {
    setIsSubmitting(true)
    try { await onDecide(item.id, 'rejected', rejectNote) } finally { setIsSubmitting(false) }
  }

  const isCertifiedContributor = item.actor_role === 'certified_contributor'

  return (
    <motion.tr
      layout
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25 }}
      className="border-b border-slate-100 last:border-0"
    >
      <td className="px-4 py-3 min-w-[200px]">
        <div className="text-sm font-medium text-slate-900">
          {item.wine_name ?? '(unknown)'}
        </div>
        {item.vintage && <div className="text-xs text-slate-400">{item.vintage}</div>}
      </td>
      <td className="px-4 py-3 min-w-[120px]">
        <Badge variant="secondary" size="sm">{item.field_name}</Badge>
      </td>
      <td className="px-4 py-3 min-w-[280px]">
        <div className="flex items-center gap-1 flex-wrap">
          {item.old_value ? (
            <span className="text-sm text-slate-400 line-through">{item.old_value}</span>
          ) : (
            <span className="text-xs italic text-slate-300">empty</span>
          )}
          <ArrowRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
          <span className="text-sm text-slate-900 font-medium">{item.new_value}</span>
        </div>
      </td>
      <td className="px-4 py-3 min-w-[140px]">
        <div className="flex items-center gap-1.5">
          <div className="w-7 h-7 rounded-full bg-wine-100 text-wine-600 text-xs font-semibold flex items-center justify-center flex-shrink-0">
            {(item.actor_email ?? 'U').slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="text-xs text-slate-600 truncate max-w-[100px]">{item.actor_email ?? item.actor_id.slice(0, 8)}</div>
            {isCertifiedContributor && (
              <Badge variant="secondary" size="sm">Contributor</Badge>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3 min-w-[220px]">
        {item.reason ? (
          <span className="text-xs text-slate-600 line-clamp-2" title={item.reason}>{item.reason}</span>
        ) : (
          <span className="text-xs text-slate-400 italic">no reason</span>
        )}
      </td>
      <td className="px-4 py-3 w-[60px]">
        {item.citation_url && (
          <a href={item.citation_url} target="_blank" rel="noopener noreferrer"
             className="text-blue-500 hover:text-blue-700">
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </td>
      <td className="px-4 py-3 min-w-[100px]">
        <span className="text-xs text-slate-400">
          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
        </span>
      </td>
      <td className="px-4 py-3 min-w-[160px]">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <button
              onClick={handleApprove}
              disabled={isSubmitting || isRejecting}
              className="flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 min-h-[44px] disabled:opacity-50 transition-colors"
            >
              <Check className="w-3.5 h-3.5" /> Approve
            </button>
            {!isRejecting && (
              <button
                onClick={() => setIsRejecting(true)}
                disabled={isSubmitting}
                className="flex items-center gap-1 px-3 py-2 text-xs font-semibold border border-red-300 text-red-600 rounded-lg hover:bg-red-50 min-h-[44px] disabled:opacity-50 transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Reject
              </button>
            )}
          </div>

          {/* Inline rejection note — D-05 spirit: no modal */}
          <AnimatePresence>
            {isRejecting && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Optional: reason for rejection (sent to contributor)"
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1 resize-none mt-1"
                  rows={2}
                />
                <div className="flex items-center gap-1 mt-1">
                  <button
                    onClick={handleConfirmReject}
                    disabled={isSubmitting}
                    className="text-xs bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    Confirm Rejection
                  </button>
                  <button
                    onClick={() => setIsRejecting(false)}
                    className="text-xs text-slate-400 hover:underline ml-1"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* D-12 trust progress — only for certified_contributors */}
          {isCertifiedContributor && typeof item.trust_count === 'number' && (
            <TrustProgress approved={item.trust_count} threshold={5} />
          )}
        </div>
      </td>
    </motion.tr>
  )
}
