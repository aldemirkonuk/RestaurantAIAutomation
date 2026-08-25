/**
 * ReportGenerator — catalogue of the report templates the platform plans to
 * produce. Generation itself is NOT available, and the UI says so.
 *
 * Why it is not wired: `POST /reports/generate` exists
 * (apps/api-gateway/src/reports/reports.service.ts) but it only inserts a
 * `generated_reports` row with `status: "pending"` and NULL `pdf_url` /
 * `excel_url` / `csv_url`. Nothing in the repo — gateway, agent-orchestrator or
 * a scheduled job — ever renders a file or advances that status, so a wired
 * button would fill the archive with rows that can never be opened.
 *
 * What used to be here was worse than an unwired button: `handleGenerate`
 * simulated the whole thing client-side — a 2.5s wait, a status flipped to
 * "ready", a file size from `Math.random()`, and a Download button that popped
 * an alert. The user was told a report existed when no report had been created.
 */

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  ChevronDown,
  ChevronUp,
  Check,
  BarChart3,
  TrendingUp,
  DollarSign,
  Package,
  Users,
  Sparkles,
  List,
  Info,
  Settings,
} from 'lucide-react'

interface ReportTemplate {
  id: string
  name: string
  description: string
  category: 'financial' | 'inventory' | 'sales' | 'operations'
  sections: string[]
  charts: string[]
  estimatedPages: number
  icon: React.ElementType
}

const reportTemplates: ReportTemplate[] = [
  {
    id: 'weekly-summary',
    name: 'Weekly Summary Report',
    description: 'Comprehensive weekly overview of sales, inventory, and key metrics',
    category: 'operations',
    sections: ['Executive Summary', 'Sales Overview', 'Inventory Status', 'Top Performers', 'AI Insights'],
    charts: ['Revenue Trend', 'Wine Distribution', 'Daily Breakdown'],
    estimatedPages: 5,
    icon: BarChart3,
  },
  {
    id: 'monthly-financial',
    name: 'Monthly Financial Report',
    description: 'Detailed financial analysis with profit margins and cost breakdown',
    category: 'financial',
    sections: ['Financial Summary', 'Revenue Analysis', 'Cost Breakdown', 'Profit Margins', 'Forecasts'],
    charts: ['Revenue vs Costs', 'Margin Trends', 'Category Performance'],
    estimatedPages: 8,
    icon: DollarSign,
  },
  {
    id: 'inventory-audit',
    name: 'Inventory Audit Report',
    description: 'Complete inventory status with stock levels and reorder recommendations',
    category: 'inventory',
    sections: ['Stock Summary', 'Low Stock Alerts', 'Category Breakdown', 'Valuation', 'Recommendations'],
    charts: ['Stock Levels', 'Category Distribution', 'Value by Type'],
    estimatedPages: 6,
    icon: Package,
  },
  {
    id: 'sales-performance',
    name: 'Sales Performance Report',
    description: 'Sales analysis by wine type, time period, and customer segments',
    category: 'sales',
    sections: ['Sales Summary', 'Top Sellers', 'Time Analysis', 'Category Performance', 'Trends'],
    charts: ['Sales by Type', 'Daily/Weekly Trends', 'Top 10 Wines'],
    estimatedPages: 7,
    icon: TrendingUp,
  },
  {
    id: 'provider-analysis',
    name: 'Provider Analysis Report',
    description: 'Supplier performance, pricing trends, and order history',
    category: 'operations',
    sections: ['Provider Overview', 'Order History', 'Pricing Analysis', 'Performance Metrics', 'Recommendations'],
    charts: ['Orders by Provider', 'Price Trends', 'Delivery Performance'],
    estimatedPages: 5,
    icon: Users,
  },
]

const categoryColors = {
  financial: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  inventory: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  sales: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  operations: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
}

interface ReportGeneratorProps {
  /** Daily PURCHASE-order rows (vendor spend), not POS sales. */
  purchaseDayData?: any[]
  metrics?: any
}

interface ReportOptions {
  format: 'pdf' | 'excel' | 'html'
  dateRange: 'week' | 'month' | 'quarter' | 'year' | 'custom'
  includeCharts: boolean
  includeAIInsights: boolean
  colorScheme: 'default' | 'dark' | 'minimal'
  pageSize: 'letter' | 'a4'
}

export function ReportGenerator({ purchaseDayData: _purchaseDayData, metrics: _metrics }: ReportGeneratorProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [showOptions, setShowOptions] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  
  const [options, setOptions] = useState<ReportOptions>({
    format: 'pdf',
    dateRange: 'month',
    includeCharts: true,
    includeAIInsights: true,
    colorScheme: 'default',
    pageSize: 'letter',
  })

  const filteredTemplates = useMemo(() => {
    if (categoryFilter === 'all') return reportTemplates
    return reportTemplates.filter(t => t.category === categoryFilter)
  }, [categoryFilter])

  const selectedTemplateData = selectedTemplate
    ? reportTemplates.find(t => t.id === selectedTemplate) 
    : null

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-gray-200 bg-gradient-to-r from-purple-50 via-indigo-50 to-blue-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl shadow-lg shadow-purple-600/30">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-gray-900">Report Generator</h2>
                <span className="px-2 py-0.5 bg-gray-200 text-gray-700 text-xs font-bold rounded-full flex items-center gap-1">
                  Not available yet
                </span>
              </div>
              <p className="text-sm text-gray-600">
                Preview of the report templates being built. File generation is not
                live yet.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowOptions(!showOptions)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              showOptions
                ? 'bg-purple-100 text-purple-700'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span className="text-sm font-medium">Options</span>
            {showOptions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {/* Options Panel */}
        <AnimatePresence>
          {showOptions && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-4 pt-4 border-t border-purple-100 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {/* Format */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Format</label>
                  <select
                    value={options.format}
                    onChange={(e) => setOptions({ ...options, format: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="pdf">PDF Document</option>
                    <option value="excel">Excel Spreadsheet</option>
                    <option value="html">HTML Report</option>
                  </select>
                </div>

                {/* Date Range */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Date Range</label>
                  <select
                    value={options.dateRange}
                    onChange={(e) => setOptions({ ...options, dateRange: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="week">Last 7 Days</option>
                    <option value="month">Last 30 Days</option>
                    <option value="quarter">Last Quarter</option>
                    <option value="year">Last Year</option>
                  </select>
                </div>

                {/* Color Scheme */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Color Scheme</label>
                  <select
                    value={options.colorScheme}
                    onChange={(e) => setOptions({ ...options, colorScheme: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="default">Default (Wine Theme)</option>
                    <option value="dark">Dark Mode</option>
                    <option value="minimal">Minimal</option>
                  </select>
                </div>

                {/* Page Size */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Page Size</label>
                  <select
                    value={options.pageSize}
                    onChange={(e) => setOptions({ ...options, pageSize: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="letter">US Letter</option>
                    <option value="a4">A4</option>
                  </select>
                </div>

                {/* Include Charts */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Include Charts</label>
                  <button
                    onClick={() => setOptions({ ...options, includeCharts: !options.includeCharts })}
                    className={`w-full px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
                      options.includeCharts
                        ? 'bg-purple-100 border-purple-200 text-purple-700'
                        : 'bg-gray-50 border-gray-200 text-gray-500'
                    }`}
                  >
                    {options.includeCharts ? '✓ Yes' : '✗ No'}
                  </button>
                </div>

                {/* Include AI Insights */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">AI Insights</label>
                  <button
                    onClick={() => setOptions({ ...options, includeAIInsights: !options.includeAIInsights })}
                    className={`w-full px-3 py-2 border rounded-lg text-sm font-medium transition-colors ${
                      options.includeAIInsights
                        ? 'bg-purple-100 border-purple-200 text-purple-700'
                        : 'bg-gray-50 border-gray-200 text-gray-500'
                    }`}
                  >
                    {options.includeAIInsights ? '✓ Yes' : '✗ No'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="p-5">
        {/* Stated once, up front — before the user picks a template and looks
            for a button that will not work. */}
        <div className="mb-4 flex items-start gap-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-600 leading-relaxed">
            Report file generation is not available yet — nothing here produces a
            PDF, spreadsheet or download. The templates below are a preview of what
            is being built. For figures you can use today, see the KPIs and insights
            on this page.
          </p>
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-medium text-gray-600">Filter:</span>
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
            {['all', 'financial', 'inventory', 'sales', 'operations'].map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                  categoryFilter === cat
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Template Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {filteredTemplates.map((template) => {
            const colors = categoryColors[template.category]
            const TemplateIcon = template.icon
            const isSelected = selectedTemplate === template.id

            return (
              <motion.button
                key={template.id}
                onClick={() => setSelectedTemplate(isSelected ? null : template.id)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  isSelected
                    ? 'border-purple-500 bg-purple-50 shadow-lg shadow-purple-500/20'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-md'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2 ${colors.bg} rounded-lg`}>
                    <TemplateIcon className={`w-5 h-5 ${colors.text}`} />
                  </div>
                  {isSelected && (
                    <div className="p-1 bg-purple-600 rounded-full">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>

                <h3 className="font-semibold text-gray-900 mb-1">{template.name}</h3>
                <p className="text-sm text-gray-500 mb-3 line-clamp-2">{template.description}</p>

                <div className="flex items-center justify-between">
                  <span className={`px-2 py-0.5 ${colors.bg} ${colors.text} text-xs font-medium rounded capitalize`}>
                    {template.category}
                  </span>
                  <span className="text-xs text-gray-400">
                    ~{template.estimatedPages} pages
                  </span>
                </div>
              </motion.button>
            )
          })}
        </div>

        {/* Selected Template Preview */}
        <AnimatePresence>
          {selectedTemplateData && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-gradient-to-br from-gray-50 to-purple-50/30 rounded-xl border border-gray-200 p-5 mb-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">{selectedTemplateData.name}</h3>
                  <p className="text-sm text-gray-600">{selectedTemplateData.description}</p>
                </div>
                <button
                  disabled
                  title="Report file generation is not available yet"
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-200 text-gray-500 font-semibold rounded-lg cursor-not-allowed"
                >
                  <FileText className="w-4 h-4" />
                  Generate Report
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Sections */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <List className="w-4 h-4" />
                    Report Sections
                  </h4>
                  <div className="space-y-1">
                    {selectedTemplateData.sections.map((section, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm text-gray-600">
                        <div className="w-5 h-5 bg-purple-100 text-purple-700 rounded-full flex items-center justify-center text-xs font-bold">
                          {idx + 1}
                        </div>
                        {section}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Charts */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Included Charts
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedTemplateData.charts.map((chart, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600"
                      >
                        {chart}
                      </span>
                    ))}
                    {options.includeAIInsights && (
                      <span className="px-2 py-1 bg-purple-100 border border-purple-200 rounded-lg text-xs font-medium text-purple-700 flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        AI Insights
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Preview Info */}
              <div className="mt-4 pt-4 border-t border-gray-200 flex items-center justify-between text-sm">
                <span className="flex items-center gap-1 text-gray-500">
                  <FileText className="w-4 h-4" />
                  ~{selectedTemplateData.estimatedPages} pages when this ships
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Format:</span>
                  <span className="font-medium text-gray-700 uppercase">{options.format}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty State */}
        {!selectedTemplate && (
          <div className="text-center py-8">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-600 font-medium mb-2">Select a template to see what it will contain</p>
            <p className="text-sm text-gray-400">Generating the file itself is not available yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
