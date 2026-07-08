import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, XCircle, Edit2, MessageSquare, X, ChevronLeft, ChevronRight } from 'lucide-react'

interface CounterOffer {
  originalQuantity: number
  offeredQuantity: number
  originalPrice: number
  offeredPrice: number
  originalVintage: number | null
  offeredVintage: number | null
  notes: string  // AI-parsed provider notes
  providerMessage: string  // Raw provider response
  negotiationRound: number  // 1, 2, or 3
  priceDeviation: number  // Percentage difference
  availability: string  // 'in_stock', 'backorder', 'limited', 'unavailable'
  deliveryDays: number | null
  conditions: string
}

interface OrderApprovalData {
  orderId: string
  wineName: string
  quantity: number
  providerName: string
  proposedPrice: number
  finalPrice: number
  deliveryEstimate: string
  conversationSummary: string
  hasNegotiation?: boolean
  conversationId: string
  timestamp: string
  counterOffer?: CounterOffer
}

interface OrderApprovalModalProps {
  isOpen: boolean
  orderData: OrderApprovalData | null
  onConfirm: () => void
  onCancel: () => void
  onEdit: () => void
  onRequestMoreInfo: () => void
  onClose: () => void
  // Multi-provider pagination
  totalResponses?: number
  currentIndex?: number
  onNext?: () => void
  onPrevious?: () => void
}

export function OrderApprovalModal({
  isOpen,
  orderData,
  onConfirm,
  onCancel,
  onEdit,
  onRequestMoreInfo,
  onClose,
  totalResponses = 1,
  currentIndex = 0,
  onNext,
  onPrevious,
}: OrderApprovalModalProps) {
  const [_finalQuantity, _setFinalQuantity] = useState(
    orderData?.counterOffer?.offeredQuantity || orderData?.quantity || 0,
  )
  const [_finalPrice, _setFinalPrice] = useState(
    orderData?.counterOffer?.offeredPrice || orderData?.finalPrice || 0,
  )
  const [_acceptVintageSubstitution, _setAcceptVintageSubstitution] = useState(false)
  const [_managerNotes, _setManagerNotes] = useState('')

  if (!orderData) return null
  
  const hasMultipleResponses = totalResponses > 1
  const canGoPrevious = currentIndex > 0
  const canGoNext = currentIndex < totalResponses - 1
  
  // Debug logging
  console.log('OrderApprovalModal render:', {
    totalResponses,
    currentIndex,
    hasMultipleResponses,
    canGoPrevious,
    canGoNext,
    hasOnNext: !!onNext,
    hasOnPrevious: !!onPrevious,
    hasCounterOffer: !!orderData.counterOffer
  })

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
          onClick={onClose}
        >
          {/* Container for modal + navigation arrows */}
          <div className="relative">
            {/* Navigation Arrows for Multiple Providers - LARGE & PROMINENT */}
            {hasMultipleResponses && (
              <>
                {canGoPrevious && onPrevious && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      console.log('Previous button clicked!')
                      onPrevious()
                    }}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-24 z-10 w-20 h-20 bg-white hover:bg-gray-50 rounded-full flex items-center justify-center shadow-2xl transition-all hover:scale-110 border-4 border-gray-300"
                    aria-label="Previous response"
                  >
                    <ChevronLeft className="w-12 h-12 text-gray-800 stroke-[4]" />
                  </button>
                )}
                {canGoNext && onNext && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      console.log('Next button clicked!')
                      onNext()
                    }}
                    className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-24 z-10 w-20 h-20 bg-white hover:bg-gray-50 rounded-full flex items-center justify-center shadow-2xl transition-all hover:scale-110 border-4 border-gray-300"
                    aria-label="Next response"
                  >
                    <ChevronRight className="w-12 h-12 text-gray-800 stroke-[4]" />
                  </button>
                )}
              </>
            )}
            
            {/* Modal Content */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border-2 border-black overflow-hidden"
            >

            {/* Black Banner Header */}
            <div className="bg-black px-6 py-5 border-b-2 border-white">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h2 className="text-2xl font-black text-white uppercase tracking-wider">
                    ORDER APPROVAL
                  </h2>
                  {hasMultipleResponses && (
                    <div className="flex items-center gap-3 mt-2">
                      <p className="text-sm font-bold text-wine-400">
                        Response {currentIndex + 1} of {totalResponses}
                      </p>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: totalResponses }).map((_, idx) => (
                          <div
                            key={idx}
                            className={`h-2 w-2 rounded-full transition-all ${
                              idx === currentIndex 
                                ? 'bg-wine-500 w-6' 
                                : idx < currentIndex
                                ? 'bg-green-500'
                                : 'bg-gray-600'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="text-white hover:text-gray-300 transition-colors p-2 -mr-2"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* White Separator Line */}
            <div className="h-1 bg-white" />

            {/* Content Area - Reduced padding */}
            <div className="bg-gray-50 p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Order Summary */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-900 mb-2">{orderData.wineName}</h3>
                    <div className="space-y-1.5 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Provider:</span>
                        <span>{orderData.providerName}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Quantity:</span>
                        <span>{orderData.quantity} bottles</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Agreed Price:</span>
                        <span className="text-base font-bold text-wine-600">${orderData.finalPrice.toFixed(2)}/bottle</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Delivery:</span>
                        <span>{orderData.deliveryEstimate}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Conversation Summary — only visible after provider has replied */}
                {orderData.hasNegotiation && orderData.conversationSummary && (
                  <details className="mt-3 pt-3 border-t border-gray-200" open={!hasMultipleResponses}>
                    <summary className="text-sm font-semibold text-gray-700 cursor-pointer uppercase tracking-wide hover:text-wine-600">
                      Negotiation Summary {hasMultipleResponses && '(Click to expand)'}
                    </summary>
                    <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 leading-relaxed whitespace-pre-line mt-2 max-h-32 overflow-y-auto">
                      {orderData.conversationSummary}
                    </div>
                  </details>
                )}
              </div>

              {/* Action Buttons Grid - Compact */}
              <div className="space-y-2.5">
                {/* Primary Actions Row */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Confirm Button - Large Green */}
                  <button
                    onClick={onConfirm}
                    className="h-16 bg-green-500 hover:bg-green-600 active:bg-green-700 text-white font-bold text-base rounded-xl shadow-lg shadow-green-500/30 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <CheckCircle className="w-5 h-5" />
                    Confirm
                  </button>

                  {/* Cancel Button - Large Red */}
                  <button
                    onClick={onCancel}
                    className="h-16 bg-red-500 hover:bg-red-600 active:bg-red-700 text-white font-bold text-base rounded-xl shadow-lg shadow-red-500/30 transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <XCircle className="w-5 h-5" />
                    Cancel
                  </button>
                </div>

                {/* Secondary Actions Row */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Edit Order Button - Small Gray */}
                  <button
                    onClick={onEdit}
                    className="h-11 bg-gray-700 hover:bg-gray-800 active:bg-gray-900 text-white font-medium text-sm rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-1.5"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Edit Order
                  </button>

                  {/* Ask for More Button - Small Gray */}
                  <button
                    onClick={onRequestMoreInfo}
                    className="h-11 bg-gray-700 hover:bg-gray-800 active:bg-gray-900 text-white font-medium text-sm rounded-xl transition-all transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-1.5"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Ask for more
                  </button>
                </div>
              </div>

              {/* Footer Info */}
              <div className="text-[10px] text-gray-400 text-center pt-1.5 border-t border-gray-200">
                ID: {orderData.conversationId.slice(-8)} • {new Date(orderData.timestamp).toLocaleTimeString()}
              </div>
            </div>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

