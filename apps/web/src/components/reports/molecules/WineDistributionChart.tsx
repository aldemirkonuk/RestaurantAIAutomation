/**
 * WineDistributionChart - Molecule Component
 * Donut chart with legend
 */

import { motion } from 'framer-motion'
import { DonutChart } from '@tremor/react'
import { ChartHeader } from '../atoms'
import { Card } from '../../ui'

interface WineTypeDistribution {
  name: string
  value: number
  color: string
}

interface WineDistributionChartProps {
  data: WineTypeDistribution[]
  isEditMode?: boolean
  onEdit?: () => void
  className?: string
}

export function WineDistributionChart({
  data,
  isEditMode = false,
  onEdit,
  className = '',
}: WineDistributionChartProps) {
  return (
    <motion.div
      className={`${isEditMode ? 'chart-edit-mode rounded-xl cursor-pointer' : ''} ${className}`}
      onClick={() => isEditMode && onEdit?.()}
      whileHover={isEditMode ? { scale: 1.01 } : {}}
    >
      <Card padding="md" className="h-full relative">
        <ChartHeader
          title="Wine Distribution"
          subtitle="By type"
          isEditMode={isEditMode}
          onEdit={onEdit}
          className="mb-4"
        />
        <DonutChart
          data={data}
          category="value"
          index="name"
          valueFormatter={(value) => `${value}%`}
          colors={['rose', 'amber', 'yellow', 'pink', 'violet']}
          className="h-52"
        />
        <div className="mt-4 grid grid-cols-2 gap-2">
          {data.map((type) => (
            <div key={type.name} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: type.color }} />
              <span className="text-sm font-medium text-gray-700">{type.name}</span>
              <span className="text-sm text-gray-500 ml-auto">{type.value}%</span>
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  )
}

export type { WineTypeDistribution }
