/**
 * DashboardBlock - Wrapper component for a single block in the dashboard grid.
 *
 * Responsibilities:
 * - Renders a Card shell with optional drag handle + hover toolbar
 * - Delegates inner rendering to the appropriate molecule (chart, KPI, or table)
 * - Manages the inline config popover state
 */

import { useState } from 'react'
import { GripVertical, Settings, Trash2, Eye, EyeOff } from 'lucide-react'
import { AreaChart, BarChart, DonutChart, LineChart } from '@tremor/react'
import { formatMoney, formatNumber } from '../../lib/utils'
import type { DashboardBlock as DashboardBlockType } from './dashboardTypes'
import { DATA_SOURCE_MAP, CHART_TYPE_MAP } from './dashboardMeta'
import { InlineBlockConfig } from './InlineBlockConfig'
import { KPIChartBlock } from './molecules/KPIChartBlock'
import { DataTableBlock, type TableColumn } from './molecules/DataTableBlock'
import type { KPIBlockData } from './molecules/KPIChartBlock'
import type { WineTypeDistribution, TopWine } from './molecules'

// ── Props ──────────────────────────────────────────────────────────────

interface DashboardBlockProps {
  block: DashboardBlockType
  isEditMode: boolean
  onUpdate: (updated: DashboardBlockType) => void
  onDelete: (id: string) => void
  // Data props (passed through from Reports page)
  salesData: Array<{ date: string; revenue: number; bottles: number; orders?: number; red?: number; white?: number; sparkling?: number; rose?: number; dessert?: number }>
  wineTypeDistribution: WineTypeDistribution[]
  topWines: TopWine[]
  timeRange: string
  getKPIValue: (key: string) => { value: string | number; change: number; changeType: 'increase' | 'decrease' }
  onKPIClick?: (kpiKey: string) => void
  spotlightedKPI?: string | null
}

// ── Table column definitions per data source ───────────────────────────

function getTableColumns(dataSource: string): TableColumn[] {
  switch (dataSource) {
    case 'revenue':
      return [
        { key: 'date', label: 'Date', format: 'text' },
        { key: 'revenue', label: 'Revenue', format: 'currency', align: 'right' },
      ]
    case 'orders':
      return [
        { key: 'date', label: 'Date', format: 'text' },
        { key: 'orders', label: 'Orders', format: 'number', align: 'right' },
      ]
    case 'bottles':
      return [
        { key: 'date', label: 'Date', format: 'text' },
        { key: 'bottles', label: 'Bottles', format: 'number', align: 'right' },
      ]
    case 'wineDistribution':
      return [
        { key: 'name', label: 'Wine Type', format: 'text' },
        { key: 'value', label: 'Percentage', format: 'percentage', align: 'right' },
      ]
    case 'topWines':
      return [
        { key: 'name', label: 'Wine', format: 'text' },
        { key: 'value', label: 'Revenue', format: 'currency', align: 'right' },
        { key: 'orders', label: 'Orders', format: 'number', align: 'right' },
      ]
    case 'ordersByType':
      return [
        { key: 'date', label: 'Date', format: 'text' },
        { key: 'red', label: 'Red', format: 'number', align: 'right' },
        { key: 'white', label: 'White', format: 'number', align: 'right' },
        { key: 'sparkling', label: 'Sparkling', format: 'number', align: 'right' },
        { key: 'rose', label: 'Rosé', format: 'number', align: 'right' },
        { key: 'dessert', label: 'Dessert', format: 'number', align: 'right' },
      ]
    case 'dailyBreakdown':
      return [
        { key: 'date', label: 'Date', format: 'text' },
        { key: 'revenue', label: 'Revenue', format: 'currency', align: 'right' },
        { key: 'orders', label: 'Orders', format: 'number', align: 'right' },
        { key: 'bottles', label: 'Bottles', format: 'number', align: 'right' },
      ]
    case 'purchaseCost':
      return [
        { key: 'date', label: 'Date', format: 'text' },
        { key: 'revenue', label: 'Cost', format: 'currency', align: 'right' },
      ]
    default:
      return [
        { key: 'date', label: 'Date', format: 'text' },
        { key: 'revenue', label: 'Value', format: 'currency', align: 'right' },
      ]
  }
}

function getTableRows(
  dataSource: string,
  salesData: DashboardBlockProps['salesData'],
  wineTypeDistribution: WineTypeDistribution[],
  topWines: TopWine[],
): Record<string, unknown>[] {
  switch (dataSource) {
    case 'wineDistribution':
      return wineTypeDistribution as unknown as Record<string, unknown>[]
    case 'topWines':
      return topWines as unknown as Record<string, unknown>[]
    default:
      return salesData as unknown as Record<string, unknown>[]
  }
}

// ── Chart rendering ────────────────────────────────────────────────────

function renderChart(
  block: DashboardBlockType,
  salesData: DashboardBlockProps['salesData'],
  wineTypeDistribution: WineTypeDistribution[],
  topWines: TopWine[],
) {
  const { chartType, dataSource } = block

  // Distribution data for donut
  if (chartType === 'donut') {
    if (!wineTypeDistribution.length) {
      return <EmptyState message="No distribution data" />
    }
    return (
      <DonutChart
        data={wineTypeDistribution}
        index="name"
        category="value"
        colors={['rose', 'amber', 'yellow', 'pink', 'purple']}
        className="h-full"
        showLabel
        showAnimation
      />
    )
  }

  // Bar chart for ranked data (topWines, providerPerformance)
  if (dataSource === 'topWines' || dataSource === 'providerPerformance') {
    if (!topWines.length) {
      return <EmptyState message="No data available yet" />
    }
    return (
      <BarChart
        data={topWines.map((w) => ({ name: w.name.length > 20 ? w.name.slice(0, 20) + '...' : w.name, Revenue: w.value }))}
        index="name"
        categories={['Revenue']}
        colors={['rose']}
        valueFormatter={(v) => formatMoney(v, 'compact')}
        className="h-full"
        showAnimation
        layout="vertical"
      />
    )
  }

  // Stacked bar for categorical data
  if (chartType === 'stacked-bar') {
    return (
      <BarChart
        data={salesData.map((d) => ({
          date: d.date,
          Red: d.red ?? 0,
          White: d.white ?? 0,
          Sparkling: d.sparkling ?? 0,
          Rosé: d.rose ?? 0,
          Dessert: d.dessert ?? 0,
        }))}
        index="date"
        categories={['Red', 'White', 'Sparkling', 'Rosé', 'Dessert']}
        colors={['rose', 'amber', 'yellow', 'pink', 'purple']}
        stack
        className="h-full"
        showAnimation
      />
    )
  }

  // Time-series data value key
  const valueKey = dataSource === 'orders' ? 'orders'
    : dataSource === 'bottles' ? 'bottles'
    : 'revenue'

  const data = salesData.map((d) => ({
    date: d.date,
    [valueKey]: (d as Record<string, unknown>)[valueKey] ?? 0,
  }))

  const valueFormatter = valueKey === 'revenue'
    ? (v: number) => formatMoney(v, 'compact')
    : (v: number) => formatNumber(v, 'compact')

  if (chartType === 'area') {
    return (
      <AreaChart
        data={data}
        index="date"
        categories={[valueKey]}
        colors={['rose']}
        valueFormatter={valueFormatter}
        showLegend={false}
        showGridLines
        showYAxis
        className="h-full"
        curveType="monotone"
        showAnimation
      />
    )
  }

  if (chartType === 'line') {
    return (
      <LineChart
        data={data}
        index="date"
        categories={[valueKey]}
        colors={['blue']}
        valueFormatter={valueFormatter}
        showLegend={false}
        showGridLines
        showYAxis
        className="h-full"
        curveType="monotone"
        showAnimation
      />
    )
  }

  // Default to bar
  return (
    <BarChart
      data={data}
      index="date"
      categories={[valueKey]}
      colors={['rose']}
      valueFormatter={valueFormatter}
      showLegend={false}
      className="h-full"
      showAnimation
    />
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center h-full text-sm text-gray-400">
      {message}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────

export function DashboardBlock({
  block,
  isEditMode,
  onUpdate,
  onDelete,
  salesData,
  wineTypeDistribution,
  topWines,
  timeRange: _timeRange,
  getKPIValue,
  onKPIClick,
  spotlightedKPI,
}: DashboardBlockProps) {
  const [showConfig, setShowConfig] = useState(false)
  const [isHovered, setIsHovered] = useState(false)

  const sourceMeta = DATA_SOURCE_MAP[block.dataSource]
  const chartMeta = CHART_TYPE_MAP[block.chartType]
  const SourceIcon = sourceMeta?.icon

  // Build KPI data from the getKPIValue function
  const kpiData: KPIBlockData | null = block.blockType === 'kpi'
    ? (() => {
        // Map data source to KPI key
        const kpiKeyMap: Record<string, string> = {
          revenue: 'revenue',
          orders: 'orders',
          bottles: 'bottles',
          profitMargin: 'profitMargin',
          purchaseCost: 'purchaseCost',
          inventoryValue: 'inventoryValue',
          salesTrend: 'revenue',
        }
        const kpiKey = kpiKeyMap[block.dataSource] || block.dataSource
        const val = getKPIValue(kpiKey)
        return {
          value: val.value,
          label: block.title,
          change: val.change,
          changeType: val.changeType,
          icon: sourceMeta?.icon,
          kpiKey,
        }
      })()
    : null

  const isOtherSpotlighted = spotlightedKPI && (!kpiData || kpiData.kpiKey !== spotlightedKPI)

  return (
    <div
      className={`relative h-full bg-white rounded-xl border overflow-hidden transition-all duration-300 ${
        isEditMode
          ? 'border-blue-200 shadow-sm hover:shadow-md hover:border-blue-300'
          : 'border-gray-200 shadow-sm hover:shadow-md'
      } ${isOtherSpotlighted ? 'opacity-30 blur-[2px] pointer-events-none' : ''}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false)
        // Don't close config on mouse leave if it's open
      }}
    >
      {/* Drag handle + block type badge (edit mode only) */}
      {isEditMode && (
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-2 py-1.5 bg-gradient-to-b from-white/95 to-white/0 pointer-events-none">
          <div className="flex items-center gap-1.5 pointer-events-auto">
            {/* Drag handle - has class "drag-handle" for react-grid-layout */}
            <div className="drag-handle cursor-grab active:cursor-grabbing p-1 rounded hover:bg-gray-100 transition-colors">
              <GripVertical className="w-4 h-4 text-gray-400" />
            </div>
            {/* Block info badge */}
            <div className="flex items-center gap-1 text-[10px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
              {SourceIcon && <SourceIcon className="w-3 h-3" />}
              <span>{block.blockType === 'chart' ? chartMeta?.title : block.blockType === 'kpi' ? 'KPI' : 'Table'}</span>
            </div>
          </div>

          {/* Action buttons (visible on hover) */}
          {isHovered && (
            <div className="flex items-center gap-0.5 pointer-events-auto">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowConfig(!showConfig)
                }}
                className="p-1 rounded hover:bg-blue-100 transition-colors"
                title="Configure"
              >
                <Settings className="w-3.5 h-3.5 text-blue-500" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onUpdate({ ...block, visible: !block.visible })
                }}
                className="p-1 rounded hover:bg-gray-100 transition-colors"
                title={block.visible ? 'Hide' : 'Show'}
              >
                {block.visible ? (
                  <Eye className="w-3.5 h-3.5 text-gray-400" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-gray-400" />
                )}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(block.id)
                }}
                className="p-1 rounded hover:bg-red-100 transition-colors"
                title="Remove"
              >
                <Trash2 className="w-3.5 h-3.5 text-red-400" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Block title (view mode) */}
      {!isEditMode && block.blockType !== 'kpi' && (
        <div className="px-4 pt-3 pb-1 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">{block.title}</h3>
        </div>
      )}

      {/* Chart title (edit mode, for non-KPI) */}
      {isEditMode && block.blockType !== 'kpi' && (
        <div className="px-4 pt-8 pb-1">
          <h3 className="text-sm font-semibold text-gray-700">{block.title}</h3>
        </div>
      )}

      {/* Content area */}
      <div className={`${block.blockType === 'kpi' ? (isEditMode ? 'pt-6' : '') : 'px-3 pb-3'} flex-1 h-[calc(100%-${block.blockType === 'kpi' ? '0px' : '40px'})]`}>
        {block.blockType === 'kpi' && kpiData ? (
          <KPIChartBlock
            data={kpiData}
            className="h-full"
            onClick={!isEditMode && onKPIClick && kpiData.kpiKey ? () => onKPIClick(kpiData.kpiKey!) : undefined}
            isSpotlighted={spotlightedKPI === kpiData.kpiKey}
          />
        ) : block.blockType === 'table' ? (
          <DataTableBlock
            columns={getTableColumns(block.dataSource)}
            rows={getTableRows(block.dataSource, salesData, wineTypeDistribution, topWines)}
            pageSize={6}
            className="h-full"
          />
        ) : (
          <div className="h-full min-h-[120px]">
            {renderChart(block, salesData, wineTypeDistribution, topWines)}
          </div>
        )}
      </div>

      {/* Inline config popover */}
      {isEditMode && showConfig && (
        <InlineBlockConfig
          block={block}
          onSave={(updated) => {
            onUpdate(updated)
            setShowConfig(false)
          }}
          onClose={() => setShowConfig(false)}
          onDelete={() => {
            onDelete(block.id)
            setShowConfig(false)
          }}
        />
      )}
    </div>
  )
}
