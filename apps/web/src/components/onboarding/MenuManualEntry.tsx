import { useState } from 'react'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import { importMenu, type WineExtractItem, type MenuImportSuccess } from '../../services/api/menus'

/**
 * What a typed line is. Drink values are exactly the gateway's
 * MENU_CATEGORY_VOCABULARY (apps/api-gateway/src/menus/wine-extract-item.interface.ts);
 * "food" is a kitchen hint the first proof sets aside. "" sends no category.
 */
export const LINE_KINDS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Choose…', value: '' },
  { label: 'Red wine', value: 'red' },
  { label: 'White wine', value: 'white' },
  { label: 'Rosé', value: 'rose' },
  { label: 'Sparkling', value: 'sparkling' },
  { label: 'Orange wine', value: 'orange' },
  { label: 'Dessert wine', value: 'dessert' },
  { label: 'Fortified wine', value: 'fortified' },
  { label: 'Beer', value: 'beer' },
  { label: 'Cider', value: 'cider' },
  { label: 'Sake', value: 'sake' },
  { label: 'Cocktail', value: 'cocktail' },
  { label: 'Spirit', value: 'spirit' },
  { label: 'Whiskey', value: 'whiskey' },
  { label: 'Soft drink', value: 'soft drink' },
  { label: 'Alcohol-free', value: 'non-alcoholic' },
  { label: 'Food', value: 'food' },
]

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
    category: '',
  }
}

interface MenuManualEntryProps {
  onSuccess: MenuImportSuccess
  /**
   * The house's reporting currency code when the page knows it. The price
   * headings said a dollar sign in every house (walk 2026-11-11: a Turkish
   * house, TRY); a heading names the code it knows and no symbol it does not.
   */
  currency?: string | null
}

export function MenuManualEntry({ onSuccess, currency }: MenuManualEntryProps) {
  const unit = currency ? ` (${currency})` : ''
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

  const setKind = (id: number, kind: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row._id === id
          ? kind === 'food'
            ? { ...row, category: kind, by_glass_price: undefined, bottle_price: undefined }
            : { ...row, category: kind }
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
      setValidationError('Type at least one name before importing.')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const items: WineExtractItem[] = validRows.map(({ _id: _discard, category, ...rest }) => {
        const item: WineExtractItem = { ...rest }
        if (category) item.category = category
        if (category === 'food') {
          delete item.by_glass_price
          delete item.bottle_price
        }
        for (const key of Object.keys(item) as Array<keyof WineExtractItem>) {
          if (item[key] === undefined) delete item[key]
        }
        return item
      })
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
                Name <span className="text-red-400">*</span>
              </th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[140px]">What it is</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[160px]">Producer</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[90px]">Vintage</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[140px]">Region</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[100px]">{`Glass${unit}`}</th>
              <th className="px-3 py-2.5 text-left font-semibold text-gray-600 min-w-[100px]">{`Bottle${unit}`}</th>
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
                    placeholder={idx === 0 ? 'e.g. Château Margaux 2018 or Negroni' : 'Name on the menu'}
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <select
                    aria-label={`What line ${idx + 1} is`}
                    value={row.category ?? ''}
                    onChange={(e) => setKind(row._id, e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors bg-transparent"
                  >
                    {LINE_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
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
                {row.category === 'food' ? (
                  <td colSpan={2} className="px-3 py-1.5 text-xs text-gray-400">
                    Dishes stay on the menu; Mudavym does not price them yet.
                  </td>
                ) : (
                  <>
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
                  </>
                )}
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
          Add another line
        </button>

        <Button
          onClick={handleImport}
          disabled={loading || validRows.length === 0}
          className="bg-[#1A5E6B] hover:bg-[#14515C] text-white"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Importing…
            </span>
          ) : (
            validRows.length > 0
              ? `Import ${validRows.length} ${validRows.length === 1 ? 'line' : 'lines'}`
              : 'Import lines'
          )}
        </Button>
      </div>

      <p className="mt-3 text-xs text-gray-400 text-center">
        Only the name is needed. Say what each line is and Mudavym places it; dishes are kept but not priced yet.
      </p>
    </div>
  )
}
