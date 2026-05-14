import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, Edit2, X } from 'lucide-react'

interface ConstraintWarning {
  code: string
  message: string
  severity: 'annotating' | 'soft'
}

interface DraftEmailData {
  conversationId: string
  orderId: string
  wineName: string
  providerName: string
  providerEmail: string
  emailType: 'PRICE_INQUIRY' | 'DEMAND_OFFER' | 'PROMO_INQUIRY' | 'WINE_INQUIRY'
  draftContent: string
  disclaimer: string
  constraintWarnings: ConstraintWarning[]
  roundCount: number
  timestamp: string
}

interface DraftEmailApprovalPanelProps {
  isOpen: boolean
  draftData: DraftEmailData | null
  onApprove: (modifiedContent?: string, managerNotes?: string) => void
  onDiscard: () => void
  onClose: () => void
  isSubmitting?: boolean
}

const emailTypeBadge: Record<
  DraftEmailData['emailType'],
  { label: string; bg: string; text: string }
> = {
  PRICE_INQUIRY: { label: 'Price Inquiry', bg: 'bg-blue-100', text: 'text-blue-700' },
  DEMAND_OFFER: { label: 'Demand Offer', bg: 'bg-orange-100', text: 'text-orange-700' },
  PROMO_INQUIRY: { label: 'Promo Inquiry', bg: 'bg-purple-100', text: 'text-purple-700' },
  WINE_INQUIRY: { label: 'Wine Inquiry', bg: 'bg-teal-100', text: 'text-teal-700' },
}

export function DraftEmailApprovalPanel({
  isOpen,
  draftData,
  onApprove,
  onDiscard,
  onClose,
  isSubmitting = false,
}: DraftEmailApprovalPanelProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')

  useEffect(() => {
    if (draftData) {
      setEditedContent(draftData.draftContent)
      setIsEditing(false)
    }
  }, [draftData])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!draftData && !isOpen) return null

  const badge = draftData ? emailTypeBadge[draftData.emailType] : null

  return (
    <AnimatePresence>
      {isOpen && draftData && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-panel-title"
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border-2 border-indigo-900 overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            {/* Header — bg-indigo-900 (distinct from ORDER APPROVAL bg-black) */}
            <div className="bg-indigo-900 px-6 py-5 border-b-2 border-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h2
                    id="draft-panel-title"
                    className="text-2xl font-black text-white uppercase tracking-wider"
                  >
                    ✦ AI DRAFT READY
                  </h2>
                  {badge && (
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}
                    >
                      {badge.label}
                    </span>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="text-white hover:text-gray-300 transition-colors p-1 -mr-1"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="bg-gray-50 px-6 py-5 space-y-4">
              {/* Metadata row */}
              <div className="text-sm text-gray-600 space-y-1">
                <p>
                  <span className="font-medium">To:</span> {draftData.providerName} &middot;{' '}
                  {draftData.providerEmail}
                </p>
                <p>
                  <span className="font-medium">Wine:</span> {draftData.wineName}
                </p>
                <p>
                  <span className="font-medium">Round:</span> {draftData.roundCount}
                </p>
              </div>

              {/* Subject preview */}
              <p className="text-sm font-semibold text-gray-800">
                Subject: {draftData.wineName} — {emailTypeBadge[draftData.emailType].label}
              </p>

              {/* Body area — textarea (editing) or pre (preview) */}
              <div>
                {isEditing ? (
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full h-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                    aria-label="Edit draft email content"
                  />
                ) : (
                  <pre className="w-full text-sm text-gray-700 whitespace-pre-wrap font-sans bg-gray-50 rounded-lg p-3 border border-gray-200">
                    {editedContent}
                  </pre>
                )}

                {/* Edit toggle */}
                <button
                  type="button"
                  onClick={() => setIsEditing(!isEditing)}
                  className="w-full h-11 mt-2 bg-gray-700 hover:bg-gray-800 text-white font-medium text-sm rounded-xl transition-all flex items-center justify-center gap-1.5"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  {isEditing ? 'Preview' : 'Edit Draft'}
                </button>
              </div>

              {/* Constraint warnings (amber — only if present) */}
              {draftData.constraintWarnings.length > 0 && (
                <div
                  role="alert"
                  className="bg-amber-50 border border-amber-200 rounded-lg p-3"
                >
                  <p className="text-[11px] text-amber-700 font-semibold uppercase tracking-wide mb-1">
                    ⚠ Constraint Warnings
                  </p>
                  {draftData.constraintWarnings.map((w) => (
                    <p key={w.code} className="text-xs text-amber-700">
                      [{w.code}] {w.message}
                    </p>
                  ))}
                </div>
              )}

              {/* Disclaimer — read-only, non-removable per D-32-08 */}
              <div
                className="bg-gray-100 rounded-lg border border-gray-300 p-3"
                aria-label="Non-removable WineOps AI disclaimer"
              >
                <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-1">
                  Auto-appended disclaimer (required)
                </p>
                <p className="text-xs text-gray-600 italic whitespace-pre-line">
                  {draftData.disclaimer}
                </p>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    onApprove(
                      editedContent !== draftData.draftContent ? editedContent : undefined,
                    )
                  }
                  disabled={isSubmitting}
                  aria-disabled={isSubmitting}
                  className="h-16 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-bold text-base rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-5 h-5" />
                  Send Draft
                </button>
                <button
                  type="button"
                  onClick={onDiscard}
                  disabled={isSubmitting}
                  aria-disabled={isSubmitting}
                  className="h-16 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold text-base rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"
                >
                  <XCircle className="w-5 h-5" />
                  Discard
                </button>
              </div>

              {/* Footer */}
              <div className="text-[10px] text-gray-400 text-center pt-1.5 border-t border-gray-200">
                ID: {draftData.conversationId.slice(-8)} &middot;{' '}
                {new Date(draftData.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
