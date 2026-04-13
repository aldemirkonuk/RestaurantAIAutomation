/**
 * Reports Layout Types
 * Type definitions for layout management
 */

import { LucideIcon } from 'lucide-react'
import type { DashboardBlock, DashboardLayoutConfig } from '../../components/reports/dashboardTypes'

// ── Legacy types (kept for backward compatibility) ─────────────────────

export interface KPICard {
  id: string
  title: string
  key: string
  icon: LucideIcon
  visible: boolean
}

export interface ChartConfig {
  id: string
  title: string
  dataSource: string
  chartType: 'area' | 'bar' | 'line' | 'donut' | 'stacked-bar'
  size: 'small' | 'medium' | 'large' | 'full'
  visible: boolean
}

export interface SectionConfig {
  id: string
  type: 'aiInsights' | 'reportGenerator' | 'dailyBreakdown' | 'purchasedWines' | 'checkScanner'
  visible: boolean
  expanded: boolean
}

export interface LayoutConfig {
  kpiCards: KPICard[]
  charts: ChartConfig[]
  sections: SectionConfig[]
  version: number
}

export interface LayoutDiff {
  added: string[]
  removed: string[]
  moved: string[]
  resized: string[]
  toggled: string[]
}

// ── New dashboard layout types (re-exported for convenience) ───────────

export type { DashboardBlock, DashboardLayoutConfig }
