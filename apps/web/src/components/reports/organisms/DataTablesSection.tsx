/**
 * DataTablesSection - Organism Component
 * Container for all collapsible tables. The daily and purchase tables are both
 * fed from `procurement_orders` (vendor spend), not from POS sales.
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
  /** Sales revenue from `pos_checks` for COGS ratio; null when no POS feed. */
  posRevenue?: number | null
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
  posRevenue = null,
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
        posRevenue={posRevenue}
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
