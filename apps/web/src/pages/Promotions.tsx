import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Tag, ShieldCheck, ShieldAlert, ShieldOff, Clock, Sparkles, Loader2, AlertTriangle, Check,
  UserPlus, X, Paperclip, Mail, FileText, ChevronDown, RotateCcw, Download, Info,
  Search, Copy, ShoppingCart, Undo2,
} from 'lucide-react'
import {
  useActivePromotions, useSenderReputation, useSetSenderTrust,
  useProspects, usePromoteProspect, useDismissProspect, useRestoreProspect, useProspectAttachments,
  type PromotionDto, type ProspectDto,
} from '../hooks/queries/usePromotionsQueries'
import { useNotificationStore } from '../stores'
import { useAuth } from '../contexts/AuthContext'

type Tab = 'promotions' | 'senders' | 'prospects'

export default function Promotions() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab) || 'promotions'
  const [tab, setTab] = useState<Tab>(['promotions', 'senders', 'prospects'].includes(initialTab) ? initialTab : 'promotions')
  const { availableRestaurants } = useAuth()
  const multiLocation = availableRestaurants.length > 1
  const { data: prospects = [] } = useProspects(multiLocation)

  const selectTab = useCallback((t: Tab) => {
    setTab(t)
    setSearchParams(t === 'promotions' ? {} : { tab: t }, { replace: true })
  }, [setSearchParams])

  // NEW-352: 1 / 2 / 3 switch tabs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const map: Record<string, Tab> = { '1': 'promotions', '2': 'senders', '3': 'prospects' }
      const next = map[e.key]
      if (next) { e.preventDefault(); selectTab(next) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectTab])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-5 h-5 text-wine-700" />
        <h1 className="text-xl font-bold text-gray-900">Vendor offers &amp; senders</h1>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Offers the AI extracted from vendor email, the senders you trust to skip the spoof quarantine, and cold outreach from vendors you haven’t added yet.
      </p>

      <div className="flex gap-1 border-b border-gray-200 mb-5">
        <TabBtn active={tab === 'promotions'} onClick={() => selectTab('promotions')} icon={<Tag className="w-3.5 h-3.5" />}>
          Offers
        </TabBtn>
        <TabBtn active={tab === 'senders'} onClick={() => selectTab('senders')} icon={<ShieldCheck className="w-3.5 h-3.5" />}>
          Trusted senders
        </TabBtn>
        <TabBtn active={tab === 'prospects'} onClick={() => selectTab('prospects')} icon={<UserPlus className="w-3.5 h-3.5" />} badge={prospects.length}>
          Prospects
        </TabBtn>
      </div>

      {tab === 'promotions' ? <PromotionsTab /> : tab === 'senders' ? <SendersTab /> : <ProspectsTab />}
    </div>
  )
}

function TabBtn({ active, onClick, icon, children, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active ? 'text-wine-700 border-wine-700' : 'text-gray-500 border-transparent hover:text-gray-700'
      }`}
    >
      {icon}
      {children}
      {badge != null && badge > 0 && (
        <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold ${active ? 'bg-wine-100 text-wine-700' : 'bg-gray-100 text-gray-500'}`}>
          {badge}
        </span>
      )}
    </button>
  )
}

/* ─── Offers (vendor promotions) ─────────────────────────────────────────────── */

const DISMISSED_KEY = 'wineops.promos.dismissed'

function loadDismissed(): string[] {
  try { const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

function PromotionsTab() {
  const { data: promos = [], isLoading } = useActivePromotions()
  // NEW-342/353: search, filter and sort the offer set.
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'expiring' | 'code' | 'wines'>('all')
  const [sort, setSort] = useState<'expiry' | 'value' | 'vendor'>('expiry')
  /**
   * NEW-339 dismiss. There is no promotions-dismiss endpoint, so this is a
   * local preference (same pattern as the wine-library removals) with an undo
   * window — deliberately not presented as a server-side action.
   */
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed)
  const [undo, setUndo] = useState<PromotionDto | null>(null)
  const [detail, setDetail] = useState<PromotionDto | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)

  const persistDismissed = useCallback((next: string[]) => {
    setDismissed(next)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }, [])

  const dismissPromo = useCallback((p: PromotionDto) => {
    persistDismissed([...loadDismissed().filter(id => id !== p.id), p.id])
    setUndo(p)
    setMenu(null)
    window.setTimeout(() => setUndo(cur => (cur?.id === p.id ? null : cur)), 8000)
  }, [persistDismissed])

  const restorePromo = useCallback((p: PromotionDto) => {
    persistDismissed(loadDismissed().filter(id => id !== p.id))
    setUndo(null)
  }, [persistDismissed])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])

  const discountAmount = (p: PromotionDto) => {
    const dv = p.discount_value ?? {}
    return Number(dv.percent ?? dv.amount ?? 0)
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = promos.filter(p => !dismissed.includes(p.id))
    if (q) {
      out = out.filter(p =>
        `${p.providers?.name ?? ''} ${p.name} ${p.description ?? ''} ${p.promo_type} ${(p.applicable_wines ?? []).join(' ')}`
          .toLowerCase().includes(q),
      )
    }
    if (filter === 'expiring') {
      out = out.filter(p => {
        if (!p.end_date) return false
        const d = Math.ceil((new Date(p.end_date).getTime() - Date.now()) / 86_400_000)
        return d >= 0 && d <= 7
      })
    } else if (filter === 'code') {
      out = out.filter(p => !!(p.conditions ?? {}).code)
    } else if (filter === 'wines') {
      out = out.filter(p => (p.applicable_wines ?? []).length > 0)
    }
    return [...out].sort((a, b) => {
      if (sort === 'vendor') return (a.providers?.name ?? '').localeCompare(b.providers?.name ?? '')
      if (sort === 'value') return discountAmount(b) - discountAmount(a)
      const at = a.end_date ? new Date(a.end_date).getTime() : Infinity
      const bt = b.end_date ? new Date(b.end_date).getTime() : Infinity
      return at - bt
    })
  }, [promos, dismissed, query, filter, sort])

  /** NEW-358: export the visible offer set. */
  const exportCsv = useCallback(() => {
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const header = ['Vendor', 'Offer', 'Type', 'Discount', 'Code', 'Min qty', 'Ends', 'Wines'].join(',')
    const lines = visible.map(p => {
      const dv = p.discount_value ?? {}
      const cond = p.conditions ?? {}
      return [
        q(p.providers?.name), q(p.name), q(p.promo_type),
        q(dv.percent != null ? `${dv.percent}%` : dv.amount != null ? dv.amount : dv.free_shipping ? 'free shipping' : ''),
        q(cond.code), q(cond.min_qty), q(p.end_date?.slice(0, 10)),
        q((p.applicable_wines ?? []).join('; ')),
      ].join(',')
    })
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `promotions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [visible])

  if (isLoading) return <Center><Loader2 className="w-5 h-5 text-wine-300 animate-spin" /></Center>
  if (!promos.length) return <Empty icon={<Tag className="w-5 h-5 text-wine-300" />} text="No active offers yet" hint="As vendors email offers, the AI files them here." />

  return (
    <>
      {/* Toolbar (NEW-342/353/358) */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search offers, vendors, wines…"
            className="w-full h-8 pl-9 pr-3 bg-white border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-wine-100 focus:border-wine-400"
          />
        </div>
        {([
          { key: 'all' as const, label: 'All' },
          { key: 'expiring' as const, label: 'Expiring ≤7d' },
          { key: 'code' as const, label: 'Has code' },
          { key: 'wines' as const, label: 'On my wines' },
        ]).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${filter === f.key ? 'bg-wine-50 text-wine-700 border-wine-200' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'}`}
          >
            {f.label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="h-8 px-2 bg-white border border-gray-200 rounded-lg text-xs text-gray-600 outline-none"
        >
          <option value="expiry">Ending soonest</option>
          <option value="value">Biggest discount</option>
          <option value="vendor">Vendor A–Z</option>
        </select>
        <button
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 bg-white border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:border-gray-300"
        >
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
      </div>

      {visible.length === 0 ? (
        <Empty
          icon={<Tag className="w-5 h-5 text-wine-300" />}
          text="No offers match those filters"
          hint={dismissed.length > 0 ? `${dismissed.length} offer(s) dismissed. Clear filters or restore them.` : 'Try clearing the search or filter.'}
        />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {visible.map((p) => (
            <PromoCard
              key={p.id}
              p={p}
              onOpen={() => setDetail(p)}
              onMenu={(e) => { e.preventDefault(); setMenu({ id: p.id, x: e.clientX, y: e.clientY }) }}
            />
          ))}
        </div>
      )}

      {dismissed.length > 0 && (
        <button
          onClick={() => persistDismissed([])}
          className="mt-3 text-xs font-medium text-gray-400 hover:text-gray-700"
        >
          Restore {dismissed.length} dismissed offer{dismissed.length === 1 ? '' : 's'}
        </button>
      )}

      {/* Right-click menu (NEW-351) */}
      {menu && (() => {
        const p = promos.find(x => x.id === menu.id)
        if (!p) return null
        const code = (p.conditions ?? {}).code
        const Item = ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) => (
          <button
            onClick={onClick}
            disabled={disabled}
            className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 rounded-lg disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {label}
          </button>
        )
        return (
          <div
            className="fixed z-[60] w-52 bg-white border border-gray-200 rounded-xl shadow-xl p-1"
            style={{ top: Math.min(menu.y, window.innerHeight - 200), left: Math.min(menu.x, window.innerWidth - 220) }}
            onClick={(e) => e.stopPropagation()}
          >
            <Item label="View details" onClick={() => { setDetail(p); setMenu(null) }} />
            <Item
              label="Apply to a new order"
              onClick={() => {
                const params = new URLSearchParams({ new: '1', promo: p.id })
                if (p.provider_id) params.set('provider', p.provider_id)
                window.location.href = `/orders?${params.toString()}`
              }}
            />
            <Item label="Copy code" disabled={!code} onClick={() => { navigator.clipboard?.writeText(String(code)); setMenu(null) }} />
            <Item label="Dismiss" onClick={() => dismissPromo(p)} />
          </div>
        )
      })()}

      {/* Detail sheet (NEW-340) */}
      {detail && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null) }}>
          <div className="absolute inset-0 bg-gray-900/40" aria-hidden />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-gray-200 p-5" role="dialog" aria-modal="true">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-wine-700">{detail.promo_type.replace(/_/g, ' ')}</p>
                <h3 className="text-base font-bold text-gray-900 mt-0.5">{detail.providers?.name ?? 'A vendor'}</h3>
              </div>
              <button onClick={() => setDetail(null)} className="p-1 text-gray-400 hover:bg-gray-100 rounded-lg" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            {detail.description && <p className="text-sm text-gray-600 mb-3">{detail.description}</p>}
            <dl className="text-sm space-y-1.5 mb-4">
              {Object.entries(detail.discount_value ?? {}).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-gray-400 capitalize">{k.replace(/_/g, ' ')}</dt>
                  <dd className="text-gray-800 font-medium">{String(v)}</dd>
                </div>
              ))}
              {Object.entries(detail.conditions ?? {}).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-gray-400 capitalize">{k.replace(/_/g, ' ')}</dt>
                  <dd className="text-gray-800 font-medium">{String(v)}</dd>
                </div>
              ))}
              {detail.end_date && (
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-400">Ends</dt>
                  <dd className="text-gray-800 font-medium">{new Date(detail.end_date).toLocaleDateString()}</dd>
                </div>
              )}
              {detail.confidence != null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-400">Extraction confidence</dt>
                  <dd className="text-gray-800 font-medium">{Math.round(detail.confidence * 100)}%</dd>
                </div>
              )}
            </dl>
            {(detail.applicable_wines ?? []).length > 0 && (
              <div className="mb-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 mb-1">Applies to</p>
                <p className="text-xs text-gray-600 leading-relaxed">{(detail.applicable_wines ?? []).join(', ')}</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const params = new URLSearchParams({ new: '1', promo: detail.id })
                  if (detail.provider_id) params.set('provider', detail.provider_id)
                  window.location.href = `/orders?${params.toString()}`
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold text-white bg-wine-600 hover:bg-wine-700 rounded-lg"
              >
                <ShoppingCart className="w-4 h-4" /> Apply to a new order
              </button>
              {(detail.conditions ?? {}).code && (
                <button
                  onClick={() => navigator.clipboard?.writeText(String((detail.conditions ?? {}).code))}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
                >
                  <Copy className="w-4 h-4" /> Code
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Undo dismissal */}
      {undo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 px-4 py-3 bg-gray-900 text-white rounded-xl shadow-xl">
          <span className="text-sm">Offer dismissed</span>
          <button onClick={() => restorePromo(undo)} className="flex items-center gap-1.5 text-sm font-semibold text-amber-300 hover:text-amber-200">
            <Undo2 className="w-4 h-4" /> Undo
          </button>
        </div>
      )}
    </>
  )
}

function PromoCard({ p, onOpen, onMenu }: { p: PromotionDto; onOpen?: () => void; onMenu?: (e: React.MouseEvent) => void }) {
  const dv = p.discount_value ?? {}
  const cond = p.conditions ?? {}
  const priority = String(cond.priority ?? '')
  const wines = p.applicable_wines ?? []
  const days = p.end_date ? Math.ceil((new Date(p.end_date).getTime() - Date.now()) / 86_400_000) : null
  const discount =
    dv.percent != null ? `${dv.percent}% off`
      : dv.amount != null ? `${dv.currency === 'EUR' ? '€' : dv.currency === 'GBP' ? '£' : '$'}${dv.amount} off`
      : dv.free_shipping ? 'Free shipping' : ''

  return (
    <div
      onClick={onOpen}
      onContextMenu={onMenu}
      className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-wine-200 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-wine-800 bg-wine-50 border border-wine-100 rounded-full px-2 py-0.5">
          {p.promo_type.replace(/_/g, ' ')}
        </span>
        {priority === 'interrupt' && <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Priority</span>}
      </div>
      <p className="text-sm font-semibold text-gray-900 leading-snug mb-0.5">{p.providers?.name ?? 'A vendor'}</p>
      {discount && <p className="text-lg font-bold text-wine-700 leading-none my-1">{discount}</p>}
      {p.description && <p className="text-xs text-gray-500 leading-relaxed mb-2">{p.description}</p>}

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {cond.min_qty != null && <Chip>{cond.min_qty}+ bottles</Chip>}
        {cond.code && <Chip mono>code {cond.code}</Chip>}
        {p.end_date && (
          <span className={`inline-flex items-center gap-1 text-[10px] font-medium rounded-full px-2 py-0.5 border ${days != null && days <= 7 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-gray-500 bg-gray-50 border-gray-100'}`}>
            <Clock className="w-3 h-3" />
            {days != null && days >= 0 ? `${days}d left` : 'expired'}
          </span>
        )}
      </div>

      {wines.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-gray-100">
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 mb-1">On {wines.length} wine{wines.length !== 1 ? 's' : ''} you buy</p>
          <p className="text-[11px] text-gray-600 truncate">{wines.slice(0, 3).join(', ')}{wines.length > 3 ? ` +${wines.length - 3}` : ''}</p>
        </div>
      )}
    </div>
  )
}

/* ─── Trusted senders ────────────────────────────────────────────────────────── */

function SendersTab() {
  const { data: senders = [], isLoading } = useSenderReputation()
  const setTrust = useSetSenderTrust()
  if (isLoading) return <Center><Loader2 className="w-5 h-5 text-wine-300 animate-spin" /></Center>
  if (!senders.length) return <Empty icon={<ShieldCheck className="w-5 h-5 text-wine-300" />} text="No sender records yet" hint="Domains appear here as vendors email you; trust one to skip the SPF/DKIM quarantine." />

  return (
    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
      {senders.map((s) => (
        <div key={s.id} className="flex items-center gap-3 px-4 py-3">
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${s.suspended ? 'bg-red-50' : s.trusted ? 'bg-emerald-50' : 'bg-gray-50'}`}>
            {s.suspended ? <ShieldOff className="w-4 h-4 text-red-600" /> : s.trusted ? <ShieldCheck className="w-4 h-4 text-emerald-600" /> : <ShieldAlert className="w-4 h-4 text-gray-400" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 font-mono truncate">{s.domain}</p>
            <p className="text-[11px] text-gray-500">
              {s.suspended ? <span className="text-red-600">{s.suspended_reason || 'suspended'}</span>
                : s.trusted ? 'trusted — bypasses the SPF/DKIM quarantine'
                : 'not trusted'}
              {(s.injection_signals > 0 || s.spam_signals > 0) && (
                <span className="text-amber-600"> · {s.injection_signals} injection, {s.spam_signals} spam</span>
              )}
            </p>
          </div>
          <button
            type="button"
            disabled={setTrust.isPending}
            onClick={() => setTrust.mutate({ domain: s.domain, trusted: !(s.trusted && !s.suspended) })}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-60 flex-shrink-0 ${
              s.trusted && !s.suspended
                ? 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            {s.trusted && !s.suspended ? 'Untrust' : <><Check className="w-3.5 h-3.5" /> Trust</>}
          </button>
        </div>
      ))}
      <div className="flex items-start gap-2 px-4 py-2.5 bg-gray-50/60">
        <AlertTriangle className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
        <p className="text-[11px] text-gray-500">Trust only lifts the sender-verification gate — every other guardrail still applies, and trust auto-suspends on an injection attempt or spam.</p>
      </div>
    </div>
  )
}

/* ─── Prospects (D1 — cold-email vendor outreach) ─────────────────────────────── */

function ProspectsTab() {
  const { availableRestaurants } = useAuth()
  const multiLocation = availableRestaurants.length > 1
  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of availableRestaurants) m.set(b.id, b.name)
    return m
  }, [availableRestaurants])

  const { data: prospects = [], isLoading, isError, refetch } = useProspects(multiLocation)
  const promote = usePromoteProspect()
  const dismiss = useDismissProspect()
  const restore = useRestoreProspect()
  const toast = useNotificationStore()
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null)
  // Which locations are hidden (empty = show all). Reply/promote is always row-scoped, never "all".
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  if (isLoading) return <Center><Loader2 className="w-5 h-5 text-wine-300 animate-spin" /></Center>

  // Distinguish "couldn't load" from "working but quiet" — otherwise both look identical.
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center mb-3">
          <AlertTriangle className="w-5 h-5 text-red-400" />
        </div>
        <p className="text-sm font-semibold text-gray-600">Couldn’t load prospects</p>
        <p className="text-xs text-gray-400 mt-1 max-w-[280px] leading-relaxed">Something went wrong reaching the server. This is different from having no prospects.</p>
        <button type="button" onClick={() => refetch()} className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100">
          <RotateCcw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    )
  }

  const onPromote = async (p: ProspectDto) => {
    const res = await promote.mutateAsync(p.id)
    if (res.promoted) {
      toast.success(res.reused ? 'Vendor already existed — linked' : 'Added as vendor', `${p.sender_name || p.domain} is now in your vendors.`)
    } else {
      toast.error('Couldn’t add vendor', 'Please try again.')
    }
  }

  const onDismiss = async (p: ProspectDto) => {
    await dismiss.mutateAsync(p.id)
    setUndo({ id: p.id, name: p.sender_name || p.domain })
    window.setTimeout(() => setUndo((u) => (u?.id === p.id ? null : u)), 8000)
  }

  const onUndo = async () => {
    if (!undo) return
    const res = await restore.mutateAsync(undo.id)
    if (res.restored) toast.info('Prospect restored', `${undo.name} is back in your list.`)
    setUndo(null)
  }

  const toggleLoc = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const chips = multiLocation ? (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-gray-400 mr-0.5">Locations:</span>
      {availableRestaurants.map((b) => {
        const active = !hidden.has(b.id)
        const count = prospects.filter((p) => p.restaurant_id === b.id).length
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => toggleLoc(b.id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${active ? 'bg-wine-50 border-wine-200 text-wine-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}
          >
            {b.name}
            <span className={`text-[9px] ${active ? 'text-wine-500' : 'text-gray-300'}`}>{count}</span>
          </button>
        )
      })}
    </div>
  ) : null

  const visible = multiLocation ? prospects.filter((p) => p.restaurant_id && !hidden.has(p.restaurant_id)) : prospects

  if (!prospects.length) {
    return (
      <div className="space-y-3">
        {chips}
        {undo && <UndoBar name={undo.name} onUndo={onUndo} onClose={() => setUndo(null)} busy={restore.isPending} />}
        <Empty
          icon={<UserPlus className="w-5 h-5 text-wine-300" />}
          text="No prospects right now"
          hint="This lane is active and listening. Genuine outreach from vendors you haven’t added — an intro or a catalogue — will land here automatically."
        />
      </div>
    )
  }

  const busy = promote.isPending || dismiss.isPending
  return (
    <div className="space-y-3">
      {chips}
      {undo && <UndoBar name={undo.name} onUndo={onUndo} onClose={() => setUndo(null)} busy={restore.isPending} />}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {visible.map((p) => (
          <ProspectRow
            key={p.id}
            p={p}
            restaurantName={multiLocation && p.restaurant_id ? nameById.get(p.restaurant_id) ?? null : null}
            onPromote={() => onPromote(p)}
            onDismiss={() => onDismiss(p)}
            busy={busy}
          />
        ))}
        {!visible.length && (
          <div className="px-4 py-6 text-center text-[12px] text-gray-400">No prospects for the selected location{hidden.size !== 1 ? 's' : ''}.</div>
        )}
        <div className="flex items-start gap-2 px-4 py-2.5 bg-gray-50/60">
          <AlertTriangle className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
          <p className="text-[11px] text-gray-500">Prospects are never auto-replied to and their content is treated as untrusted. Add one as a vendor to create a supplier you can order from.</p>
        </div>
      </div>
    </div>
  )
}

function UndoBar({ name, onUndo, onClose, busy }: { name: string; onUndo: () => void; onClose: () => void; busy: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-gray-900 text-white">
      <span className="text-xs">Dismissed <span className="font-semibold">{name}</span>.</span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy} onClick={onUndo} className="inline-flex items-center gap-1 text-xs font-semibold text-white hover:text-wine-200 disabled:opacity-60">
          <RotateCcw className="w-3.5 h-3.5" /> Undo
        </button>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  )
}

function ProspectRow({ p, restaurantName, onPromote, onDismiss, busy }: { p: ProspectDto; restaurantName?: string | null; onPromote: () => void; onDismiss: () => void; busy: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const reasons = (p.capture_reason || '').split('+').filter(Boolean)
  const hasBody = Boolean(p.body_preview || p.snippet)
  const { data: attachments = [], isLoading: attsLoading } = useProspectAttachments(p.id, expanded && p.has_attachments)

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="w-8 h-8 rounded-lg bg-wine-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Mail className="w-4 h-4 text-wine-600" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-semibold text-gray-900 truncate">{p.sender_name || p.domain}</p>
            {p.message_count > 1 && <span className="text-[9px] font-medium text-gray-400">{p.message_count} emails</span>}
            {restaurantName && (
              <span className="inline-flex items-center text-[9px] font-semibold text-wine-700 bg-wine-50 border border-wine-100 rounded-full px-1.5 py-0.5">
                {restaurantName}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 font-mono truncate">{p.sender_email || p.domain}</p>
          {p.subject && <p className="text-[11.5px] text-gray-700 mt-0.5 truncate">{p.subject}</p>}
          {p.snippet && <p className="text-[11px] text-gray-400 mt-0.5 line-clamp-2 leading-relaxed">{p.snippet}</p>}

          {/* Provenance — why this was captured, so it never feels like a random email. */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            {reasons.includes('attachment') && <ProvChip icon={<Paperclip className="w-2.5 h-2.5" />}>has attachment</ProvChip>}
            {reasons.includes('promotional') && <ProvChip icon={<Tag className="w-2.5 h-2.5" />}>looks promotional</ProvChip>}
            {!reasons.length && <ProvChip icon={<Info className="w-2.5 h-2.5" />}>vendor outreach</ProvChip>}
            {(hasBody || p.has_attachments) && (
              <button type="button" onClick={() => setExpanded((v) => !v)} className="inline-flex items-center gap-1 text-[10px] font-medium text-wine-700 hover:text-wine-800">
                <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                {expanded ? 'Hide' : 'View message'}
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 flex-shrink-0">
          {confirming ? (
            <>
              <button type="button" disabled={busy} onClick={onPromote} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 transition-colors">
                <Check className="w-3.5 h-3.5" /> Confirm
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-60 transition-colors">
                Cancel
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={() => setConfirming(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 disabled:opacity-60 transition-colors">
                <UserPlus className="w-3.5 h-3.5" /> Add as vendor
              </button>
              <button type="button" disabled={busy} onClick={onDismiss} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 disabled:opacity-60 transition-colors">
                <X className="w-3.5 h-3.5" /> Dismiss
              </button>
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-2.5 ml-11 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          {hasBody && <p className="text-[11.5px] text-gray-600 whitespace-pre-wrap leading-relaxed">{p.body_preview || p.snippet}</p>}
          {p.has_attachments && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1.5">Attachments</p>
              {attsLoading ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400"><Loader2 className="w-3 h-3 animate-spin" /> loading…</span>
              ) : attachments.length ? (
                <div className="flex flex-col gap-1">
                  {attachments.map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="text-[11.5px] text-gray-700 truncate flex-1">{a.filename}</span>
                      {a.size_bytes != null && <span className="text-[10px] text-gray-400">{formatBytes(a.size_bytes)}</span>}
                      {a.url && (
                        <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] font-semibold text-wine-700 hover:text-wine-800">
                          <Download className="w-3 h-3" /> open
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] text-gray-400">No downloadable copy stored.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ProvChip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-semibold text-gray-500 bg-gray-50 border border-gray-100 rounded-full px-1.5 py-0.5">
      {icon} {children}
    </span>
  )
}

/* ─── shared ─────────────────────────────────────────────────────────────────── */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function Chip({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span className={`inline-flex items-center text-[10px] font-medium rounded-full px-2 py-0.5 border text-gray-500 bg-gray-50 border-gray-100 ${mono ? 'font-mono' : ''}`}>
      {children}
    </span>
  )
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center py-24">{children}</div>
}

function Empty({ icon, text, hint }: { icon: React.ReactNode; text: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-12 h-12 rounded-xl bg-wine-50 border border-wine-100 flex items-center justify-center mb-3">{icon}</div>
      <p className="text-sm font-semibold text-gray-600">{text}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-[280px] leading-relaxed">{hint}</p>
    </div>
  )
}
