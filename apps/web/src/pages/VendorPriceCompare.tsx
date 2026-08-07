import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  Info,
  Loader2,
  Minus,
  Plus,
  Search,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react'
import { getWineById, searchWines } from '../services/api/wines'
import type { Wine } from '../services/api/types'
import {
  apiErrorMessage,
  compareVendorPrices,
  recordVendorPrice,
  type ManualSourceType,
  type PriceSourceType,
  type PriceTrend,
} from '../services/api/vendorIntel'

/** Every source is labelled and depicted — the badge is the label. */
const SOURCE_META: Record<PriceSourceType, { label: string; cls: string }> = {
  invoice: { label: 'Invoice', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  quote: { label: 'Quote', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  api_catalog: { label: 'Vendor feed', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  website_scrape: { label: 'Website', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  chat: { label: 'Chat', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  social: { label: 'Social', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  manual: { label: 'Manual', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
}

const MANUAL_SOURCES: Array<{ value: ManualSourceType; label: string; hint: string }> = [
  { value: 'quote', label: 'Written quote', hint: 'They committed to it in writing' },
  { value: 'chat', label: 'Message from a rep', hint: 'WhatsApp, SMS or email' },
  { value: 'social', label: 'Social post', hint: 'Public, often promotional' },
  { value: 'manual', label: 'Told to me', hint: 'Heard it, wrote it down' },
]

const money = (v: number | null) =>
  v === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(v)

const wineLabel = (w: Wine) =>
  [w.producer, w.name, w.vintage].filter(Boolean).join(' ')

function SourceBadge({ type }: { type: PriceSourceType }) {
  const meta = SOURCE_META[type] ?? SOURCE_META.manual
  return (
    <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded border ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function TrendCell({ t }: { t: PriceTrend }) {
  // A null change is rendered as "no comparable data", never as 0%. Reporting
  // an unknown as flat is the same class of lie as reporting a failed query
  // as an empty result.
  if (t.pctChange === null) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-xs uppercase tracking-wide text-gray-400">{t.windowDays}d</div>
        <div className="mt-1 text-gray-400 text-sm">No comparable data</div>
      </div>
    )
  }
  const up = t.pctChange > 0.001
  const down = t.pctChange < -0.001
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus
  const tone = up ? 'text-rose-600' : down ? 'text-emerald-600' : 'text-gray-500'
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-400">{t.windowDays}d</div>
      <div className={`mt-1 flex items-center gap-1.5 font-semibold ${tone}`}>
        <Icon className="w-4 h-4" strokeWidth={2} />
        {(t.pctChange * 100).toFixed(1)}%
      </div>
      <div className="mt-0.5 text-xs text-gray-500">{money(t.current)} now</div>
    </div>
  )
}

function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/**
 * Search by name, not by id.
 *
 * The page used to take a raw `master wine id` in a text box. Nobody knows a
 * UUID, so the only thing a person could do was type a wine name — which
 * reached Postgres as a uuid comparison and came back 22P02, surfaced as a
 * 500. The input that caused the error was also the only input the UI invited.
 */
function WinePicker({
  selected,
  onSelect,
}: {
  selected: Wine | null
  onSelect: (w: Wine | null) => void
}) {
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const debounced = useDebounced(term)

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['wine-search', debounced],
    // Two characters is the floor: one letter matches most of the library and
    // makes the picker useless as a way to narrow anything.
    enabled: debounced.trim().length >= 2,
    queryFn: () => searchWines({ search: debounced.trim(), limit: 8 }),
    staleTime: 60_000,
  })

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-wine-200 bg-wine-50 px-3 py-2.5">
        <Check className="w-4 h-4 text-wine-700 flex-shrink-0" strokeWidth={2} />
        <span className="flex-1 text-sm font-medium text-wine-900 truncate">
          {wineLabel(selected)}
        </span>
        <button
          type="button"
          onClick={() => {
            onSelect(null)
            setTerm('')
          }}
          aria-label="Clear selected wine"
          className="text-wine-700 hover:text-wine-900"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 focus-within:border-wine-500">
        <Search className="w-4 h-4 text-gray-400 flex-shrink-0" strokeWidth={2} />
        <input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search a wine by name or producer"
          aria-label="Search a wine by name or producer"
          className="flex-1 text-sm focus:outline-none"
        />
        {isFetching && <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />}
      </div>

      {open && debounced.trim().length >= 2 && (
        <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg">
          {results.length === 0 && !isFetching ? (
            <li className="px-3 py-3 text-sm text-gray-500">
              No wine in the library matches that.
            </li>
          ) : (
            results.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(w)
                    setOpen(false)
                  }}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-900">{w.name}</span>
                  <span className="block text-xs text-gray-500">
                    {[w.producer, w.vintage].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}

/**
 * Record a price someone was told.
 *
 * Present on this page because the comparison is empty until something is
 * observed, and for most restaurants the first observation is not a scrape —
 * it is a number a rep said on the phone.
 */
function AddPriceForm({
  wine,
  onRecorded,
}: {
  wine: Wine
  onRecorded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [vendorName, setVendorName] = useState('')
  const [price, setPrice] = useState('')
  const [packSize, setPackSize] = useState('1')
  const [sourceType, setSourceType] = useState<ManualSourceType>('quote')

  const mutation = useMutation({
    mutationFn: () =>
      recordVendorPrice({
        masterWineId: wine.id,
        productName: wine.name,
        producer: wine.producer,
        vintage: wine.vintage,
        vendorName: vendorName.trim() || undefined,
        price: Number(price),
        packSize: Number(packSize) || 1,
        unitVolumeMl: wine.bottleSizeMl || undefined,
        sourceType,
      }),
    onSuccess: () => {
      setVendorName('')
      setPrice('')
      setPackSize('1')
      setOpen(false)
      onRecorded()
    },
  })

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-wine-700 hover:text-wine-900"
      >
        <Plus className="w-4 h-4" strokeWidth={2} />
        Add a price you were quoted
      </button>
    )
  }

  const priceValue = Number(price)
  const canSubmit = price !== '' && Number.isFinite(priceValue) && priceValue >= 0

  return (
    <form
      className="mt-4 rounded-2xl border border-gray-200 bg-white p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (canSubmit) mutation.mutate()
      }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">
          Add a price for {wineLabel(wine)}
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-gray-400 hover:text-gray-600"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-xs text-gray-500">Vendor</span>
          <input
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder="Who quoted it"
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-wine-500"
          />
        </label>

        <label className="text-sm">
          <span className="text-xs text-gray-500">How you learned it</span>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as ManualSourceType)}
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-wine-500"
          >
            {MANUAL_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} — {s.hint}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="text-xs text-gray-500">Price as quoted</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            placeholder="240.00"
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-wine-500"
          />
        </label>

        <label className="text-sm">
          <span className="text-xs text-gray-500">Bottles in that price</span>
          <input
            value={packSize}
            onChange={(e) => setPackSize(e.target.value)}
            inputMode="numeric"
            className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-wine-500"
          />
          {/* The single most common cause of a wrong comparison: a $240 case
              ranked as if it were a $240 bottle. */}
          <span className="mt-1 block text-[11px] text-gray-400">
            12 for a case, 1 for a single bottle
          </span>
        </label>
      </div>

      {mutation.isError && (
        <p className="mt-3 text-sm text-red-700">
          {apiErrorMessage(mutation.error, 'Could not save that price.')}
        </p>
      )}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit || mutation.isPending}
          className="rounded-xl bg-wine-700 px-4 py-2 text-sm font-medium text-white hover:bg-wine-800 disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Save price'}
        </button>
        <span className="text-xs text-gray-400">
          Recorded as an observation — it never overwrites an invoice.
        </span>
      </div>
    </form>
  )
}

export function VendorPriceCompare() {
  const [searchParams, setSearchParams] = useSearchParams()
  const masterWineId = searchParams.get('masterWineId') ?? ''
  const [selectedWine, setSelectedWine] = useState<Wine | null>(null)
  const [showOutliers, setShowOutliers] = useState(false)
  const queryClient = useQueryClient()

  // Arriving with ?masterWineId in the URL — a bookmark, or a link from the
  // inventory row — must show the same page as picking the wine here does.
  // Without this the picker reads as empty on a URL that is clearly about one
  // specific wine, and the "add a price" form never appears.
  const { data: linkedWine } = useQuery({
    queryKey: ['wine', masterWineId],
    enabled: !!masterWineId && !selectedWine,
    queryFn: () => getWineById(masterWineId),
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (linkedWine && !selectedWine) setSelectedWine(linkedWine)
  }, [linkedWine, selectedWine])

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['vendor-compare', masterWineId],
    enabled: !!masterWineId,
    queryFn: () => compareVendorPrices({ masterWineId }),
  })

  const ladder = useMemo(() => {
    if (!data) return []
    return showOutliers
      ? data.consensus.ladder
      : data.consensus.ladder.filter((q) => !q.isOutlier)
  }, [data, showOutliers])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Vendor price comparison</h1>
      <p className="mt-1 text-sm text-gray-500">
        Every source, labelled. Ranked by price per 750ml equivalent, not by listed price.
      </p>

      <div className="mt-6">
        <WinePicker
          selected={selectedWine}
          onSelect={(w) => {
            setSelectedWine(w)
            setSearchParams(w ? { masterWineId: w.id } : {})
          }}
        />
      </div>

      {!masterWineId && (
        <p className="mt-8 text-sm text-gray-500">
          Pick a wine to see which vendors sell it and for how much.
        </p>
      )}

      {selectedWine && (
        <AddPriceForm
          wine={selectedWine}
          onRecorded={() =>
            queryClient.invalidateQueries({ queryKey: ['vendor-compare', masterWineId] })
          }
        />
      )}

      {isLoading && <p className="mt-8 text-sm text-gray-500">Loading observations…</p>}

      {isError && (
        <div className="mt-8 rounded-xl border border-red-100 bg-red-50 p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" strokeWidth={1.75} />
          <div>
            <p className="text-sm font-medium text-red-900">Could not load the comparison</p>
            {/* The server's message, not axios's "Request failed with status
                code 400" — the API returns an actionable sentence and it was
                being thrown away. */}
            <p className="text-sm text-red-700">{apiErrorMessage(error)}</p>
          </div>
        </div>
      )}

      {data && (
        <>
          {data.productName && (
            <h2 className="mt-8 text-lg font-semibold text-gray-900">{data.productName}</h2>
          )}

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-400">Best</div>
              <div className="mt-1 font-semibold text-gray-900">
                {money(data.consensus.bestPrice)}
              </div>
              <div className="mt-0.5 text-xs text-gray-500 truncate">
                {data.consensus.bestVendorName ?? '—'}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-400">Consensus</div>
              <div className="mt-1 font-semibold text-gray-900">
                {money(data.consensus.consensusPrice)}
              </div>
              <div className="mt-0.5 text-xs text-gray-500">
                {(data.consensus.confidence * 100).toFixed(0)}% confidence
              </div>
            </div>
            {data.trends.slice(0, 2).map((t) => (
              <TrendCell key={t.windowDays} t={t} />
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            {data.trends.slice(2).map((t) => (
              <TrendCell key={t.windowDays} t={t} />
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">Sources:</span>
            {Object.entries(data.consensus.sourceBreakdown).map(([k, n]) => (
              <span key={k} className="inline-flex items-center gap-1">
                <SourceBadge type={k as PriceSourceType} />
                <span className="text-xs text-gray-500">×{n}</span>
              </span>
            ))}
            {data.consensus.outlierCount > 0 && (
              <label className="ml-auto text-xs text-gray-600 flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showOutliers}
                  onChange={(e) => setShowOutliers(e.target.checked)}
                />
                Show {data.consensus.outlierCount} rejected outlier
                {data.consensus.outlierCount === 1 ? '' : 's'}
              </label>
            )}
          </div>

          <div className="mt-4 bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-left text-gray-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Vendor</th>
                    <th scope="col" className="px-4 py-3 font-medium">Source</th>
                    <th scope="col" className="px-4 py-3 font-medium">Seen</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Per 750ml</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ladder.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-10 text-center text-gray-500">
                        No usable price observations for this product yet.
                      </td>
                    </tr>
                  ) : (
                    ladder.map((q, i) => (
                      <tr
                        key={`${q.vendorName}-${i}`}
                        className={q.isOutlier ? 'bg-rose-50/50' : 'hover:bg-gray-50'}
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {q.vendorName ?? 'Unknown vendor'}
                          {q.isOutlier && (
                            <span className="ml-2 text-[11px] text-rose-700">rejected outlier</span>
                          )}
                        </td>
                        <td className="px-4 py-3"><SourceBadge type={q.sourceType} /></td>
                        <td className="px-4 py-3 text-gray-500">
                          {q.ageDays < 1 ? 'today' : `${Math.round(q.ageDays)}d ago`}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {money(q.unitPrice)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {data.consensus.notes.length > 0 && (
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
                <Info className="w-3.5 h-3.5" strokeWidth={2} />
                How this was calculated
              </div>
              <ul className="mt-2 space-y-1.5 text-sm text-gray-600">
                {data.consensus.notes.map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default VendorPriceCompare
