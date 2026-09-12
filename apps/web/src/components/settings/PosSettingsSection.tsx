/**
 * Settings → POS — searchable provider registry + select/configure active POS.
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Search,
  MonitorSmartphone,
  CheckCircle2,
  ExternalLink,
  Copy,
  Loader2,
  Plug,
  Filter,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../stores'
import { useUserPreferences } from '../../hooks/useUserPreferences'
import {
  getPosProviders,
  getPosStatus,
  type AdapterStatus,
  type PosProviderMeta,
  type ProviderTier,
} from '../../services/api/posHub'
import { cn } from '../../lib/utils'

const TIER_LABELS: Record<ProviderTier | 'all', string> = {
  all: 'All',
  universal: 'Universal',
  cloud: 'Cloud',
  enterprise: 'Enterprise',
  partner_gated: 'Partner',
  regional_tr: 'Türkiye',
}

const STATUS_STYLES: Record<AdapterStatus, string> = {
  available: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  partial: 'bg-amber-50 text-amber-700 border-amber-100',
  scaffolded: 'bg-blue-50 text-blue-700 border-blue-100',
  planned: 'bg-gray-100 text-gray-500 border-gray-200',
}

const STATUS_LABELS: Record<AdapterStatus, string> = {
  available: 'Ready',
  partial: 'Partial',
  scaffolded: 'Scaffolded',
  planned: 'Planned',
}

export function PosSettingsSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const restaurantId = useAuthStore((s) => s.activeRestaurantId)
  const { preferences, updatePreferences } = useUserPreferences()
  const [query, setQuery] = useState('')
  const [tier, setTier] = useState<ProviderTier | 'all'>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(
    () => (preferences.posConfig as { activeProvider?: string } | undefined)?.activeProvider ?? 'toast',
  )

  const providersQuery = useQuery({
    queryKey: ['pos-hub', 'providers'],
    queryFn: getPosProviders,
    staleTime: 60_000,
  })

  const statusQuery = useQuery({
    queryKey: ['pos-hub', 'status', restaurantId],
    queryFn: () => getPosStatus(restaurantId ?? undefined),
    enabled: !!restaurantId,
    staleTime: 30_000,
  })

  const activeProvider =
    (preferences.posConfig as { activeProvider?: string } | undefined)?.activeProvider ?? null

  // Deep-link: /settings?tab=pos&provider=toast
  useEffect(() => {
    const provider = searchParams.get('provider')
    if (provider) setSelectedKey(provider)
  }, [searchParams])

  useEffect(() => {
    const fromPrefs = (preferences.posConfig as { activeProvider?: string } | undefined)
      ?.activeProvider
    if (fromPrefs && !searchParams.get('provider')) {
      setSelectedKey(fromPrefs)
    }
  }, [preferences.posConfig, searchParams])

  const providers = providersQuery.data?.providers ?? []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return providers.filter((p) => {
      if (tier !== 'all' && p.tier !== tier) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        (p.notes ?? '').toLowerCase().includes(q) ||
        p.region.toLowerCase().includes(q)
      )
    })
  }, [providers, query, tier])

  const selected = providers.find((p) => p.key === selectedKey) ?? filtered[0] ?? null

  const selectProvider = (p: PosProviderMeta) => {
    setSelectedKey(p.key)
    const next = new URLSearchParams(searchParams)
    next.set('tab', 'pos')
    next.set('provider', p.key)
    setSearchParams(next, { replace: true })
  }

  const activateProvider = (p: PosProviderMeta) => {
    updatePreferences({
      posConfig: {
        activeProvider: p.key,
        updatedAt: new Date().toISOString(),
      },
    })
    toast.success(`${p.name} set as active POS`)
  }

  const webhookUrl =
    restaurantId && selected
      ? `${window.location.origin}/api/v1/pos-hub/webhook/${selected.key}/${restaurantId}`
      : null

  // `null` = the status read failed, and this renders as an em dash. A real
  // measured zero still renders `0`. These used to be the same sentence
  // ("0 checks from this source"), which reads as "quiet POS" over a dead one.
  // ADR 0067 / ADR 0051.
  const ingestionCount: number | null = statusQuery.data?.unavailable
    ? null
    : (statusQuery.data?.sources?.find((s) => s.source === selected?.key)?.checks ?? 0)

  return (
    <div
      id="pos"
      className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 flex items-center gap-2 border-b border-gray-100">
        <MonitorSmartphone className="w-4 h-4 text-wine-500" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">POS</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Search and select which point-of-sale to use for sales analytics and inventory sync.
          </p>
        </div>
        {activeProvider && (
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-wine-50 text-wine-700 border border-wine-100">
            Active: {providers.find((p) => p.key === activeProvider)?.name ?? activeProvider}
          </span>
        )}
      </div>

      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-gray-50 bg-gray-50/60 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search POS systems… Toast, Square, Clover, Simpra…"
            className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-300 focus:ring-2 focus:ring-wine-500 focus:border-transparent outline-none"
            aria-label="Search POS systems"
          />
        </div>
        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0 ml-1" />
          {(Object.keys(TIER_LABELS) as Array<ProviderTier | 'all'>).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTier(key)}
              className={cn(
                'px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
                tier === key
                  ? 'bg-wine-600 text-white'
                  : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50',
              )}
            >
              {TIER_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 min-h-[320px]">
        {/* Provider list */}
        <div className="md:col-span-2 border-b md:border-b-0 md:border-r border-gray-100 max-h-[420px] overflow-y-auto">
          {providersQuery.isLoading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading providers…
            </div>
          )}
          {providersQuery.isError && (
            <div className="p-6 text-sm text-rose-600">
              Could not load POS registry. Check API connectivity and try again.
            </div>
          )}
          {!providersQuery.isLoading && filtered.length === 0 && (
            <div className="p-6 text-sm text-gray-400 text-center">
              No POS matches &ldquo;{query}&rdquo;
            </div>
          )}
          {filtered.map((p) => {
            const isSelected = selected?.key === p.key
            const isActive = activeProvider === p.key
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => selectProvider(p)}
                className={cn(
                  'w-full text-left px-4 py-3 flex items-start gap-3 border-b border-gray-50 transition-colors',
                  isSelected ? 'bg-wine-50/80' : 'hover:bg-gray-50',
                )}
              >
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                    isActive ? 'bg-wine-100 text-wine-600' : 'bg-gray-100 text-gray-400',
                  )}
                >
                  {isActive ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <Plug className="w-4 h-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                    {isActive && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-wine-600">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {p.region.toUpperCase()} · {p.apiStyle} · {p.authModel.replace('_', ' ')}
                  </p>
                </div>
                <span
                  className={cn(
                    'text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0',
                    STATUS_STYLES[p.status],
                  )}
                >
                  {STATUS_LABELS[p.status]}
                </span>
              </button>
            )
          })}
        </div>

        {/* Configure panel */}
        <div className="md:col-span-3 p-5 space-y-4">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-sm text-gray-400">
              Select a POS from the list to configure it.
            </div>
          ) : (
            <>
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">{selected.name}</h3>
                    <p className="text-xs text-gray-500 mt-1">
                      Key <code className="text-wine-700 bg-wine-50 px-1 rounded">{selected.key}</code>
                      {' · '}
                      Tier {TIER_LABELS[selected.tier]}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'text-xs font-medium px-2 py-1 rounded-lg border',
                      STATUS_STYLES[selected.status],
                    )}
                  >
                    {STATUS_LABELS[selected.status]}
                  </span>
                </div>
                {selected.notes && (
                  <p className="text-sm text-gray-600 mt-3 leading-relaxed">{selected.notes}</p>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Object.entries(selected.capabilities).map(([cap, on]) => (
                  <div
                    key={cap}
                    className={cn(
                      'px-2.5 py-2 rounded-lg text-xs font-medium border',
                      on
                        ? 'bg-emerald-50/80 text-emerald-700 border-emerald-100'
                        : 'bg-gray-50 text-gray-400 border-gray-100',
                    )}
                  >
                    {cap}
                  </div>
                ))}
              </div>

              {restaurantId && (
                <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-xs text-gray-600">
                  {statusQuery.isLoading ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" /> Checking ingestion…
                    </span>
                  ) : ingestionCount === null ? (
                    <span>
                      Ingestion (30d): <strong className="text-gray-900">—</strong> · we could not
                      read the ingestion log, so this is unknown rather than zero.
                    </span>
                  ) : (
                    <span>
                      Ingestion (30d):{' '}
                      <strong className="text-gray-900">{ingestionCount}</strong> checks from this
                      source
                      {activeProvider === selected.key ? ' · currently active' : ''}.
                    </span>
                  )}
                </div>
              )}

              {webhookUrl &&
                (selected.apiStyle === 'webhook' || selected.key === 'generic_webhook') && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5">Webhook endpoint</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 truncate text-gray-700">
                        {webhookUrl}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(webhookUrl)
                          toast.success('Webhook URL copied')
                        }}
                        className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600"
                        title="Copy webhook URL"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => activateProvider(selected)}
                  disabled={activeProvider === selected.key}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors',
                    activeProvider === selected.key
                      ? 'bg-gray-100 text-gray-400 cursor-default'
                      : 'bg-wine-600 text-white hover:bg-wine-700',
                  )}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {activeProvider === selected.key ? 'Currently in use' : 'Use this POS'}
                </button>
                {selected.docsUrl && (
                  <a
                    href={selected.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50"
                  >
                    Docs <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {selected.status === 'planned' && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  This provider is on the roadmap. You can still mark it as preferred; use Generic
                  Webhook or CSV import to feed data today.
                </p>
              )}
              {selected.status === 'scaffolded' && (
                <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                  Adapter is ready — connect merchant credentials (OAuth / API key) to start
                  ingesting live checks.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
