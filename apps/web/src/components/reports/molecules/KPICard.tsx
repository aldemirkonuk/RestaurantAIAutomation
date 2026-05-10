/**
 * KPICard - Molecule Component
 * Combines MetricDisplay + TrendIndicator + DragHandle
 */

import { X, Pencil, LucideIcon } from 'lucide-react'
import { MetricDisplay, TrendIndicator, DragHandle } from '../atoms'

interface KPICardData {
  id: string
  title: string
  key: string
  icon: LucideIcon
  visible: boolean
}

interface KPIValue {
  value: string | number
  change: number
  changeType: 'increase' | 'decrease'
}

interface KPICardProps {
  card: KPICardData
  value: KPIValue
  isEditMode?: boolean
  isDragging?: boolean
  onEdit?: () => void
  onDelete?: () => void
  onLongPressStart?: () => void
  onLongPressEnd?: () => void
  className?: string
}

export function KPICard({
  card,
  value,
  isEditMode = false,
  isDragging = false,
  onEdit,
  onDelete,
  onLongPressStart,
  onLongPressEnd,
  className = '',
}: KPICardProps) {
  const CardIcon = card.icon

  return (
    <div
      className={`relative bg-white rounded-xl shadow-sm border-2 p-5 transition-all ${
        isDragging ? 'select-none' : ''
      } ${
        isEditMode
          ? 'border-wine-300 shadow-wine-100 hover:border-wine-400'
          : 'border-gray-100 hover:shadow-md hover:border-gray-200'
      } ${className}`}
      onClick={() => isEditMode && onEdit?.()}
      onPointerDown={onLongPressStart}
      onPointerUp={onLongPressEnd}
      onPointerLeave={onLongPressEnd}
    >
      {/* Edit mode delete button */}
      {isEditMode && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="absolute -top-2 -left-2 w-6 h-6 bg-gray-800 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors z-10"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {isEditMode && onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="absolute top-2 right-2 px-2 py-1 bg-white border border-gray-200 text-gray-700 rounded-md text-xs flex items-center gap-1 shadow-sm hover:border-wine-300 hover:text-wine-700 transition-colors"
          title="Edit KPI card"
        >
          <Pencil className="w-3 h-3" />
          Edit
        </button>
      )}

      <div className="flex items-start justify-between">
        <div className="flex-1">
          <MetricDisplay value={value.value} label={card.title} />
          <TrendIndicator change={value.change} changeType={value.changeType} className="mt-2" />
        </div>
        <div className={`p-3 rounded-xl transition-colors ${isEditMode ? 'bg-wine-200' : 'bg-wine-100'}`}>
          {CardIcon && typeof CardIcon === 'function' && (
            <CardIcon className="w-5 h-5 text-wine-600" />
          )}
        </div>
      </div>

      {/* Drag handle indicator in edit mode */}
      <DragHandle isVisible={isEditMode} />
    </div>
  )
}

export type { KPICardData, KPIValue }
