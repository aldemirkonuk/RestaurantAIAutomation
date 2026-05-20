'use client'
import { useState, useRef, useEffect } from 'react'
import { MapPin, ChevronDown, Loader2, X, Check } from 'lucide-react'
import type { StorageLocation } from '../../hooks/useStorageLocations'

interface LocationPickerCellProps {
  wineId: string
  quantity: number
  assignedQty?: number
  locations: StorageLocation[]
  currentLocation: StorageLocation | null
  onAssign: (locationId: string, quantity: number) => void
  onRemove: () => void
}

export function LocationPickerCell({
  wineId: _wineId,
  quantity,
  assignedQty,
  locations,
  currentLocation,
  onAssign,
  onRemove,
}: LocationPickerCellProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const isFull = (loc: StorageLocation) => loc.currentCount >= loc.capacity

  const handleAssign = (loc: StorageLocation) => {
    if (isFull(loc)) return
    setIsLoading(true)
    setIsOpen(false)
    onAssign(loc.id, quantity)
    setIsLoading(false)
  }

  const handleRemove = () => {
    setIsLoading(true)
    setIsOpen(false)
    onRemove()
    setIsLoading(false)
  }

  const unassigned = assignedQty != null ? quantity - assignedQty : null
  const tooltipText = assignedQty != null
    ? `${assignedQty} in ${currentLocation?.name ?? 'location'}${unassigned && unassigned > 0 ? ` · ${unassigned} unassigned` : ''} · ${quantity} total`
    : undefined

  return (
    <div ref={ref} className="relative">
      {isLoading ? (
        <div className="flex items-center gap-1.5 px-2.5 py-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
          <span className="text-xs text-gray-400">Saving...</span>
        </div>
      ) : currentLocation ? (
        <div className="flex flex-col gap-0.5">
          <button
            onClick={() => setIsOpen((o) => !o)}
            title={tooltipText}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-gray-200 shadow-sm hover:shadow-md transition-all max-w-full"
          >
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: currentLocation.color }}
            />
            <span className="truncate text-gray-700">{currentLocation.name}</span>
            {assignedQty != null && (
              <span className="font-semibold text-gray-500 flex-shrink-0">·{assignedQty}</span>
            )}
            <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
          </button>
          {unassigned != null && unassigned > 0 && (
            <span className="text-[10px] text-amber-600 font-medium px-1 flex items-center gap-0.5" title={`${unassigned} bottle${unassigned !== 1 ? 's' : ''} have no location assigned`}>
              <MapPin className="w-2.5 h-2.5" />{unassigned} unassigned
            </span>
          )}
        </div>
      ) : (
        <button
          onClick={() => setIsOpen((o) => !o)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-gray-400 border border-dashed border-gray-300 hover:border-gray-400 hover:text-gray-600 transition-all w-full"
        >
          <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Assign location</span>
        </button>
      )}

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px] bg-white rounded-lg shadow-xl border border-gray-100 max-h-60 overflow-y-auto">
          {locations.map((loc) => {
            const full = isFull(loc)
            const isSelected = loc.id === currentLocation?.id
            return (
              <button
                key={loc.id}
                disabled={full}
                onClick={() => handleAssign(loc)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left transition-colors ${
                  full
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-gray-50 cursor-pointer'
                } ${isSelected ? 'font-semibold bg-gray-50' : ''}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: loc.color }}
                  />
                  <span className="truncate text-gray-700">{loc.name}</span>
                  {isSelected && (
                    <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                  )}
                </span>
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-gray-400">
                    {loc.currentCount}/{loc.capacity}
                  </span>
                  {full && (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-600 font-medium">
                      Full
                    </span>
                  )}
                </span>
              </button>
            )
          })}

          {currentLocation && (
            <>
              <hr className="my-1 border-gray-100" />
              <button
                onClick={handleRemove}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 transition-colors"
              >
                <X className="w-3 h-3" />
                Remove assignment
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
