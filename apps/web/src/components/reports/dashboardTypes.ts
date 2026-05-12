/**
 * Dashboard Block Types
 * Shared type definitions for the Notion-style dashboard grid system.
 */

import type { LucideIcon } from 'lucide-react'

// ── Block & Chart type unions ──────────────────────────────────────────

export type BlockType = 'chart' | 'kpi' | 'table'

export type ChartType = 'area' | 'line' | 'bar' | 'donut' | 'stacked-bar' | 'heatmap' | 'labor-overlay' | 'funnel' | 'channel-donut'

export type DataSource =
  | 'revenue'
  | 'orders'
  | 'bottles'
  | 'wineDistribution'
  | 'topWines'
  | 'purchaseCost'
  | 'profitMargin'
  | 'inventoryValue'
  | 'ordersByType'
  | 'dailyBreakdown'
  | 'providerPerformance'
  | 'salesTrend'
  | 'busyHours'
  | 'channelMix'
  | 'laborRevenue'
  | 'orderFunnel'

// ── Dashboard block ────────────────────────────────────────────────────

export interface DashboardBlock {
  /** Unique block identifier */
  id: string
  /** User-visible title */
  title: string
  /** Determines render strategy */
  blockType: BlockType
  /** Which data feeds this block */
  dataSource: DataSource
  /** Visual representation (only applies when blockType === 'chart') */
  chartType: ChartType
  /** react-grid-layout position & size */
  layout: { x: number; y: number; w: number; h: number; minW?: number; minH?: number }
  /** Visibility toggle */
  visible: boolean
  /** Block-specific configuration (KPI format, table page size, etc.) */
  config?: Record<string, unknown>
}

// ── Data source metadata ───────────────────────────────────────────────

export interface DataSourceMeta {
  key: DataSource
  title: string
  icon: LucideIcon
  description: string
  /** Which chart types work with this data source */
  compatibleChartTypes: ChartType[]
  /** Whether this source can render as a KPI card */
  supportsKPI: boolean
  /** Whether this source can render as a table */
  supportsTable: boolean
  /** Category for grouping in the UI */
  category: 'time-series' | 'distribution' | 'ranked' | 'categorical'
}

export interface ChartTypeMeta {
  key: ChartType
  title: string
  icon: LucideIcon
  description: string
}

// ── Layout presets ─────────────────────────────────────────────────────

export interface LayoutPreset {
  id: string
  name: string
  icon: LucideIcon
  description: string
  blocks: DashboardBlock[]
}

// ── Persisted layout ───────────────────────────────────────────────────

export interface DashboardLayoutConfig {
  blocks: DashboardBlock[]
  version: number
}
