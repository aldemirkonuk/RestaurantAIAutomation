import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Search, Loader2, Check, AlertCircle, Wine } from 'lucide-react'
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

interface ResearchedWine {
  name: string
  producer: string
  vintage?: number
  type: 'red' | 'white' | 'sparkling' | 'rose' | 'dessert'
  region: string
  country: string
  estimated_price: number
  grape: string
  confidence: 'low' | 'medium' | 'high'
  source: 'master_library' | 'gemini' | 'openai' | 'vivino'
}

interface AuctionPurchaseModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export function AuctionPurchaseModal({ isOpen, onClose, onSuccess }: AuctionPurchaseModalProps) {
  const [wineName, setWineName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [unitType, setUnitType] = useState<'case' | 'bottle'>('bottle')
  const [researching, setResearching] = useState(false)
  const [wineData, setWineData] = useState<ResearchedWine | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Auction details
  const [auctionHouse, setAuctionHouse] = useState('')
  const [lotNumber, setLotNumber] = useState('')
  const [auctionDate, setAuctionDate] = useState('')
  const [hammerPrice, setHammerPrice] = useState(0)
  const [buyersPremium, setBuyersPremium] = useState(0)

  const handleSearch = async () => {
    if (!wineName.trim()) {
      setError('Please enter a wine name')
      return
    }

    setResearching(true)
    setError(null)
    setWineData(null)

    try {
      const response = await axios.post(`${API_URL}/wines/research`, {
        wine_name: wineName
      })

      if (response.data.success) {
        setWineData(response.data.data)
      } else {
        setError(response.data.error || 'Wine not found')
      }
    } catch (err: any) {
      setError('Failed to research wine. Please try again.')
    } finally {
      setResearching(false)
    }
  }

  const handleAddAuctionPurchase = async () => {
    if (!wineData) return

    setSubmitting(true)
    setError(null)

    try {
      const totalCost = hammerPrice + buyersPremium

      await axios.post(`${API_URL}/wines/auction-purchase`, {
        wine_data: wineData,
        quantity,
        unit_type: unitType,
        auction_details: {
          auction_house: auctionHouse,
          lot_number: lotNumber,
          auction_date: auctionDate,
          hammer_price: hammerPrice,
          buyers_premium: buyersPremium,
          total_cost: totalCost
        }
      })

      onSuccess()
      handleClose()
    } catch (err: any) {
      setError('Failed to record auction purchase')
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setWineName('')
    setQuantity(1)
    setUnitType('bottle')
    setWineData(null)
    setError(null)
    setAuctionHouse('')
    setLotNumber('')
    setAuctionDate('')
    setHammerPrice(0)
    setBuyersPremium(0)
    onClose()
  }

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'bg-emerald-100 text-emerald-700'
      case 'medium': return 'bg-amber-100 text-amber-700'
      case 'low': return 'bg-red-100 text-red-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-purple-50 to-pink-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-600 rounded-xl">
                <Wine className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Record Auction Purchase</h2>
                <p className="text-sm text-gray-500">Add wine from auction to inventory</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Wine Search */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Wine Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={wineName}
                  onChange={(e) => setWineName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="Enter wine name (e.g., Dom Perignon 2012)"
                  className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  disabled={researching}
                />
                <button
                  onClick={handleSearch}
                  disabled={researching || !wineName.trim()}
                  className="px-6 py-2.5 bg-purple-600 text-white font-medium rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {researching ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Researching...
                    </>
                  ) : (
                    <>
                      <Search className="w-5 h-5" />
                      Search
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                AI will search master library and external sources
              </p>
            </div>

            {/* Error Display */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-900">Error</p>
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              </div>
            )}

            {/* Wine Details */}
            {wineData && (
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-5 border-2 border-purple-200">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{wineData.name}</h3>
                    <p className="text-sm text-gray-600">{wineData.producer}</p>
                  </div>
                  <div className="flex gap-2">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${getConfidenceColor(wineData.confidence)}`}>
                      {wineData.confidence} confidence
                    </span>
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded">
                      {wineData.source}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {wineData.vintage && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium">Vintage</p>
                      <p className="text-sm font-semibold text-gray-900">{wineData.vintage}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Type</p>
                    <p className="text-sm font-semibold text-gray-900 capitalize">{wineData.type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Region</p>
                    <p className="text-sm font-semibold text-gray-900">{wineData.region}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 font-medium">Est. Price</p>
                    <p className="text-sm font-semibold text-gray-900">${wineData.estimated_price}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Auction Details */}
            {wineData && (
              <>
                <div className="border-t pt-6">
                  <h4 className="font-semibold text-gray-900 mb-4">Auction Details</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Auction House</label>
                      <input
                        type="text"
                        value={auctionHouse}
                        onChange={(e) => setAuctionHouse(e.target.value)}
                        placeholder="e.g., Sotheby's"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Lot Number</label>
                      <input
                        type="text"
                        value={lotNumber}
                        onChange={(e) => setLotNumber(e.target.value)}
                        placeholder="e.g., LOT-123"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Auction Date</label>
                      <input
                        type="date"
                        value={auctionDate}
                        onChange={(e) => setAuctionDate(e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Hammer Price</label>
                      <input
                        type="number"
                        step="0.01"
                        value={hammerPrice}
                        onChange={(e) => setHammerPrice(parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Buyer's Premium</label>
                      <input
                        type="number"
                        step="0.01"
                        value={buyersPremium}
                        onChange={(e) => setBuyersPremium(parseFloat(e.target.value) || 0)}
                        placeholder="0.00"
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Total Cost</label>
                      <div className="px-4 py-2.5 border border-gray-300 rounded-lg bg-gray-50 font-semibold text-gray-900">
                        ${(hammerPrice + buyersPremium).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quantity & Unit Type */}
                <div className="border-t pt-6">
                  <h4 className="font-semibold text-gray-900 mb-4">Inventory Details</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
                      <input
                        type="number"
                        min="1"
                        value={quantity}
                        onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Unit Type</label>
                      <select
                        value={unitType}
                        onChange={(e) => setUnitType(e.target.value as 'case' | 'bottle')}
                        className="w-full px-4 py-2.5 border border-gray-300 rounded-lg"
                      >
                        <option value="bottle">Bottles</option>
                        <option value="case">Cases</option>
                      </select>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex gap-3 px-6 py-4 border-t bg-gray-50">
            <button
              onClick={handleAddAuctionPurchase}
              disabled={!wineData || submitting}
              className="flex-1 px-6 py-3 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Check className="w-5 h-5" />
                  Add to Inventory
                </>
              )}
            </button>
            <button
              onClick={handleClose}
              className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

