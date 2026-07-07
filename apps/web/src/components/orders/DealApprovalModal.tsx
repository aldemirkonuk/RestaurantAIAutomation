import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, CheckCircle, XCircle, Pencil, MessageSquare, Loader2, Sparkles,
  AlertTriangle, ChevronDown, ShieldCheck, TrendingDown, TrendingUp,
} from 'lucide-react'
import type { DealProposalDto } from '../../hooks/queries/useDraftEmailQueries'
import { CommercialTermsPanel } from './CommercialTermsPanel'

interface DealApprovalModalProps {
  isOpen: boolean
  deal: DealProposalDto | null
  onConfirm: (finalPrice: number, quantity: number) => void
  onDismiss: () => void
  onAskForMore: () => void
  onClose: () => void
  isSubmitting?: boolean
}

export function DealApprovalModal({
  isOpen, deal, onConfirm, onDismiss, onAskForMore, onClose, isSubmitting,
}: DealApprovalModalProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [price, setPrice] = useState(0)
  const [qty, setQty] = useState(0)
  const [showSource, setShowSource] = useState(false)

  useEffect(() => {
    if (deal) { setPrice(deal.finalPrice); setQty(deal.quantity); setIsEditing(false); setShowSource(false) }
  }, [deal?.conversationId])

  if (!deal) return null

  const isVerify = deal.dealKind === 'verification'
  const title = isVerify ? 'Vendor confirmed — verify' : 'Offer — accept?'
  const belowTarget = deal.finalPrice <= deal.proposedPrice + 0.001
  const lowConfidence = (deal.confidence ?? 1) < 0.6
  const total = price * qty

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0, y: 16 }}
            transition={{ type: 'spring', damping: 26, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 overflow-hidden"
          >
            {/* Header */}
            <div className="bg-wine-700 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-wine-200" />
                    <span className="text-[10px] font-bold text-wine-200 uppercase tracking-widest">AI-detected deal</span>
                  </div>
                  <h2 className="text-lg font-bold text-white mt-1 leading-tight">{title}</h2>
                </div>
                <button type="button" onClick={onClose} aria-label="Close" className="text-white/70 hover:text-white p-1 -mr-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
              {deal.urgency === 'urgent' && (
                <span className="inline-flex items-center gap-1 mt-2 px-2 py-0.5 rounded-full bg-amber-400 text-amber-900 text-[10px] font-bold">
                  <AlertTriangle className="w-3 h-3" /> Time-sensitive
                </span>
              )}
            </div>

            <div className="bg-gray-50 p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Deal terms card */}
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-base font-bold text-gray-900 mb-3 leading-snug">{deal.wineName}</h3>
                {deal.commercialTerms && <CommercialTermsPanel terms={deal.commercialTerms} orderQty={qty} />}
                <div className="space-y-2 text-sm">
                  <Row label="Provider" value={deal.providerName} />
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">Quantity</span>
                    {isEditing ? (
                      <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-24 text-right text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-wine-200" />
                    ) : <span className="font-medium text-gray-900">{qty} bottles</span>}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500">{isVerify ? 'Price' : 'Agreed price'}</span>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400 text-sm">$</span>
                        <input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(Math.max(0, parseFloat(e.target.value) || 0))}
                          className="w-28 text-right text-sm border border-gray-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-wine-200" />
                      </div>
                    ) : <span className="font-bold text-wine-700">${price.toFixed(2)}/bottle</span>}
                  </div>
                  <Row label="Delivery" value={deal.deliveryEstimate} />
                  {deal.conditions && <Row label="Conditions" value={deal.conditions} />}
                  <div className="flex items-center justify-between pt-2 mt-1 border-t border-gray-100">
                    <span className="text-gray-500">Order total</span>
                    <span className="font-bold text-gray-900">${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {/* vs target */}
                {!isVerify && (
                  <div className={`mt-3 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg ${belowTarget ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                    {belowTarget ? <TrendingDown className="w-3.5 h-3.5" /> : <TrendingUp className="w-3.5 h-3.5" />}
                    {belowTarget
                      ? `At or under your $${deal.proposedPrice.toFixed(2)} target`
                      : `$${(deal.finalPrice - deal.proposedPrice).toFixed(2)}/bottle above your $${deal.proposedPrice.toFixed(2)} target`}
                  </div>
                )}
              </div>

              {/* Special conditions — non-standard terms the manager must notice */}
              {deal.specialConditions?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" /> Heads up — non-standard terms
                  </div>
                  <ul className="space-y-1">
                    {deal.specialConditions.map((c, i) => (
                      <li key={i} className="text-xs text-amber-800 flex gap-1.5">
                        <span aria-hidden>•</span><span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* What the vendor said + confidence (trust the extraction) */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button type="button" onClick={() => setShowSource(s => !s)} className="w-full flex items-center justify-between px-4 py-2.5 text-left">
                  <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">What the AI read</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${lowConfidence ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                      {Math.round((deal.confidence ?? 0) * 100)}% sure
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showSource ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                {showSource && (
                  <div className="px-4 pb-3 space-y-2">
                    {deal.conversationSummary && <p className="text-xs text-gray-600 leading-relaxed">{deal.conversationSummary}</p>}
                    {deal.sourceQuote && (
                      <blockquote className="text-xs text-gray-700 italic border-l-2 border-wine-300 pl-3 py-1 bg-gray-50 rounded-r">
                        “{deal.sourceQuote}”
                      </blockquote>
                    )}
                  </div>
                )}
                {lowConfidence && (
                  <div className="px-4 pb-3 flex items-center gap-1.5 text-[11px] text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5" /> Low confidence — please read the full email before confirming.
                  </div>
                )}
              </div>

              {/* Trust note */}
              <div className="flex items-center gap-2 text-[11px] text-gray-500 px-1">
                <ShieldCheck className={`w-3.5 h-3.5 ${deal.trust.eligible ? 'text-emerald-500' : 'text-gray-400'}`} />
                {deal.trust.eligible
                  ? `${deal.providerName} is a trusted vendor — clean deals can auto-confirm.`
                  : `New/unproven vendor (${deal.trust.completedOrders} completed orders) — you confirm every deal until trust is earned.`}
              </div>

              {/* Actions */}
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => onConfirm(price, qty)} disabled={isSubmitting}
                    className="h-14 bg-wine-700 hover:bg-wine-800 active:bg-wine-900 disabled:opacity-60 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2">
                    {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                    {isVerify ? 'Confirm order' : 'Accept & confirm'}
                  </button>
                  <button type="button" onClick={onDismiss} disabled={isSubmitting}
                    className="h-14 bg-white hover:bg-red-50 border border-gray-300 hover:border-red-200 text-gray-700 hover:text-red-600 font-semibold text-sm rounded-xl transition-colors flex items-center justify-center gap-2">
                    <XCircle className="w-5 h-5" /> Decline
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button type="button" onClick={() => setIsEditing(e => !e)}
                    className={`h-10 border rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${isEditing ? 'bg-wine-50 border-wine-200 text-wine-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    <Pencil className="w-3.5 h-3.5" /> {isEditing ? 'Editing terms' : 'Edit terms'}
                  </button>
                  <button type="button" onClick={onAskForMore} disabled={isSubmitting}
                    className="h-10 bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" /> Ask for more
                  </button>
                </div>
              </div>

              <div className="text-[10px] text-gray-400 text-center pt-1 border-t border-gray-200">
                ID: {deal.conversationId.slice(-8)} • {new Date(deal.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value}</span>
    </div>
  )
}
