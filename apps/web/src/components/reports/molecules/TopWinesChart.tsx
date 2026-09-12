/**
 * TopWinesChart - Molecule Component
 * Ranked list with wine type bars
 */

import { motion } from 'framer-motion'
import { ChartHeader, WineTypeBar } from '../atoms'
import { Badge, Card } from '../../ui'

interface TopWine {
  name: string
  value: number
  orders: number
  red: number
  white: number
  sparkling: number
  rose: number
  dessert: number
}

interface TopWinesChartProps {
  wines: TopWine[]
  isEditMode?: boolean
  onEdit?: () => void
  className?: string
}

export function TopWinesChart({
  wines,
  isEditMode = false,
  onEdit,
  className = '',
}: TopWinesChartProps) {
  return (
    <motion.div
      className={`${isEditMode ? 'chart-edit-mode rounded-xl cursor-pointer' : ''} ${className}`}
      onClick={() => isEditMode && onEdit?.()}
      whileHover={isEditMode ? { scale: 1.01 } : {}}
    >
      <Card padding="md" className="h-full relative">
        <ChartHeader
          title="Top Performing Wines"
          subtitle="By purchase spend with type breakdown"
          isEditMode={isEditMode}
          onEdit={onEdit}
          className="mb-6"
        />
        <div className="space-y-4">
          {wines.map((wine, index) => (
            <motion.div
              key={wine.name}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="flex items-center gap-4"
            >
              <div className="flex items-center justify-center w-8 h-8 bg-wine-100 rounded-lg font-bold text-wine-600">
                #{index + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <p className="font-medium text-gray-900 text-sm truncate">{wine.name}</p>
                  <p className="text-sm font-semibold text-wine-600">
                    ${wine.value.toLocaleString()}
                  </p>
                </div>
                <WineTypeBar data={wine} />
              </div>
              <Badge variant="secondary">{wine.orders}</Badge>
            </motion.div>
          ))}
        </div>
      </Card>
    </motion.div>
  )
}

export type { TopWine }
