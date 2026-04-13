/**
 * OrdersByTypeChart - Molecule Component
 * Stacked bar visualization with expand/collapse
 */

import { motion } from 'framer-motion'
import { Maximize2, Minimize2 } from 'lucide-react'
import { ChartHeader, WineTypeBar, WineTypeData } from '../atoms'
import { Card } from '../../ui'

interface OrdersByTypeChartProps {
  data: Array<{
    date: string
    bottles: number
  } & WineTypeData>
  visible: number
  isExpanded: boolean
  isEditMode?: boolean
  onEdit?: () => void
  onExpand?: () => void
  onLoadMore?: () => void
  className?: string
}

export function OrdersByTypeChart({
  data,
  visible,
  isExpanded,
  isEditMode = false,
  onEdit,
  onExpand,
  onLoadMore,
  className = '',
}: OrdersByTypeChartProps) {
  const wineTypeTotals = data.reduce(
    (acc, day) => ({
      red: acc.red + day.red,
      white: acc.white + day.white,
      sparkling: acc.sparkling + day.sparkling,
      rose: acc.rose + day.rose,
      dessert: acc.dessert + day.dessert,
    }),
    { red: 0, white: 0, sparkling: 0, rose: 0, dessert: 0 }
  )

  return (
    <motion.div
      className={`${isExpanded ? 'lg:col-span-2' : ''} ${isEditMode ? 'chart-edit-mode rounded-xl cursor-pointer' : ''} ${className}`}
      onClick={() => isEditMode && onEdit?.()}
      whileHover={isEditMode ? { scale: 1.01 } : {}}
    >
      <Card padding="md" className="h-full relative">
        <ChartHeader
          title="Orders by Wine Type"
          subtitle={`Showing ${Math.min(visible, data.length)} of ${data.length} days`}
          isEditMode={isEditMode}
          onEdit={onEdit}
          className="mb-4"
        />

        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-2">
            {[
              { label: 'Red', color: 'bg-rose-600' },
              { label: 'White', color: 'bg-amber-400' },
              { label: 'Sparkling', color: 'bg-yellow-300' },
              { label: 'Rosé', color: 'bg-pink-400' },
              { label: 'Dessert', color: 'bg-purple-500' },
            ].map((type) => (
              <div key={type.label} className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded ${type.color}`} />
                <span className="text-[10px] text-gray-500">{type.label}</span>
              </div>
            ))}
          </div>
          {!isEditMode && onExpand && (
            <button
              onClick={onExpand}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? (
                <Minimize2 className="w-4 h-4 text-gray-500" />
              ) : (
                <Maximize2 className="w-4 h-4 text-gray-500" />
              )}
            </button>
          )}
        </div>

        <div className={`overflow-y-auto ${isExpanded ? 'max-h-[500px]' : 'max-h-[200px]'} space-y-2`}>
          {data.slice(0, visible).map((day) => (
            <div key={day.date} className="flex items-center gap-3 py-1">
              <span className="text-xs text-gray-500 w-16 shrink-0">{day.date}</span>
              <div className="flex-1">
                <WineTypeBar data={day} showLabels />
              </div>
              <span className="text-xs font-semibold text-gray-900 w-10 text-right">{day.bottles}</span>
            </div>
          ))}
        </div>

        {visible < data.length && onLoadMore && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <button
              onClick={onLoadMore}
              className="w-full py-2 text-sm font-medium text-wine-600 hover:text-wine-700 hover:bg-wine-50 rounded-lg transition-colors"
            >
              Load 20 more days ({data.length - visible} remaining)
            </button>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-2">Period Totals</p>
          <div className="flex gap-4 flex-wrap">
            {[
              { label: 'Red', value: wineTypeTotals.red, color: 'bg-rose-600' },
              { label: 'White', value: wineTypeTotals.white, color: 'bg-amber-400' },
              { label: 'Sparkling', value: wineTypeTotals.sparkling, color: 'bg-yellow-300' },
              { label: 'Rosé', value: wineTypeTotals.rose, color: 'bg-pink-400' },
              { label: 'Dessert', value: wineTypeTotals.dessert, color: 'bg-purple-500' },
            ].map((type) => (
              <div key={type.label} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 ${type.color} rounded`} />
                <span className="text-sm font-medium text-gray-900">{type.value}</span>
                <span className="text-xs text-gray-500">{type.label}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
