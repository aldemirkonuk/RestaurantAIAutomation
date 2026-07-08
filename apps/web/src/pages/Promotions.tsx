import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Tag, ShieldCheck, ShieldAlert, ShieldOff, Clock, Sparkles, Loader2, AlertTriangle, Check,
  UserPlus, X, Paperclip, Mail, FileText, ChevronDown, RotateCcw, Download, Info,
} from 'lucide-react'
import {
  useActivePromotions, useSenderReputation, useSetSenderTrust,
  useProspects, usePromoteProspect, useDismissProspect, useRestoreProspect, useProspectAttachments,
  type PromotionDto, type ProspectDto,
} from '../hooks/queries/usePromotionsQueries'
import { useNotificationStore } from '../stores'

type Tab = 'promotions' | 'senders' | 'prospects'

export default function Promotions() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab) || 'promotions'
  const [tab, setTab] = useState<Tab>(['promotions', 'senders', 'prospects'].includes(initialTab) ? initialTab : 'promotions')
  const { data: prospects = [] } = useProspects()

  const selectTab = (t: Tab) => {
    setTab(t)
    setSearchParams(t === 'promotions' ? {} : { tab: t }, { replace: true })
  }

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

function PromotionsTab() {
  const { data: promos = [], isLoading } = useActivePromotions()
  if (isLoading) return <Center><Loader2 className="w-5 h-5 text-wine-300 animate-spin" /></Center>
  if (!promos.length) return <Empty icon={<Tag className="w-5 h-5 text-wine-300" />} text="No active offers yet" hint="As vendors email offers, the AI files them here." />
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
  const { data: prospects = [], isLoading, isError, refetch } = useProspects()
  const promote = usePromoteProspect()
  const dismiss = useDismissProspect()
  const restore = useRestoreProspect()
  const toast = useNotificationStore()
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null)

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

  if (!prospects.length) {
    return (
      <>
        {undo && <UndoBar name={undo.name} onUndo={onUndo} onClose={() => setUndo(null)} busy={restore.isPending} />}
        <Empty
          icon={<UserPlus className="w-5 h-5 text-wine-300" />}
          text="No prospects right now"
          hint="This lane is active and listening. Genuine outreach from vendors you haven’t added — an intro or a catalogue — will land here automatically."
        />
      </>
    )
  }

  const busy = promote.isPending || dismiss.isPending
  return (
    <div className="space-y-3">
      {undo && <UndoBar name={undo.name} onUndo={onUndo} onClose={() => setUndo(null)} busy={restore.isPending} />}
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {prospects.map((p) => <ProspectRow key={p.id} p={p} onPromote={() => onPromote(p)} onDismiss={() => onDismiss(p)} busy={busy} />)}
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

function ProspectRow({ p, onPromote, onDismiss, busy }: { p: ProspectDto; onPromote: () => void; onDismiss: () => void; busy: boolean }) {
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
