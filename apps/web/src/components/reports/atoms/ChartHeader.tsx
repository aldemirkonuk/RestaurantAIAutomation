/**
 * ChartHeader - Atomic Component
 * Reusable chart title + subtitle + badge
 */

import { Pencil } from 'lucide-react'
import { Badge } from '../../ui'

interface ChartHeaderProps {
  title: string
  subtitle?: string
  badge?: React.ReactNode
  isEditMode?: boolean
  onEdit?: () => void
  className?: string
}

export function ChartHeader({ 
  title, 
  subtitle, 
  badge, 
  isEditMode = false, 
  onEdit,
  className = '' 
}: ChartHeaderProps) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <div>
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">
        {badge}
        {isEditMode && onEdit && (
          <div className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full flex items-center gap-1">
            <Pencil className="w-3 h-3" />
            Click to edit
          </div>
        )}
      </div>
    </div>
  )
}
