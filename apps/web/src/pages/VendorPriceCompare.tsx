import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { AlertTriangle, Info, TrendingDown, TrendingUp, Minus } from 'lucide-react'

const API_URL = import.meta.env.VITE_API_GATEWAY_URL || 'http://localhost:4000'

type SourceType =
  | 'invoice' | 'quote' | 'api_catalog' | 'website_scrape'
  | 'chat' | 'social' | 'manual'

interface VendorQuote {
  vendorId: string | null
  vendorName: string | null
  unitPrice: number
  sourceType: SourceType
  ageDays: number
  isOutlier: boolean
}

interface Trend {
  windowDays: number
  current: number | null
  previous: number | null
  absoluteChange: number | null
  pctChange: number | null
  note: string
}

interface CompareResponse {
  productName: string | null
  consensus: {
    consensusPrice: number | null
    bestPrice: number | null
    bestVendorName: string | null
    observationCount: number
    admittedCount: number
    outlierCount: number
    sourceBreakdown: Record<string, number>
    ladder: VendorQuote[]
    confidence: number
    notes: string[]
  }
  trends: Trend[]
}

/** Every source is labelled and depicted — the badge is the label. */
const SOURCE_META: Record<SourceType, { label: string; cls: string }> = {
  invoice: { label: 'Invoice', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  quote: { label: 'Quote', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  api_catalog: { label: 'Vendor feed', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  website_scrape: { label: 'Website', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  chat: { label: 'Chat', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  social: { label: 'Social', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  manual: { label: 'Manual', cls: 'bg-gray-100 text-gray-700 border-gray-200' },
}

const money = (v: number | null) =>
  v === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(v)

function SourceBadge({ type }: { type: SourceType }) {
  const meta = SOURCE_META[type] ?? SOURCE_META.manual
  return (
    <span className={`inline-block text-[11px] font-medium px-1.5 py-0.5 rounded border ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function TrendCell({ t }: { t: Trend }) {
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

export function VendorPriceCompare() {
  const [searchParams, setSearchParams] = useSearchParams()
  const masterWineId = searchParams.get('masterWineId') ?? ''
  const [input, setInput] = useState(masterWineId)
  const [showOutliers, setShowOutliers] = useState(false)

  const { data, isLoading, isError, error } = useQuery<CompareResponse>({
    queryKey: ['vendor-compare', masterWineId],
    enabled: !!masterWineId,
    queryFn: async () => {
      const token = localStorage.getItem('accessToken')
      const res = await axios.get(`${API_URL}/api/v1/vendor-intel/compare`, {
        params: { masterWineId },
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      return res.data
    },
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

      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setSearchParams(input ? { masterWineId: input } : {})
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="master wine id"
          aria-label="Master wine id"
          className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:border-wine-500"
        />
        <button
          type="submit"
          className="rounded-xl bg-wine-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-wine-800"
        >
          Compare
        </button>
      </form>

      {!masterWineId && (
        <p className="mt-8 text-sm text-gray-500">
          Enter a master wine id to see which vendors sell it and for how much.
        </p>
      )}

      {isLoading && <p className="mt-8 text-sm text-gray-500">Loading observations…</p>}

      {isError && (
        <div className="mt-8 rounded-xl border border-red-100 bg-red-50 p-4 flex gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" strokeWidth={1.75} />
          <div>
            <p className="text-sm font-medium text-red-900">Could not load the comparison</p>
            <p className="text-sm text-red-700">{(error as any)?.message ?? 'Unknown error'}</p>
          </div>
        </div>
      )}

      {data && (
        <>
          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-3">
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
                <SourceBadge type={k as SourceType} />
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
