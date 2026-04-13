/**
 * DataTablesSection - Organism Component
 * Container for all collapsible tables
 */

import { DailyBreakdownTable, PurchasedWinesTable, CheckScannerSection } from '../molecules'
import type { DailyData, PurchaseData, PurchaseMetrics, CheckScan } from '../molecules'

interface ExpandedSections {
  dailyBreakdown: boolean
  purchasedWines: boolean
  checkScanner: boolean
}

interface DataTablesSectionProps {
  dailyData: DailyData[]
  purchaseData: PurchaseData[]
  purchaseMetrics: PurchaseMetrics
  totalRevenue: number
  checkScans: CheckScan[]
  expandedSections: ExpandedSections
  onToggle: (section: keyof ExpandedSections) => void
  onCheckUpload?: (file: File) => void
  className?: string
}

export function DataTablesSection({
  dailyData,
  purchaseData,
  purchaseMetrics,
  totalRevenue,
  checkScans,
  expandedSections,
  onToggle,
  onCheckUpload,
  className = '',
}: DataTablesSectionProps) {
  return (
    <div className={`space-y-6 ${className}`}>
      <DailyBreakdownTable
        data={dailyData}
        isOpen={expandedSections.dailyBreakdown}
        onToggle={() => onToggle('dailyBreakdown')}
      />

      <PurchasedWinesTable
        purchaseData={purchaseData}
        metrics={purchaseMetrics}
        totalRevenue={totalRevenue}
        isOpen={expandedSections.purchasedWines}
        onToggle={() => onToggle('purchasedWines')}
      />

      <CheckScannerSection
        scans={checkScans}
        isOpen={expandedSections.checkScanner}
        onToggle={() => onToggle('checkScanner')}
        onUpload={onCheckUpload}
      />
    </div>
  )
}

export type { ExpandedSections }
