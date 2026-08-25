/**
 * CheckScannerSection - Molecule Component
 * Receipt upload and analysis
 */

import { Camera } from 'lucide-react'
import { CollapsibleSection } from '../atoms'
import { SCAN_ACCEPT } from '../../../lib/uploadAccept'

interface CheckScan {
  id: number
  date: string
  total: number
  wine_sales: number
  profit_margin: number
}

interface CheckScannerSectionProps {
  scans: CheckScan[]
  isOpen: boolean
  onToggle: () => void
  onUpload?: (file: File) => void
  className?: string
}

export function CheckScannerSection({
  scans,
  isOpen,
  onToggle,
  onUpload,
  className = '',
}: CheckScannerSectionProps) {
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && onUpload) {
      onUpload(file)
    }
  }

  return (
    <CollapsibleSection
      title="Digital Check Scanner"
      subtitle="Upload receipts to analyze wine sales"
      icon={Camera}
      isOpen={isOpen}
      onToggle={onToggle}
      className={className}
    >
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <p className="text-sm text-gray-600">Upload receipts to analyze wine sales and calculate profit margins</p>
          <button
            onClick={() => document.getElementById('check-file-input')?.click()}
            className="flex items-center gap-2 px-4 py-2.5 bg-wine-600 text-white font-medium rounded-lg hover:bg-wine-700 transition-colors"
          >
            <Camera className="w-4 h-4" />
            Scan Check
          </button>
          <input
            type="file"
            id="check-file-input"
            accept={SCAN_ACCEPT}
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        <div className="space-y-3">
          {scans.map((scan) => (
            <div
              key={scan.id}
              className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-gray-200"
            >
              <div className="flex items-center gap-4">
                <div className="p-2 bg-white rounded-lg">
                  <Camera className="w-5 h-5 text-wine-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{new Date(scan.date).toLocaleDateString()}</p>
                  <p className="text-sm text-gray-500">Wine Sales: ${scan.wine_sales.toFixed(2)}</p>
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-xs text-gray-500 font-medium">Total</p>
                  <p className="text-lg font-bold text-gray-900">${scan.total.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 font-medium">Profit Margin</p>
                  <p className="text-lg font-bold text-emerald-600">{scan.profit_margin}%</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </CollapsibleSection>
  )
}

export type { CheckScan }
