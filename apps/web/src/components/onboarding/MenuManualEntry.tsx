import { useState } from 'react'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import { importMenu, type WineExtractItem, type MenuImportSuccess } from '../../services/api/menus'
import { READ_WITHOUT_ANSWER, readWithoutAnswer } from '../../lib/menuReadWithoutAnswer'
import { displayGroupMark, readOptionalAmount, twoReadingsProblem } from '../../lib/parseDecimal'
import { CURRENCY_NOT_RECORDED } from '../../lib/currency'
import { useHouseCurrency } from '../../hooks/useHouseCurrency'
import { useHouseGroupMark } from '../../hooks/useHouseGroupMark'

// The prices are kept as typed and read the way the house writes them on
// Import (F-1000, as /menu's add form does since F-358): a number input made
// "45,50" an empty value in an English browser, and the wine was imported with
// no price and no word about it.
interface WineRow extends Omit<WineExtractItem, 'by_glass_price' | 'bottle_price'> {
  _id: number
  glass: string
  bottle: string
}

let rowCounter = 0

function emptyRow(): WineRow {
  return {
    _id: ++rowCounter,
    name: '',
    producer: '',
    vintage: '',
    region: '',
    glass: '',
    bottle: '',
  }
}

interface MenuManualEntryProps {
  onSuccess: MenuImportSuccess
}

export function MenuManualEntry({ onSuccess }: MenuManualEntryProps) {
  const [rows, setRows] = useState<WineRow[]>([emptyRow()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  // Sent with no answer back: it may already be kept as a draft menu, and the
  // import is not idempotent (each call inserts a new version), so Import is
  // not offered again here (F-808).
  const [unanswered, setUnanswered] = useState(false)
  const currency = useHouseCurrency()
  const group = useHouseGroupMark()
  // The column says whose money it is: a lira house was asked for "Glass ($)".
  const unit = currency === undefined ? '' : ` (${currency ?? CURRENCY_NOT_RECORDED})`

  const updateRow = (id: number, field: Exclude<keyof WineRow, '_id'>, value: string) => {
    setRows((prev) => prev.map((row) => (row._id === id ? { ...row, [field]: value } : row)))
  }

  const addRow = () => setRows((prev) => [...prev, emptyRow()])

  const removeRow = (id: number) => {
    if (rows.length === 1) return
    setRows((prev) => prev.filter((r) => r._id !== id))
  }

  const validRows = rows.filter((r) => r.name.trim())
  const typedPrices = validRows.flatMap((r) => [r.glass, r.bottle])
  const unreadable = typedPrices.find((raw) => !readOptionalAmount(raw, group).ok) ?? null
  const shown = displayGroupMark()
  const twoWays =
    unreadable === null
      ? typedPrices.map((raw) => twoReadingsProblem(raw, group, shown)).find((p) => p !== null) ?? null
      : null
  const priceOf = (raw: string): number | undefined => {
    const read = readOptionalAmount(raw, group)
    return read.ok ? (read.value ?? undefined) : undefined
  }

  const handleImport = async () => {
    setValidationError(null)
    if (unanswered) return
    if (validRows.length === 0) {
      setValidationError('Please enter at least one wine name before importing.')
      return
    }
    if (unreadable !== null || twoWays !== null) return

    setLoading(true)
    setError(null)
    try {
      const items: WineExtractItem[] = validRows.map(({ _id: _discard, glass, bottle, ...rest }) => ({
        ...rest,
        by_glass_price: priceOf(glass),
        bottle_price: priceOf(bottle),
      }))
      const result = await importMenu('manual', { items })
      onSuccess(result)
    } catch (e: any) {
      if (readWithoutAnswer(e)) {
        setUnanswered(true)
        setError(READ_WITHOUT_ANSWER)
        return
      }
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
      {unreadable !== null && (
        <div role="alert" className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          “{unreadable}” is not a price. Write it like 12,50 or 12.50.
        </div>
      )}
      {twoWays !== null && (
        <div role="alert" className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          {twoWays}
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
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[100px]">Glass{unit}</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[100px]">Bottle{unit}</th>
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
                    type="text"
                    inputMode="decimal"
                    aria-label={`Glass price, row ${idx + 1}`}
                    value={row.glass}
                    onChange={(e) => updateRow(row._id, 'glass', e.target.value)}
                    placeholder="14.00"
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Bottle price, row ${idx + 1}`}
                    value={row.bottle}
                    onChange={(e) => updateRow(row._id, 'bottle', e.target.value)}
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
          disabled={loading || unanswered || validRows.length === 0 || unreadable !== null || twoWays !== null}
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
