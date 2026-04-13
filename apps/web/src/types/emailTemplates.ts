/**
 * Email Template Types
 * Defines the structure for email templates used in GmailTemplateBuilder
 */

export type TemplateCategory = 'Inventory' | 'Financial' | 'Order' | 'Custom'

export type ChartType =
  | 'line'
  | 'bar'
  | 'area'
  | 'pie'
  | 'donut'
  | 'scatter'
  | 'bubble'
  | 'radar'
  | 'heatmap'
  | 'treemap'
  | 'funnel'
  | 'waterfall'
  | 'gauge'
  | 'radialBar'
  | 'boxPlot'
  | 'candlestick'
  | 'polarArea'
  | 'sankey'
  | 'sunburst'
  | 'histogram'
  | 'violin'
  | 'ridgeline'
  | 'streamgraph'
  | 'chord'
  | 'network'
  | 'calendar'
  | 'sparkline'

export type PanelType = 'shape' | 'chart' | 'table' | 'metric' | 'text' | 'image'

export interface FinancialMetric {
  id: string
  label: string
  value: number | string
  change?: number
  changeType?: 'positive' | 'negative' | 'neutral'
  trend?: 'up' | 'down' | 'flat'
  format?: 'currency' | 'percentage' | 'number'
  icon?: string
}

export interface ChartConfig {
  type: ChartType
  title: string
  data: any[]
  xAxis?: string
  yAxis?: string
  colors?: string[]
  legend?: boolean
  tooltips?: boolean
  animations?: boolean
}

export interface TableConfig {
  headers: string[]
  rows: any[][]
  striped?: boolean
  bordered?: boolean
  hoverable?: boolean
  compact?: boolean
}

export interface ShapeConfig {
  type: 'rectangle' | 'circle' | 'line' | 'arrow' | 'divider'
  width?: number | string
  height?: number | string
  color?: string
  borderColor?: string
  borderWidth?: number
  borderRadius?: number
  opacity?: number
}

export interface TextConfig {
  content: string
  fontSize?: number
  fontWeight?: 'normal' | 'bold' | 'light'
  fontStyle?: 'normal' | 'italic'
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  color?: string
  backgroundColor?: string
  padding?: number
}

export interface ImageConfig {
  url: string
  alt?: string
  width?: number | string
  height?: number | string
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down'
  borderRadius?: number
}

export interface TemplatePanel {
  id: string
  type: PanelType
  position: { x: number; y: number }
  size: { width: number; height: number }
  config:
    | ShapeConfig
    | ChartConfig
    | TableConfig
    | FinancialMetric
    | TextConfig
    | ImageConfig
  locked?: boolean
  visible?: boolean
}

export interface EmailTemplate {
  id: string
  name: string
  category: TemplateCategory
  description?: string
  subject: string
  to: string[]
  cc?: string[]
  bcc?: string[]
  panels: TemplatePanel[]
  backgroundColor?: string
  padding?: number
  maxWidth?: number
  createdAt: string
  updatedAt: string
  isDefault?: boolean
  scheduleRecurring?: {
    enabled: boolean
    frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly'
    dayOfWeek?: number // 0-6 for weekly
    dayOfMonth?: number // 1-31 for monthly
    time?: string // HH:MM
  }
}

export interface TemplateCategoryConfig {
  name: TemplateCategory
  icon: string
  color: string
  description: string
  defaultSubject?: string
  suggestedRecipients?: string[]
}

