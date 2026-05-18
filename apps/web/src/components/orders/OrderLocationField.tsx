import { useState } from 'react'
import { MapPin, Lock } from 'lucide-react'

/**
 * Order statuses that block location assignment (D-06 / D-07).
 * Must match the backend BLOCKED_STATUSES list in procurement.service.ts.
 */
const LOCATION_BLOCKED_STATUSES = ['PENDING', 'APPROVAL_NEEDED', 'NEGOTIATING', 'pending', 'pending_approval', 'negotiating']

interface OrderLocationFieldProps {
  orderId: string
  orderStatus: string
  currentLocationId?: string | null
  locationOptions?: Array<{ id: string; name: string }>
  onLocationChange?: (locationId: string) => void
  isUpdating?: boolean
}

/**
 * Location assignment control for an order.
 * Disabled with tooltip when order is in a pending/pre-approval state (D-07).
 * Backend enforces the same guard with HTTP 422 (D-06).
 */
export function OrderLocationField({
  orderId: _orderId,
  orderStatus,
  currentLocationId,
  locationOptions = [],
  onLocationChange,
  isUpdating = false,
}: OrderLocationFieldProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const isBlocked = LOCATION_BLOCKED_STATUSES.includes(orderStatus)

  return (
    <div className="relative flex items-center gap-2">
      <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <div
        className="relative flex-1"
        onMouseEnter={() => isBlocked && setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        <select
          value={currentLocationId ?? ''}
          onChange={(e) => onLocationChange?.(e.target.value)}
          disabled={isBlocked || isUpdating}
          aria-label="Assign delivery location"
          aria-describedby={isBlocked ? 'location-guard-tooltip' : undefined}
          className={`w-full text-sm rounded-lg border px-3 py-1.5 transition-colors ${
            isBlocked
              ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
              : 'bg-white border-gray-300 text-gray-700 hover:border-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500'
          }`}
        >
          <option value="">— No location assigned —</option>
          {locationOptions.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>

        {isBlocked && (
          <Lock className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        )}

        {/* Tooltip: "Available after order is approved" */}
        {showTooltip && isBlocked && (
          <div
            id="location-guard-tooltip"
            role="tooltip"
            className="absolute bottom-full left-0 mb-2 z-50 w-max max-w-xs rounded-lg bg-gray-800 px-3 py-2 text-xs text-white shadow-lg"
          >
            Available after order is approved
            <div className="absolute top-full left-4 border-4 border-transparent border-t-gray-800" />
          </div>
        )}
      </div>
    </div>
  )
}
