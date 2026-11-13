import { useState } from 'react'
import { Plus, Trash2, RotateCcw } from 'lucide-react'
import { Button } from '../ui/button'
import { importMenu, type WineExtractItem, type MenuImportSuccess } from '../../services/api/menus'
import { readTypedPrice } from '../../lib/typedPrice'
import { housePriceHint } from '../../lib/house-number'

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

/**
 * A typed line. Prices stay the text the person typed until Import reads them
 * (`readTypedPrice`): a `type=number` box could not take "24,50" in a house
 * that writes a decimal comma (onboarding r22 D6).
 */
interface WineRow extends Omit<WineExtractItem, 'by_glass_price' | 'bottle_price'> {
  _id: number
  glass: string
  bottle: string
}

type PriceField = 'glass' | 'bottle'
type TextField = 'name' | 'producer' | 'vintage' | 'region' | PriceField

/** The box a refused price came from, by row and field. */
const refusalKey = (id: number, field: PriceField) => `${id}:${field}`

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
  // The hints are written the way the house writes a price, "14,00" in a lira
  // house (r23 walk: they read "14.00"). readTypedPrice takes either mark and
  // refuses a grouped "1,250", so a hint never shows a thousands mark.
  const hint = (n: number) => housePriceHint(n, currency)
  const [rows, setRows] = useState<WineRow[]>([emptyRow()])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  // Price boxes Import refused, so each one says it is wrong where it stands.
  const [refused, setRefused] = useState<Map<string, string>>(new Map())

  const updateRow = (id: number, field: TextField, value: string) => {
    setRows((prev) => prev.map((row) => (row._id === id ? { ...row, [field]: value } : row)))
    if (field === 'glass' || field === 'bottle') {
      const key = refusalKey(id, field)
      setRefused((prev) => {
        if (!prev.has(key)) return prev
        const next = new Map(prev)
        next.delete(key)
        return next
      })
    }
  }

  const setKind = (id: number, kind: string) => {
    setRows((prev) =>
      prev.map((row) =>
        row._id === id
          ? kind === 'food'
            ? // A dish has one price, kept on its menu line the way a read menu keeps
              // "Tiramisu 9" (bottle_price, menus.service.ts); a glass price has no meaning for it.
              { ...row, category: kind, glass: '' }
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

    // Every price is read before anything is sent; one refused box sends nothing.
    const nextRefused = new Map<string, string>()
    const read = validRows.map((row) => {
      const glass = row.category === 'food' ? { value: null } : readTypedPrice(row.glass)
      const bottle = readTypedPrice(row.bottle)
      if ('refused' in glass) nextRefused.set(refusalKey(row._id, 'glass'), glass.refused)
      if ('refused' in bottle) nextRefused.set(refusalKey(row._id, 'bottle'), bottle.refused)
      return {
        row,
        glass: 'value' in glass ? glass.value : null,
        bottle: 'value' in bottle ? bottle.value : null,
      }
    })
    setRefused(nextRefused)
    if (nextRefused.size > 0) {
      const n = nextRefused.size
      setValidationError(
        `${n === 1 ? 'One price' : `${n} prices`} could not be read. Fix ${n === 1 ? 'it' : 'them'} below; nothing was imported.`,
      )
      return
    }

    setLoading(true)
    setError(null)
    try {
      const items: WineExtractItem[] = read.map(({ row, glass, bottle }) => {
        const { _id: _discard, category, glass: _g, bottle: _b, ...rest } = row
        const item: WineExtractItem = { ...rest }
        if (category) item.category = category
        if (glass !== null && category !== 'food') item.by_glass_price = glass
        if (bottle !== null) item.bottle_price = bottle
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

  // A text box, not type=number: "24,50" is typed as it is written (D6). The
  // decimal keypad still opens on a phone.
  const priceBox = (row: WineRow, field: PriceField, label: string, placeholder: string) => {
    const why = refused.get(refusalKey(row._id, field))
    const errorId = `menu-line-${row._id}-${field}-error`
    return (
      <>
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={label}
          aria-invalid={why ? true : undefined}
          aria-describedby={why ? errorId : undefined}
          value={row[field]}
          onChange={(e) => updateRow(row._id, field, e.target.value)}
          placeholder={placeholder}
          className={`w-full px-2 py-1.5 rounded-lg border ${why ? 'border-red-400' : 'border-transparent'} hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors`}
        />
        {why && (
          <span id={errorId} className="block px-2 text-xs text-red-600">
            {why}
          </span>
        )}
      </>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6">
      {error && (
        <div role="alert" className="mb-4 flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <RotateCcw className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {validationError && (
        <div role="alert" className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
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
                    aria-label={`Name of line ${idx + 1}`}
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
                    aria-label={`Producer of line ${idx + 1}`}
                    value={row.producer ?? ''}
                    onChange={(e) => updateRow(row._id, 'producer', e.target.value)}
                    placeholder="Château Margaux"
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    aria-label={`Vintage of line ${idx + 1}`}
                    value={row.vintage ?? ''}
                    onChange={(e) => updateRow(row._id, 'vintage', e.target.value)}
                    placeholder="2018"
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="text"
                    aria-label={`Region of line ${idx + 1}`}
                    value={row.region ?? ''}
                    onChange={(e) => updateRow(row._id, 'region', e.target.value)}
                    placeholder="Bordeaux, France"
                    className="w-full px-2 py-1.5 rounded-lg border border-transparent hover:border-gray-200 focus:border-[#1A5E6B] focus:outline-none focus:ring-2 focus:ring-[#1A5E6B]/20 text-sm transition-colors"
                  />
                </td>
                {row.category === 'food' ? (
                  <td colSpan={2} className="px-2 py-1.5">
                    {priceBox(row, 'bottle', `Price of line ${idx + 1}`, hint(24))}
                    <span className="block px-2 text-xs text-gray-400">The dish's price stays on the menu; no stock is made for it.</span>
                  </td>
                ) : (
                  <>
                <td className="px-2 py-1.5">
                  {priceBox(row, 'glass', `Glass price of line ${idx + 1}`, hint(14))}
                </td>
                <td className="px-2 py-1.5">
                  {priceBox(row, 'bottle', `Bottle price of line ${idx + 1}`, hint(68))}
                </td>
                  </>
                )}
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    aria-label={`Remove line ${idx + 1}`}
                    onClick={() => removeRow(row._id)}
                    disabled={rows.length === 1}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 aria-hidden="true" className="w-4 h-4" />
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
        Only the name is needed. Say what each line is and Mudavym places it; a dish keeps its price on the menu, and no stock is made for it.
      </p>
    </div>
  )
}
