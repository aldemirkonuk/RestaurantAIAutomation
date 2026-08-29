import { useState } from 'react'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import { importMenu, type WineExtractItem, type MenuImportResult } from '../../services/api/menus'

interface WineRow extends WineExtractItem {
  _id: number
}

let rowCounter = 0

function emptyRow(): WineRow {
  return {
    _id: ++rowCounter,
    name: '',
    producer: '',
    vintage: '',
    region: '',
    by_glass_price: undefined,
    bottle_price: undefined,
  }
}

interface MenuManualEntryProps {
  onSuccess: (result: MenuImportResult) => void
}

export function MenuManualEntry({ onSuccess }: MenuManualEntryProps) {
  const [rows, setRows] = useState<WineRow[]>([emptyRow()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  const updateRow = (id: number, field: keyof WineRow, value: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row._id === id
          ? { ...row, [field]: field.includes('price') ? (value === '' ? undefined : parseFloat(value)) : value }
          : row
      )
    )
  }

  const addRow = () => setRows((prev) => [...prev, emptyRow()])

  const removeRow = (id: number) => {
    if (rows.length === 1) return
    setRows((prev) => prev.filter((r) => r._id !== id))
  }

  const validRows = rows.filter((r) => r.name.trim())

  const handleImport = async () => {
    setValidationError(null)
    if (validRows.length === 0) {
      setValidationError('Please enter at least one wine name before importing.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const items: WineExtractItem[] = validRows.map(({ _id: _discard, ...rest }) => rest)
      const result = await importMenu('manual', { items })
      onSuccess(result)
    } catch (e: any) {
      setError(e?.response?.data?.message || e?.message || 'Import failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
      {error && (
        <div className="mb-4 flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <RotateCcw className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {validationError && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          {validationError}
        </div>
      )}

      <div className="overflow-auto rounded-xl border border-gray-200 bg-white mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[200px]">
                Wine Name <span className="text-red-400">*</span>
              </th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[160px]">Producer</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[90px]">Vintage</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[140px]">Region</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[100px]">Glass ($)</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[100px]">Bottle ($)</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={row._id} className="border-b border-gray-100 last:border-0">
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateRow(row._id, 'name', e.target.value)}
                    placeholder={idx === 0 ? 'e.g. Château Margaux 2018' : 'Wine name'}
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={row.producer ?? ''}
                    onChange={(e) => updateRow(row._id, 'producer', e.target.value)}
                    placeholder="Château Margaux"
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={row.vintage ?? ''}
                    onChange={(e) => updateRow(row._id, 'vintage', e.target.value)}
                    placeholder="2018"
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    value={row.region ?? ''}
                    onChange={(e) => updateRow(row._id, 'region', e.target.value)}
                    placeholder="Bordeaux, France"
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.by_glass_price ?? ''}
                    onChange={(e) => updateRow(row._id, 'by_glass_price', e.target.value)}
                    placeholder="14.00"
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.bottle_price ?? ''}
                    onChange={(e) => updateRow(row._id, 'bottle_price', e.target.value)}
                    placeholder="68.00"
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <button
                    onClick={() => removeRow(row._id)}
                    disabled={rows.length === 1}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          onClick={addRow}
          className="flex items-center gap-1.5 text-sm text-[#1A5E6B] hover:text-[#14515C] font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add another wine
        </button>

        <Button
          onClick={handleImport}
          disabled={loading || validRows.length === 0}
          className="bg-[#1A5E6B] hover:bg-[#14515C] text-white"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Importing...
            </span>
          ) : (
            `Import ${validRows.length > 0 ? validRows.length : ''} wine${validRows.length !== 1 ? 's' : ''}`
          )}
        </Button>
      </div>

      <p className="mt-3 text-xs text-gray-400 text-center">
        Only the wine name is required — all other fields are optional
      </p>
    </div>
  )
}
