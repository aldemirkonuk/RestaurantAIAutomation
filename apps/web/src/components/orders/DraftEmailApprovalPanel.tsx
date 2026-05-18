import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, Edit2, Eye, X, Mail, Clock, Hash, Plus } from 'lucide-react'

interface ConstraintWarning {
  code: string
  message: string
  severity: 'annotating' | 'soft'
}

interface DraftEmailData {
  conversationId: string
  orderId: string
  orderNumber?: string
  restaurantName?: string
  wineName: string
  quantity?: number
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
  managerName?: string
  onApprove: (modifiedContent?: string, managerNotes?: string, ccEmails?: string[]) => void
  onDiscard: () => void
  onClose: () => void
  isSubmitting?: boolean
}

const emailTypeBadge: Record<
  DraftEmailData['emailType'],
  { label: string; bg: string; text: string; dot: string }
> = {
  PRICE_INQUIRY: { label: 'Price Inquiry', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-400' },
  DEMAND_OFFER: { label: 'Demand Offer', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-400' },
  PROMO_INQUIRY: { label: 'Promo Inquiry', bg: 'bg-purple-50', text: 'text-purple-700', dot: 'bg-purple-400' },
  WINE_INQUIRY: { label: 'Wine Inquiry', bg: 'bg-teal-50', text: 'text-teal-700', dot: 'bg-teal-400' },
}

function derivedSubject(data: DraftEmailData): string {
  const typeLabel = emailTypeBadge[data.emailType].label
  return `${data.wineName} — ${typeLabel}`
}

export function DraftEmailApprovalPanel({
  isOpen,
  draftData,
  managerName,
  onApprove,
  onDiscard,
  onClose,
  isSubmitting = false,
}: DraftEmailApprovalPanelProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [editedSubject, setEditedSubject] = useState('')
  const [ccEmails, setCcEmails] = useState<string[]>([])
  const [ccInput, setCcInput] = useState('')
  const ccInputRef = useRef<HTMLInputElement>(null)

  const resolveManagerName = (content: string) =>
    managerName ? content.replace(/\[Manager Name\]/g, managerName) : content

  useEffect(() => {
    if (draftData) {
      setEditedContent(resolveManagerName(draftData.draftContent))
      setEditedSubject(derivedSubject(draftData))
      setIsEditing(false)
      setCcEmails([])
      setCcInput('')
    }
  }, [draftData, managerName])

  const addCcEmail = (raw: string) => {
    const email = raw.trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return
    if (ccEmails.includes(email)) return
    setCcEmails((prev) => [...prev, email])
    setCcInput('')
  }

  const removeCcEmail = (email: string) =>
    setCcEmails((prev) => prev.filter((e) => e !== email))

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!draftData && !isOpen) return null

  const badge = draftData ? emailTypeBadge[draftData.emailType] : null
  const isDirty = draftData
    ? editedContent !== resolveManagerName(draftData.draftContent) || editedSubject !== derivedSubject(draftData)
    : false

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
            initial={{ scale: 0.96, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="draft-panel-title"
            className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl border border-indigo-200 overflow-hidden max-h-[92vh] flex flex-col"
          >
            {/* ── Top bar ── */}
            <div className="bg-indigo-900 px-5 py-4 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-indigo-300" aria-hidden="true" />
                <h2
                  id="draft-panel-title"
                  className="text-sm font-bold text-white uppercase tracking-widest"
                >
                  AI Draft Ready
                </h2>
                {badge && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${badge.bg} ${badge.text}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                    {badge.label}
                  </span>
                )}
                {isDirty && (
                  <span className="text-[10px] font-medium text-indigo-300 italic">
                    edited
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-indigo-300 hover:text-white transition-colors p-1 -mr-1"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── Two-panel body ── */}
            <div className="flex flex-1 min-h-0 overflow-hidden">

              {/* LEFT — meta strip */}
              <div className="w-52 flex-shrink-0 bg-gray-50 border-r border-gray-200 px-4 py-5 flex flex-col gap-5 overflow-y-auto">

                {/* From */}
                {draftData.restaurantName && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">From</p>
                    <p className="text-sm font-semibold text-gray-800 leading-tight">{draftData.restaurantName}</p>
                  </div>
                )}

                {/* To */}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">To</p>
                  <p className="text-sm font-semibold text-gray-800 leading-tight">{draftData.providerName}</p>
                  <p className="text-xs text-gray-500 truncate">{draftData.providerEmail}</p>
                </div>

                {/* CC */}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">CC</p>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {ccEmails.map((email) => (
                      <span
                        key={email}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-700 font-medium max-w-full"
                      >
                        <span className="truncate max-w-[100px]">{email}</span>
                        <button
                          type="button"
                          onClick={() => removeCcEmail(email)}
                          className="flex-shrink-0 text-indigo-400 hover:text-indigo-700 transition-colors"
                          aria-label={`Remove ${email}`}
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <input
                      ref={ccInputRef}
                      type="email"
                      value={ccInput}
                      onChange={(e) => setCcInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault()
                          addCcEmail(ccInput)
                        }
                      }}
                      placeholder="Add email…"
                      className="flex-1 min-w-0 text-[11px] text-gray-700 placeholder-gray-300 border border-gray-200 rounded-lg px-2 py-1 focus:ring-1 focus:ring-indigo-400 focus:border-indigo-400 outline-none bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => addCcEmail(ccInput)}
                      className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-600 transition-colors"
                      aria-label="Add CC email"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Wine */}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Wine</p>
                  <p className="text-sm text-gray-700 leading-snug">{draftData.wineName}</p>
                </div>

                {/* Quantity */}
                {draftData.quantity != null && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Quantity</p>
                    <p className="text-sm text-gray-700">{draftData.quantity} bottles</p>
                  </div>
                )}

                {/* Type */}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Type</p>
                  {badge && (
                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium ${badge.bg} ${badge.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                      {badge.label}
                    </span>
                  )}
                </div>

                {/* Round */}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Round</p>
                  <p className="text-sm text-gray-700">#{draftData.roundCount}</p>
                </div>

                {/* Order ref */}
                {draftData.orderNumber && (
                  <div>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Order</p>
                    <div className="flex items-center gap-1 text-xs text-gray-600">
                      <Hash className="w-3 h-3" />
                      {draftData.orderNumber}
                    </div>
                  </div>
                )}

                {/* Drafted at */}
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">Drafted</p>
                  <div className="flex items-center gap-1 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    {new Date(draftData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                {/* Spacer + discard */}
                <div className="mt-auto pt-4 border-t border-gray-200">
                  <button
                    type="button"
                    onClick={onDiscard}
                    disabled={isSubmitting}
                    className="w-full h-9 flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 text-xs font-semibold transition-all"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Discard
                  </button>
                </div>
              </div>

              {/* RIGHT — compose area */}
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

                {/* Subject row */}
                <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex-shrink-0">
                  <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-1">
                    Subject
                  </label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedSubject}
                      onChange={(e) => setEditedSubject(e.target.value)}
                      className="w-full text-sm font-medium text-gray-800 border border-gray-300 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      aria-label="Edit email subject"
                    />
                  ) : (
                    <p className="text-sm font-medium text-gray-800">{editedSubject}</p>
                  )}
                </div>

                {/* Body */}
                <div className="flex-1 min-h-0 px-5 py-4 overflow-y-auto">
                  {isEditing ? (
                    <textarea
                      value={editedContent}
                      onChange={(e) => setEditedContent(e.target.value)}
                      className="w-full h-full min-h-[180px] resize-none rounded-lg border border-gray-300 px-3 py-2.5 text-sm text-gray-700 leading-relaxed focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-sans"
                      aria-label="Edit draft email body"
                    />
                  ) : (
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                      {editedContent}
                    </pre>
                  )}
                </div>

                {/* Constraint warnings */}
                {draftData.constraintWarnings.length > 0 && (
                  <div
                    role="alert"
                    className="mx-5 mb-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex-shrink-0"
                  >
                    <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-1">
                      ⚠ Constraint Warnings
                    </p>
                    {draftData.constraintWarnings.map((w) => (
                      <p key={w.code} className="text-xs text-amber-700">
                        [{w.code}] {w.message}
                      </p>
                    ))}
                  </div>
                )}

                {/* Disclaimer — read-only, per D-32-08 */}
                <div
                  className="mx-5 mb-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 flex-shrink-0"
                  aria-label="Non-removable WineOps AI disclaimer"
                >
                  <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mb-0.5">
                    Auto-appended disclaimer (required · non-editable)
                  </p>
                  <p className="text-[11px] text-gray-500 italic leading-snug">
                    {draftData.disclaimer}
                  </p>
                </div>

                {/* Action bar */}
                <div className="px-5 pb-5 flex items-center gap-3 flex-shrink-0 border-t border-gray-100 pt-3">
                  {/* Edit / Preview toggle */}
                  <button
                    type="button"
                    onClick={() => setIsEditing(!isEditing)}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-xs font-medium text-gray-600 transition-all"
                  >
                    {isEditing ? (
                      <><Eye className="w-3.5 h-3.5" /> Preview</>
                    ) : (
                      <><Edit2 className="w-3.5 h-3.5" /> Edit</>
                    )}
                  </button>

                  {/* Spacer */}
                  <div className="flex-1" />

                  {/* Send */}
                  <button
                    type="button"
                    onClick={() =>
                      onApprove(
                        isDirty ? editedContent : undefined,
                        isDirty ? `Subject: ${editedSubject}` : undefined,
                        ccEmails.length ? ccEmails : undefined,
                      )
                    }
                    disabled={isSubmitting}
                    aria-disabled={isSubmitting}
                    className="flex items-center gap-2 h-11 px-6 bg-indigo-900 hover:bg-indigo-800 disabled:opacity-50 text-white font-bold text-sm rounded-xl shadow-lg shadow-indigo-900/20 transition-all"
                  >
                    <CheckCircle className="w-4 h-4" />
                    {isDirty ? 'Send Edited' : 'Send Draft'}
                  </button>
                </div>

                {/* Footer */}
                <p className="text-center text-[10px] text-gray-300 pb-2 flex-shrink-0">
                  ID {draftData.conversationId.slice(-8)}
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
