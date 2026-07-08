import { useState } from 'react'
import {
  Tag, ShieldCheck, ShieldAlert, ShieldOff, Clock, Sparkles, Loader2, AlertTriangle, Check,
} from 'lucide-react'
import {
  useActivePromotions, useSenderReputation, useSetSenderTrust,
  type PromotionDto,
} from '../hooks/queries/usePromotionsQueries'

type Tab = 'promotions' | 'senders'

export default function Promotions() {
  const [tab, setTab] = useState<Tab>('promotions')
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="w-5 h-5 text-wine-700" />
        <h1 className="text-xl font-bold text-gray-900">Promotions & trusted senders</h1>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        Vendor offers the AI extracted from inbound email, and the senders you trust to skip the spoof quarantine.
      </p>

      <div className="flex gap-1 border-b border-gray-200 mb-5">
        <TabBtn active={tab === 'promotions'} onClick={() => setTab('promotions')} icon={<Tag className="w-3.5 h-3.5" />}>
          Promotions
        </TabBtn>
        <TabBtn active={tab === 'senders'} onClick={() => setTab('senders')} icon={<ShieldCheck className="w-3.5 h-3.5" />}>
          Trusted senders
        </TabBtn>
      </div>

      {tab === 'promotions' ? <PromotionsTab /> : <SendersTab />}
    </div>
  )
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
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
    </button>
  )
}

/* ─── Promotions ─────────────────────────────────────────────────────────────── */

function PromotionsTab() {
  const { data: promos = [], isLoading } = useActivePromotions()
  if (isLoading) return <Center><Loader2 className="w-5 h-5 text-wine-300 animate-spin" /></Center>
  if (!promos.length) return <Empty icon={<Tag className="w-5 h-5 text-wine-300" />} text="No active promotions yet" hint="As vendors email offers, the AI files them here." />
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
      {promos.map((p) => <PromoCard key={p.id} p={p} />)}
    </div>
  )
}

function PromoCard({ p }: { p: PromotionDto }) {
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
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-wine-800 bg-wine-50 border border-wine-100 rounded-full px-2 py-0.5">
          {p.promo_type.replace(/_/g, ' ')}
        </span>
        {priority === 'interrupt' && <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">Priority</span>}
      </div>
      <p className="text-sm font-semibold text-gray-900 leading-snug mb-0.5">{p.providers?.name ?? 'A supplier'}</p>
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

/* ─── shared ─────────────────────────────────────────────────────────────────── */

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
      <p className="text-xs text-gray-400 mt-1 max-w-[260px] leading-relaxed">{hint}</p>
    </div>
  )
}
