/**
 * Storage Location Manager Component
 * Allows managers to define and manage custom storage locations for wines
 */

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  MapPin,
  Plus,
  Edit3,
  Trash2,
  Check,
  FolderTree,
  Wine,
  Package,
  Thermometer,
  Save,
  AlertTriangle,
  Lock,
  Info,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useStorageLocations, useWinesAtLocation, DEFAULT_LOCATIONS } from '../../hooks/useStorageLocations'
import type { StorageLocation } from '../../hooks/useStorageLocations'
export type { StorageLocation }

interface StorageLocationManagerProps {
  isOpen: boolean
  onClose: () => void
  onSelectLocation?: (location: StorageLocation) => void
  onLocationsChange?: (locations: StorageLocation[]) => void
  selectedWineId?: string
  inventoryItems?: Array<{
    id: string
    name: string
    producer: string
    liveStock?: number
    storageLocation?: string
    location?: string
  }>
}

/** @deprecated Use the useStorageLocations hook instead */
export function loadStorageLocations(): StorageLocation[] {
  return DEFAULT_LOCATIONS
}

/** @deprecated Use the useStorageLocations hook instead */
export function saveStorageLocations(_locations: StorageLocation[]) {
  // no-op: persistence is handled by useStorageLocations via API
}

const DEFAULT_COLORS = [
  '#be123c', // Rose
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#3b82f6', // Blue
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#6366f1', // Indigo
  '#14b8a6', // Teal
]

export function StorageLocationManager({
  isOpen,
  onClose,
  onSelectLocation,
  onLocationsChange,
  selectedWineId,
  inventoryItems = [],
}: StorageLocationManagerProps) {
  const { locations, setLocations, getLocationsWithActualCounts } = useStorageLocations()
  const actualLocations = getLocationsWithActualCounts()
  const onLocationsChangeRef = useRef(onLocationsChange)
  onLocationsChangeRef.current = onLocationsChange
  const [expandedLocationId, setExpandedLocationId] = useState<string | null>(null)
  const { wines: expandedWines, isLoading: winesLoading } = useWinesAtLocation(expandedLocationId)
  const [editingLocation, setEditingLocation] = useState<StorageLocation | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [capacityWarning, setCapacityWarning] = useState<{
    show: boolean
    newCapacity: number
    currentCount: number
    overflow: number
  } | null>(null)
  const [formData, setFormData] = useState<Partial<StorageLocation>>({
    name: '',
    description: '',
    capacity: 100,
    currentCount: 0,
    temperature: '',
    humidity: '',
    notes: '',
    color: DEFAULT_COLORS[0],
  })

  useEffect(() => {
    onLocationsChangeRef.current?.(locations)
  }, [locations])

  const handleCreate = () => {
    if (!formData.name) return
    
    const newLocation: StorageLocation = {
      id: `loc-${Date.now()}`,
      name: formData.name,
      description: formData.description,
      capacity: formData.capacity || 100,
      currentCount: 0, // New locations always start at 0 (count managed via wine movements)
      temperature: formData.temperature,
      humidity: formData.humidity,
      notes: formData.notes,
      color: formData.color || DEFAULT_COLORS[0],
    }
    
    setLocations([...locations, newLocation])
    setIsCreating(false)
    resetForm()
  }

  const handleUpdate = (forceCapacity = false) => {
    if (!editingLocation || !formData.name) return

    const newCapacity = formData.capacity || editingLocation.capacity
    const currentCount = editingLocation.currentCount

    // Validate capacity change: warn if new capacity < current count
    if (!forceCapacity && newCapacity < currentCount) {
      setCapacityWarning({
        show: true,
        newCapacity,
        currentCount,
        overflow: currentCount - newCapacity,
      })
      return
    }
    
    // Preserve currentCount from the existing location (not editable via form)
    setLocations(locations.map(loc => 
      loc.id === editingLocation.id
        ? {
            ...loc,
            name: formData.name!,
            description: formData.description,
            capacity: newCapacity,
            currentCount: loc.currentCount, // Always preserve actual count
            temperature: formData.temperature,
            humidity: formData.humidity,
            notes: formData.notes,
            color: formData.color || loc.color,
          }
        : loc
    ))
    setEditingLocation(null)
    setCapacityWarning(null)
    resetForm()
  }

  const handleDelete = (id: string) => {
    if (confirm('Delete this storage location?')) {
      setLocations(locations.filter(loc => loc.id !== id))
    }
  }

  const startEdit = (location: StorageLocation) => {
    setEditingLocation(location)
    setFormData({
      name: location.name,
      description: location.description,
      capacity: location.capacity,
      currentCount: location.currentCount,
      temperature: location.temperature,
      humidity: location.humidity,
      notes: location.notes,
      color: location.color,
    })
    setIsCreating(false)
  }

  const startCreate = () => {
    setIsCreating(true)
    setEditingLocation(null)
    resetForm()
  }

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      capacity: 100,
      currentCount: 0,
      temperature: '',
      humidity: '',
      notes: '',
      color: DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)],
    })
  }

  const cancelEdit = () => {
    setEditingLocation(null)
    setIsCreating(false)
    resetForm()
  }

  const getLocationItems = (location: StorageLocation) => {
    return inventoryItems.filter(item => {
      const assigned = item.storageLocation || item.location || ''
      return assigned === location.id || assigned === location.name
    })
  }

  const locationItems = editingLocation ? getLocationItems(editingLocation) : []
  const locationItemTotal = locationItems.reduce((sum, item) => sum + (item.liveStock || 0), 0)
  const locationItemsSorted = [...locationItems].sort((a, b) => (b.liveStock || 0) - (a.liveStock || 0))

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
          className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b bg-gradient-to-r from-emerald-50 to-teal-50">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-600 rounded-xl">
                <MapPin className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Storage Locations</h2>
                <p className="text-sm text-gray-500">Manage wine storage areas</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/50 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex">
            {/* Locations List */}
            <div className="w-1/2 border-r border-gray-200 p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Your Locations</h3>
                <button
                  onClick={startCreate}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Location
                </button>
              </div>

              <div className="space-y-3">
                {actualLocations.map(location => (
                  <motion.div
                    key={location.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className={`p-4 rounded-xl border-2 transition-all cursor-pointer group ${
                      editingLocation?.id === location.id
                        ? 'border-emerald-500 bg-emerald-50 shadow-lg shadow-emerald-100'
                        : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 hover:shadow-md'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation() // Prevent modal from closing
                      // Always enter edit mode when clicking the card
                      startEdit(location)
                    }}
                    title="Click to edit location"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-4 h-4 rounded-full flex-shrink-0 mt-1"
                        style={{ backgroundColor: location.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-gray-900">{location.name}</h4>
                            {/* Visual indicator that card is clickable */}
                            {!onSelectLocation && (
                              <span className="text-xs text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                Click to edit
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {/* Removed Select button - selection happens automatically on card click if onSelectLocation exists */}
                            {/* Removed edit button - click anywhere on card to edit */}
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(location.id); }}
                              className="p-1.5 hover:bg-rose-100 rounded-lg transition-colors"
                              title="Delete location"
                            >
                              <Trash2 className="w-4 h-4 text-rose-500" />
                            </button>
                          </div>
                        </div>
                        {location.description && (
                          <p className="text-sm text-gray-500 mt-1">{location.description}</p>
                        )}
                        <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Package className="w-3.5 h-3.5" />
                            {location.currentCount}/{location.capacity}
                          </span>
                          {location.temperature && (
                            <span className="flex items-center gap-1">
                              <Thermometer className="w-3.5 h-3.5" />
                              {location.temperature}
                            </span>
                          )}
                        </div>
                        {/* Capacity bar */}
                        <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min((location.currentCount / location.capacity) * 100, 100)}%`,
                              backgroundColor: location.color,
                            }}
                          />
                        </div>

                        {/* Expand/collapse wine list toggle */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpandedLocationId(
                              expandedLocationId === location.id ? null : location.id,
                            )
                          }}
                          className="mt-2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                        >
                          {expandedLocationId === location.id ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                          <Wine className="w-3.5 h-3.5" />
                          <span>Wines stored here</span>
                        </button>

                        {/* Expanded wine list */}
                        {expandedLocationId === location.id && (
                          <div className="mt-2 border-t border-gray-100 pt-2">
                            {winesLoading ? (
                              <div className="flex items-center gap-1.5 text-xs text-gray-400 py-1">
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Loading wines…</span>
                              </div>
                            ) : expandedWines.length === 0 ? (
                              <p className="text-xs text-gray-400 italic py-1">No wines assigned</p>
                            ) : (
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {expandedWines.map((wine) => (
                                  <div
                                    key={wine.wineId}
                                    className="flex items-center justify-between"
                                  >
                                    <div className="min-w-0">
                                      <span className="text-xs font-medium text-gray-900 truncate block">
                                        {wine.wineName}
                                        {wine.vintage ? ` ${wine.vintage}` : ''}
                                      </span>
                                      {wine.producer && (
                                        <span className="text-xs text-gray-400 truncate block">
                                          {wine.producer}
                                        </span>
                                      )}
                                    </div>
                                    <span className="ml-2 flex-shrink-0 text-xs font-semibold text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: location.color }}>
                                      {wine.quantity}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}

                {locations.length === 0 && (
                  <div className="text-center py-8">
                    <FolderTree className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No storage locations defined</p>
                    <button
                      onClick={startCreate}
                      className="mt-2 text-emerald-600 hover:text-emerald-700 text-sm font-medium"
                    >
                      Create your first location
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Edit/Create Form */}
            <div className="w-1/2 p-6 bg-gray-50 overflow-y-auto">
              {(isCreating || editingLocation) ? (
                <div className="space-y-4">
                  <h3 className="font-semibold text-gray-900 mb-4">
                    {isCreating ? 'Create New Location' : 'Edit Location'}
                  </h3>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Location Name *
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Main Cellar"
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                      style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <input
                      type="text"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Brief description..."
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Capacity (bottles)
                      </label>
                      <input
                        type="number"
                        value={formData.capacity}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0
                          setFormData({ ...formData, capacity: val })
                          // Clear warning if capacity is now valid
                          if (capacityWarning && val >= capacityWarning.currentCount) {
                            setCapacityWarning(null)
                          }
                        }}
                        min={0}
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                        Current Count
                        <Lock className="w-3 h-3 text-gray-400" />
                      </label>
                      <div className="relative">
                        <input
                          type="number"
                          value={editingLocation?.currentCount ?? formData.currentCount ?? 0}
                          readOnly
                          disabled
                          className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
                          title="Count is managed automatically through wine movements"
                        />
                      </div>
                      <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                        <Info className="w-3 h-3" />
                        Updated via wine movements
                      </p>
                    </div>
                  </div>

                  {/* Capacity warning */}
                  {capacityWarning?.show && (
                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-amber-900">
                            Capacity Below Current Count
                          </p>
                          <p className="text-xs text-amber-700 mt-1">
                            This location has <strong>{capacityWarning.currentCount}</strong> bottles 
                            but you're setting capacity to <strong>{capacityWarning.newCapacity}</strong>.{' '}
                            <strong>{capacityWarning.overflow}</strong> bottle{capacityWarning.overflow !== 1 ? 's' : ''} would 
                            need to be relocated to another storage location.
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => setCapacityWarning(null)}
                              className="px-2 py-1 text-xs text-gray-600 bg-white border border-gray-200 rounded font-medium hover:bg-gray-50 transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleUpdate(true)}
                              className="px-2 py-1 text-xs text-amber-700 bg-amber-100 border border-amber-300 rounded font-medium hover:bg-amber-200 transition-colors"
                            >
                              Save Anyway
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Temperature
                      </label>
                      <input
                        type="text"
                        value={formData.temperature}
                        onChange={(e) => setFormData({ ...formData, temperature: e.target.value })}
                        placeholder="e.g., 55°F"
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Humidity
                      </label>
                      <input
                        type="text"
                        value={formData.humidity}
                        onChange={(e) => setFormData({ ...formData, humidity: e.target.value })}
                        placeholder="e.g., 70%"
                        className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Color
                    </label>
                    <div className="flex gap-2">
                      {DEFAULT_COLORS.map(color => (
                        <button
                          key={color}
                          onClick={() => setFormData({ ...formData, color })}
                          className={`w-8 h-8 rounded-full transition-transform ${
                            formData.color === color ? 'ring-2 ring-offset-2 ring-gray-900 scale-110' : 'hover:scale-105'
                          }`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Notes
                    </label>
                    <textarea
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Additional notes..."
                      rows={3}
                      className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none"
                      style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                    />
                  </div>

                  {editingLocation && (
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="text-sm font-semibold text-gray-900">Stored Wines</h4>
                          <p className="text-xs text-gray-500">
                            {locationItemTotal} bottles assigned to this location
                          </p>
                        </div>
                        <span className="text-xs font-medium text-gray-500">
                          Capacity: {editingLocation.capacity}
                        </span>
                      </div>

                      {locationItemsSorted.length > 0 ? (
                        <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                          {locationItemsSorted.map((item) => (
                            <div key={item.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-200">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                                <p className="text-xs text-gray-500 truncate">{item.producer}</p>
                              </div>
                              <span className="text-sm font-semibold text-gray-900">{item.liveStock || 0}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 bg-white rounded-lg px-3 py-2 border border-gray-200">
                          No wines assigned to this location yet.
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    <button
                      onClick={cancelEdit}
                      className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-gray-700 font-medium hover:bg-gray-100 transition-colors"
                    >
                      Cancel
                    </button>
                    {/* Show Select button if in selection mode */}
                    {onSelectLocation && editingLocation && !isCreating && (
                      <button
                        onClick={() => {
                          if (editingLocation) {
                            onSelectLocation(editingLocation)
                          }
                        }}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                      >
                        <Check className="w-4 h-4" />
                        Select
                      </button>
                    )}
                    <button
                      onClick={() => isCreating ? handleCreate() : handleUpdate()}
                      disabled={!formData.name}
                      className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      <Save className="w-4 h-4" />
                      {isCreating ? 'Create' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="p-4 bg-gray-200 rounded-full mb-4">
                    <MapPin className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-gray-500 mb-2">Select a location to edit</p>
                  <p className="text-sm text-gray-400">or create a new one</p>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between">
            <p className="text-sm text-gray-500">
              {locations.length} location{locations.length !== 1 ? 's' : ''} • 
              {' '}{actualLocations.reduce((sum, l) => sum + l.currentCount, 0)} bottles stored
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
