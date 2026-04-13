/**
 * ChartsGrid - Organism Component
 * Responsive grid of chart components
 */

import { RevenueChart, WineDistributionChart, OrdersByTypeChart, TopWinesChart } from '../molecules'
import type { WineTypeDistribution, TopWine } from '../molecules'
import type { WineTypeData } from '../atoms'

interface ChartConfig {
  id: string
  title: string
  dataSource: string
  chartType: string
  size: string
  visible: boolean
}

interface ChartsGridProps {
  charts: ChartConfig[]
  salesData: Array<{
    date: string
    revenue: number
    bottles: number
  } & WineTypeData>
  wineTypeDistribution: WineTypeDistribution[]
  topWines: TopWine[]
  timeRange: string
  revenueChange: number
  wineTypeVisible: number
  wineTypeExpanded: boolean
  isEditMode: boolean
  onChartEdit: (chartId: string) => void
  onWineTypeExpand: () => void
  onLoadMoreWineTypes: () => void
  className?: string
}

export function ChartsGrid({
  charts,
  salesData,
  wineTypeDistribution,
  topWines,
  timeRange,
  revenueChange,
  wineTypeVisible,
  wineTypeExpanded,
  isEditMode,
  onChartEdit,
  onWineTypeExpand,
  onLoadMoreWineTypes,
  className = '',
}: ChartsGridProps) {
  const revenueChart = charts.find((c) => c.id === 'revenue-trend')
  const distributionChart = charts.find((c) => c.id === 'wine-distribution')
  const ordersByTypeChart = charts.find((c) => c.id === 'orders-by-type')
  const topWinesChart = charts.find((c) => c.id === 'top-wines')

  return (
    <div className={`space-y-6 ${className}`}>
      {/* PRIMARY CHARTS ROW - Revenue Trend (60%) + Wine Distribution (40%) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {revenueChart?.visible && (
          <div className="lg:col-span-3">
            <RevenueChart
              data={salesData}
              timeRange={timeRange}
              revenueChange={revenueChange}
              isEditMode={isEditMode}
              onEdit={() => onChartEdit('revenue-trend')}
            />
          </div>
        )}

        {distributionChart?.visible && (
          <div className="lg:col-span-2">
            <WineDistributionChart
              data={wineTypeDistribution}
              isEditMode={isEditMode}
              onEdit={() => onChartEdit('wine-distribution')}
            />
          </div>
        )}
      </div>

      {/* SECONDARY CHARTS ROW - Orders by Wine Type + Top Performing Wines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {ordersByTypeChart?.visible && (
          <OrdersByTypeChart
            data={salesData}
            visible={wineTypeVisible}
            isExpanded={wineTypeExpanded}
            isEditMode={isEditMode}
            onEdit={() => onChartEdit('orders-by-type')}
            onExpand={onWineTypeExpand}
            onLoadMore={onLoadMoreWineTypes}
          />
        )}

        {topWinesChart?.visible && !wineTypeExpanded && (
          <TopWinesChart
            wines={topWines}
            isEditMode={isEditMode}
            onEdit={() => onChartEdit('top-wines')}
          />
        )}
      </div>
    </div>
  )
}
