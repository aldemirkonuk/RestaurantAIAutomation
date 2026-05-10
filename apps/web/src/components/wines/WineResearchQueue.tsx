/**
 * Wine Research Queue Component
 * Manages unknown wines that need AI-powered research
 * Integrates with Wine Library for automatic population
 */

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search,
  Sparkles,
  Wine,
  MapPin,
  Grape,
  Check,
  X,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Plus,
  Info,
  Lightbulb,
} from 'lucide-react'

// Research item interface
export interface WineResearchItem {
  id: string
  originalName: string
  status: 'pending' | 'researching' | 'found' | 'not_found' | 'confirmed' | 'rejected'
  source: 'menu_scan' | 'csv_import' | 'manual' | 'onboarding'
  createdAt: string
  researchedAt?: string
  
  // Research results
  results?: {
    name: string
    producer: string
    region: string
    country: string
    grape: string
    vintage?: string
    type: 'red' | 'white' | 'sparkling' | 'rosé' | 'dessert'
    description?: string
    averagePrice?: number
    confidence: number
    sources: string[]
  }
}

// Storage key
const STORAGE_KEY = 'wineops_research_queue'

// Load research queue from localStorage
function loadResearchQueue(): WineResearchItem[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

// Save research queue to localStorage
function saveResearchQueue(items: WineResearchItem[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

interface WineResearchQueueProps {
  isOpen: boolean
  onClose: () => void
  onAddToLibrary?: (wine: WineResearchItem) => void
}

export function WineResearchQueue({
  isOpen,
  onClose,
  onAddToLibrary,
}: WineResearchQueueProps) {
  const [items, setItems] = useState<WineResearchItem[]>(loadResearchQueue())
  const [selectedItem, setSelectedItem] = useState<WineResearchItem | null>(null)
  const [isResearching, setIsResearching] = useState(false)
  const [newWineName, setNewWineName] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)

  // Save to localStorage when items change
  useEffect(() => {
    saveResearchQueue(items)
  }, [items])

  // Simulate AI research
  const performResearch = useCallback(async (item: WineResearchItem) => {
    setIsResearching(true)
    
    // Update status to researching
    setItems(prev => prev.map(i => 
      i.id === item.id ? { ...i, status: 'researching' as const } : i
    ))

    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 1000))

    // Mock research results based on wine name
    const nameLower = item.originalName.toLowerCase()
    let results: WineResearchItem['results'] | undefined

    // Simulate finding results for some wines
    if (nameLower.includes('cabernet') || nameLower.includes('merlot') || nameLower.includes('pinot')) {
      results = {
        name: item.originalName,
        producer: 'Discovered Vineyard',
        region: nameLower.includes('napa') ? 'Napa Valley' : 'Sonoma County',
        country: 'USA',
        grape: nameLower.includes('cabernet') ? 'Cabernet Sauvignon' : nameLower.includes('merlot') ? 'Merlot' : 'Pinot Noir',
        type: 'red',
        description: 'A well-structured wine with notes of dark fruit and subtle oak.',
        averagePrice: 45 + Math.floor(Math.random() * 50),
        confidence: 75 + Math.floor(Math.random() * 20),
        sources: ['Wine Spectator', 'Vivino', 'Wine.com'],
      }
    } else if (nameLower.includes('chardonnay') || nameLower.includes('sauvignon')) {
      results = {
        name: item.originalName,
        producer: 'Estate Winery',
        region: 'California',
        country: 'USA',
        grape: nameLower.includes('chardonnay') ? 'Chardonnay' : 'Sauvignon Blanc',
        type: 'white',
        description: 'Crisp and refreshing with citrus and mineral notes.',
        averagePrice: 30 + Math.floor(Math.random() * 30),
        confidence: 70 + Math.floor(Math.random() * 25),
        sources: ['Wine Enthusiast', 'Decanter'],
      }
    } else if (nameLower.includes('champagne') || nameLower.includes('prosecco') || nameLower.includes('sparkling')) {
      results = {
        name: item.originalName,
        producer: 'Maison Bubbles',
        region: nameLower.includes('champagne') ? 'Champagne' : 'Veneto',
        country: nameLower.includes('champagne') ? 'France' : 'Italy',
        grape: 'Blend',
        type: 'sparkling',
        description: 'Elegant bubbles with fine mousse and toasty notes.',
        averagePrice: 50 + Math.floor(Math.random() * 100),
        confidence: 80 + Math.floor(Math.random() * 15),
        sources: ['Wine Spectator', 'James Suckling'],
      }
    }

    // Update item with results
    setItems(prev => prev.map(i => 
      i.id === item.id 
        ? { 
            ...i, 
            status: results ? 'found' as const : 'not_found' as const,
            researchedAt: new Date().toISOString(),
            results,
          } 
        : i
    ))

    setIsResearching(false)
  }, [])

  // Add new wine to research queue
  const addToQueue = useCallback(() => {
    if (!newWineName.trim()) return

    const newItem: WineResearchItem = {
      id: `research-${Date.now()}`,
      originalName: newWineName.trim(),
      status: 'pending',
      source: 'manual',
      createdAt: new Date().toISOString(),
    }

    setItems(prev => [...prev, newItem])
    setNewWineName('')
    setShowAddForm(false)
  }, [newWineName])

  // Confirm and add to library
  const confirmWine = useCallback((item: WineResearchItem) => {
    setItems(prev => prev.map(i => 
      i.id === item.id ? { ...i, status: 'confirmed' as const } : i
    ))
    onAddToLibrary?.(item)
  }, [onAddToLibrary])

  // Reject research result
  const rejectWine = useCallback((item: WineResearchItem) => {
    setItems(prev => prev.map(i => 
      i.id === item.id ? { ...i, status: 'rejected' as const } : i
    ))
  }, [])

  // Remove from queue
  const removeFromQueue = useCallback((id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
    if (selectedItem?.id === id) {
      setSelectedItem(null)
    }
  }, [selectedItem])

  // Research all pending items
  const researchAll = useCallback(async () => {
    const pendingItems = items.filter(i => i.status === 'pending')
    for (const item of pendingItems) {
      await performResearch(item)
    }
  }, [items, performResearch])

  const pendingCount = items.filter(i => i.status === 'pending').length
  const foundCount = items.filter(i => i.status === 'found').length

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-amber-50 to-orange-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-600 rounded-xl">
                <Search className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Wine Research Queue</h2>
                <p className="text-sm text-gray-500">
                  {pendingCount} pending • {foundCount} found
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <button
                  onClick={researchAll}
                  disabled={isResearching}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  {isResearching ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Research All
                </button>
              )}
              <button
                onClick={onClose}
                className="p-2 hover:bg-white/50 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex">
            {/* Queue List */}
            <div className="w-1/2 border-r border-gray-200 flex flex-col">
              <div className="p-4 border-b bg-gray-50">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Research Queue</h3>
                  <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-200 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Add Wine
                  </button>
                </div>

                {/* Add form */}
                <AnimatePresence>
                  {showAddForm && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="flex gap-2 mt-3">
                        <input
                          type="text"
                          value={newWineName}
                          onChange={(e) => setNewWineName(e.target.value)}
                          placeholder="Enter wine name..."
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                          onKeyDown={(e) => e.key === 'Enter' && addToQueue()}
                        />
                        <button
                          onClick={addToQueue}
                          disabled={!newWineName.trim()}
                          className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50"
                        >
                          Add
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {items.length === 0 ? (
                  <div className="text-center py-12">
                    <Wine className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No wines in research queue</p>
                    <p className="text-sm text-gray-400">Add unknown wines to research</p>
                  </div>
                ) : (
                  items.map(item => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        selectedItem?.id === item.id
                          ? 'border-amber-500 bg-amber-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                      onClick={() => setSelectedItem(item)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{item.originalName}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Added {new Date(item.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.status === 'pending' && (
                            <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-full text-xs">
                              Pending
                            </span>
                          )}
                          {item.status === 'researching' && (
                            <span className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Researching
                            </span>
                          )}
                          {item.status === 'found' && (
                            <span className="flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                              <Check className="w-3 h-3" />
                              Found
                            </span>
                          )}
                          {item.status === 'not_found' && (
                            <span className="flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-xs">
                              <AlertTriangle className="w-3 h-3" />
                              Not Found
                            </span>
                          )}
                          {item.status === 'confirmed' && (
                            <span className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs">
                              <Check className="w-3 h-3" />
                              Added
                            </span>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); removeFromQueue(item.id); }}
                            className="p-1 text-gray-400 hover:text-red-500"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>

            {/* Details Panel */}
            <div className="w-1/2 p-6 bg-gray-50 overflow-y-auto">
              {selectedItem ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-1">
                      {selectedItem.originalName}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Source: {selectedItem.source.replace('_', ' ')}
                    </p>
                  </div>

                  {selectedItem.status === 'pending' && (
                    <div className="bg-white rounded-xl p-6 border border-gray-200 text-center">
                      <Search className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-600 mb-4">Ready to research this wine</p>
                      <button
                        onClick={() => performResearch(selectedItem)}
                        disabled={isResearching}
                        className="px-6 py-3 bg-amber-600 text-white rounded-xl font-medium hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2 mx-auto"
                      >
                        {isResearching ? (
                          <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                          <Sparkles className="w-5 h-5" />
                        )}
                        Start AI Research
                      </button>
                    </div>
                  )}

                  {selectedItem.status === 'researching' && (
                    <div className="bg-white rounded-xl p-6 border border-blue-200 text-center">
                      <Loader2 className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
                      <p className="text-gray-600">Searching wine databases...</p>
                      <p className="text-sm text-gray-400 mt-2">This may take a few seconds</p>
                    </div>
                  )}

                  {selectedItem.status === 'found' && selectedItem.results && (
                    <>
                      <div className="bg-white rounded-xl p-6 border border-green-200">
                        <div className="flex items-center gap-2 mb-4">
                          <Lightbulb className="w-5 h-5 text-green-600" />
                          <span className="font-semibold text-green-700">
                            {selectedItem.results.confidence}% Match Confidence
                          </span>
                        </div>

                        <div className="space-y-4">
                          <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">Wine Name</label>
                            <p className="font-semibold text-gray-900">{selectedItem.results.name}</p>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-xs text-gray-500 uppercase tracking-wide">Producer</label>
                              <p className="text-gray-900">{selectedItem.results.producer}</p>
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 uppercase tracking-wide">Type</label>
                              <p className="text-gray-900 capitalize">{selectedItem.results.type}</p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-gray-400" />
                              <div>
                                <label className="text-xs text-gray-500 uppercase tracking-wide">Region</label>
                                <p className="text-gray-900">{selectedItem.results.region}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Globe className="w-4 h-4 text-gray-400" />
                              <div>
                                <label className="text-xs text-gray-500 uppercase tracking-wide">Country</label>
                                <p className="text-gray-900">{selectedItem.results.country}</p>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Grape className="w-4 h-4 text-gray-400" />
                            <div>
                              <label className="text-xs text-gray-500 uppercase tracking-wide">Grape</label>
                              <p className="text-gray-900">{selectedItem.results.grape}</p>
                            </div>
                          </div>

                          {selectedItem.results.description && (
                            <div>
                              <label className="text-xs text-gray-500 uppercase tracking-wide">Description</label>
                              <p className="text-gray-600 text-sm">{selectedItem.results.description}</p>
                            </div>
                          )}

                          {selectedItem.results.averagePrice && (
                            <div>
                              <label className="text-xs text-gray-500 uppercase tracking-wide">Avg. Price</label>
                              <p className="text-gray-900 font-semibold">${selectedItem.results.averagePrice}</p>
                            </div>
                          )}

                          <div>
                            <label className="text-xs text-gray-500 uppercase tracking-wide">Sources</label>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {selectedItem.results.sources.map(source => (
                                <span key={source} className="px-2 py-1 bg-gray-100 text-gray-600 rounded text-xs">
                                  {source}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-3">
                        <button
                          onClick={() => rejectWine(selectedItem)}
                          className="flex-1 px-4 py-3 border border-gray-200 rounded-xl text-gray-700 font-medium hover:bg-gray-100 transition-colors"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => confirmWine(selectedItem)}
                          className="flex-1 px-4 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                        >
                          <Check className="w-5 h-5" />
                          Add to Library
                        </button>
                      </div>
                    </>
                  )}

                  {selectedItem.status === 'not_found' && (
                    <div className="bg-white rounded-xl p-6 border border-amber-200 text-center">
                      <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                      <p className="text-gray-600 mb-2">Could not find this wine</p>
                      <p className="text-sm text-gray-400 mb-4">
                        Try adding more details or enter manually
                      </p>
                      <button
                        onClick={() => performResearch(selectedItem)}
                        className="px-4 py-2 border border-gray-200 rounded-lg text-gray-700 font-medium hover:bg-gray-50 flex items-center gap-2 mx-auto"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Try Again
                      </button>
                    </div>
                  )}

                  {selectedItem.status === 'confirmed' && (
                    <div className="bg-emerald-50 rounded-xl p-6 border border-emerald-200 text-center">
                      <Check className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
                      <p className="text-emerald-700 font-semibold">Added to Wine Library</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="p-4 bg-gray-200 rounded-full mb-4">
                    <Info className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-gray-500 mb-2">Select a wine to view details</p>
                  <p className="text-sm text-gray-400">or add a new wine to research</p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {items.length} wine{items.length !== 1 ? 's' : ''} in queue
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors"
            >
              Close
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default WineResearchQueue
