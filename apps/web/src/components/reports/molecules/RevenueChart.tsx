/**
 * RevenueChart - Molecule Component
 * Revenue trend area chart with header
 */

import { motion } from 'framer-motion'
import { AreaChart } from '@tremor/react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { ChartHeader } from '../atoms'
import { Badge, Card } from '../../ui'

interface RevenueChartProps {
  data: Array<{
    date: string
    revenue: number
  }>
  timeRange: string
  revenueChange: number
  isEditMode?: boolean
  onEdit?: () => void
  className?: string
}

export function RevenueChart({
  data,
  timeRange,
  revenueChange,
  isEditMode = false,
  onEdit,
  className = '',
}: RevenueChartProps) {
  return (
    <motion.div
      className={`${isEditMode ? 'chart-edit-mode rounded-xl cursor-pointer' : ''} ${className}`}
      onClick={() => isEditMode && onEdit?.()}
      whileHover={isEditMode ? { scale: 1.01 } : {}}
    >
      <Card padding="md" className="h-full relative">
        <ChartHeader
          title="Revenue Trend"
          subtitle={`Last ${timeRange === '7d' ? '7 days' : timeRange === '30d' ? '30 days' : '90 days'}`}
          badge={
            <Badge variant={revenueChange >= 0 ? 'success' : 'destructive'}>
              {revenueChange >= 0 ? (
                <TrendingUp className="w-4 h-4 mr-1" />
              ) : (
                <TrendingDown className="w-4 h-4 mr-1" />
              )}
              {revenueChange >= 0 ? '+' : ''}
              {revenueChange}%
            </Badge>
          }
          isEditMode={isEditMode}
          onEdit={onEdit}
          className="mb-6"
        />
        <div className="pl-2">
          <AreaChart
            data={data}
            index="date"
            categories={['revenue']}
            colors={['rose']}
            valueFormatter={(value) => `$${value.toLocaleString()}`}
            showLegend={false}
            showGridLines={true}
            showYAxis={true}
            className="h-64"
            curveType="monotone"
            yAxisWidth={60}
          />
        </div>
      </Card>
    </motion.div>
  )
}
