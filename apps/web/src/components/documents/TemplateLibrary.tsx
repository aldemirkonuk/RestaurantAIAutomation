import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mail,
  MessageSquare,
  Search,
  Edit3,
  Copy,
  Trash2,
  Send,
  Star,
  Crown,
  MoreVertical,
  Check,
  AlertCircle,
  Phone,
  Package,
  DollarSign,
  Tag,
  Calendar,
  Bell,
  Clock,
  BarChart3,
  FileText,
  Plus,
  Sparkles,
} from 'lucide-react'
import type { SavedTemplate } from './GmailTemplateBuilder'
import type { SavedSMSTemplate } from './SavedSMSTemplates'
import { defaultTemplates } from '../../data/emailTemplateCategories'
import { useTemplates } from '../../hooks/useTemplates'
import { useUserPreferences } from '../../hooks/useUserPreferences'

// ─── Types ────────────────────────────────────────────────────────────────────

type Channel = 'email' | 'sms'
type NavFilter = 'all' | 'email' | 'sms' | string   // string = category name

interface UnifiedRow {
  id: string
  name: string
  description: string
  category: string
  channel: Channel
  used_count: number
  last_modified: Date
  created_at: Date
  isDefault?: boolean
  isAI?: boolean
  // originals for action handlers
  _email?: SavedTemplate
  _sms?: SavedSMSTemplate
}

interface TemplateLibraryProps {
  onNewEmailTemplate: () => void
  onEditEmailTemplate: (template: SavedTemplate) => void
  onNewSMSTemplate: () => void
  onEditSMSTemplate: (template: SavedSMSTemplate) => void
}

// ─── Static SMS defaults (mirrors SavedSMSTemplates.tsx) ─────────────────────

const SMS_DEFAULTS: SavedSMSTemplate[] = [
  {
    id: 'sms-default-1',
    name: 'Low Stock Alert',
    description: 'Notify manager when wine stock is low',
    content: 'Alert: {{wine_name}} is running low ({{current_stock}} bottles). Reorder threshold: {{threshold}}. Order now to avoid stockout.',
    category: 'alert',
    variables: ['wine_name', 'current_stock', 'threshold'],
    created_at: new Date('2024-01-01'),
    last_modified: new Date('2024-01-01'),
    used_count: 45,
  },
  {
    id: 'sms-default-2',
    name: 'Order Confirmation',
    description: 'Confirm order placement with provider',
    content: 'Order #{{order_id}} confirmed! {{quantity}} bottles of {{wine_name}} from {{provider}}. Expected delivery: {{delivery_date}}.',
    category: 'confirmation',
    variables: ['order_id', 'quantity', 'wine_name', 'provider', 'delivery_date'],
    created_at: new Date('2024-01-01'),
    last_modified: new Date('2024-01-01'),
    used_count: 32,
  },
  {
    id: 'sms-default-3',
    name: 'Delivery Reminder',
    description: 'Remind about upcoming delivery',
    content: 'Reminder: Wine delivery scheduled for {{delivery_date}} at {{delivery_time}}. {{total_bottles}} bottles from {{provider}}. Please ensure someone is available.',
    category: 'reminder',
    variables: ['delivery_date', 'delivery_time', 'total_bottles', 'provider'],
    created_at: new Date('2024-01-01'),
    last_modified: new Date('2024-01-01'),
    used_count: 28,
  },
  {
    id: 'sms-default-4',
    name: 'Weekly Inventory Summary',
    description: 'Weekly inventory status summary',
    content: 'Weekly Inventory: {{total_bottles}} bottles ({{healthy_count}} healthy, {{low_count}} low, {{critical_count}} critical). Total value: ${{total_value}}.',
    category: 'alert',
    variables: ['total_bottles', 'healthy_count', 'low_count', 'critical_count', 'total_value'],
    created_at: new Date('2024-01-01'),
    last_modified: new Date('2024-01-01'),
    used_count: 20,
  },
  {
    id: 'sms-default-5',
    name: 'Special Promotion',
    description: 'Announce special wine promotions',
    content: '🍷 Special Offer! {{wine_name}} now {{discount}}% off. Limited to {{quantity}} bottles. Valid until {{end_date}}. Reply YES to order.',
    category: 'promotion',
    variables: ['wine_name', 'discount', 'quantity', 'end_date'],
    created_at: new Date('2024-01-01'),
    last_modified: new Date('2024-01-01'),
    used_count: 15,
  },
]

const SMS_CATEGORIES = new Set(['promotion', 'appointment', 'alert', 'confirmation', 'reminder'])

// ─── Category display config ──────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { label: string; icon: React.ElementType; dot: string }> = {
  inventory:    { label: 'Inventory',     icon: Package,      dot: 'bg-blue-500' },
  financial:    { label: 'Financial',     icon: DollarSign,   dot: 'bg-emerald-500' },
  order:        { label: 'Orders',        icon: Send,         dot: 'bg-violet-500' },
  promotion:    { label: 'Promotions',    icon: Tag,          dot: 'bg-pink-500' },
  appointment:  { label: 'Appointments', icon: Calendar,     dot: 'bg-sky-500' },
  alert:        { label: 'Alerts',        icon: Bell,         dot: 'bg-rose-500' },
  confirmation: { label: 'Confirmations',icon: Check,        dot: 'bg-teal-500' },
  reminder:     { label: 'Reminders',     icon: Clock,        dot: 'bg-amber-500' },
  custom:       { label: 'Custom',        icon: FileText,     dot: 'bg-gray-400' },
}

function getCatConfig(cat: string) {
  return CATEGORY_CONFIG[cat] ?? { label: cat, icon: FileText, dot: 'bg-gray-400' }
}

function relativeDate(d: Date): string {
  const diff = Date.now() - new Date(d).getTime()
  const mins  = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  const weeks = Math.floor(days / 7)
  if (mins  < 60)  return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days  === 1) return 'Yesterday'
  if (days  < 7)   return `${days}d ago`
  if (weeks === 1) return '1 week ago'
  if (weeks < 5)   return `${weeks} weeks ago`
  return new Date(d).toLocaleDateString()
}

// ─── Shared grid column definition ───────────────────────────────────────────
// Must be identical between header and rows to prevent column mismatch.
const GRID = 'grid grid-cols-[minmax(0,1fr)_96px_140px_104px]'

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplateLibrary({
  onNewEmailTemplate,
  onEditEmailTemplate,
  onNewSMSTemplate,
  onEditSMSTemplate,
}: TemplateLibraryProps) {
  const { templates: apiTemplates, deleteTemplate: apiDelete, createTemplate: apiCreate, updateTemplate: apiUpdate } = useTemplates()
  const { preferences, updatePreferences } = useUserPreferences()

  // ── State ──────────────────────────────────────────────────────────────────
  const [navFilter, setNavFilter] = useState<NavFilter>('all')
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'usage'>('recent')
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)

  // Send modals
  const [sendEmailModal, setSendEmailModal] = useState<UnifiedRow | null>(null)
  const [sendSMSModal, setSendSMSModal] = useState<UnifiedRow | null>(null)
  const [sendTo, setSendTo] = useState('')
  const [sending, setSending] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)

  const emailFavorites: string[] = preferences.templateFavorites ?? []
  const smsFavorites: string[]   = (preferences as any).smsFavorites ?? []
  const emailDefaults = preferences.templateDefaults ?? {}
  const defaultEmailId = emailDefaults['email']?.templateId ?? null
  const defaultSMSId   = (preferences as any).smsDefaultTemplate ?? null

  // ── Build unified rows ─────────────────────────────────────────────────────

  const rows = useMemo<UnifiedRow[]>(() => {
    // Email defaults
    const emailRows: UnifiedRow[] = defaultTemplates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description ?? '',
      category: (t.category || 'custom').toLowerCase().trim(),
      channel: 'email',
      used_count: 0,
      last_modified: new Date(t.updatedAt),
      created_at: new Date(t.createdAt),
      isDefault: defaultEmailId === t.id,
      _email: {
        id: t.id,
        name: t.name,
        description: t.description ?? '',
        subject: t.subject,
        category: (t.category || 'custom').toLowerCase().trim() as any,
        panels: t.panels.map(p => ({
          id: p.id,
          type: 'text' as any,
          title: '',
          content: p.config,
          config: { backgroundColor: '#FFFFFF', textColor: '#1F2937', fontSize: 'medium' as const, padding: 'medium' as const, alignment: 'left' as const, borderRadius: 'medium' as const },
        })),
        thumbnail: '',
        created_at: new Date(t.createdAt),
        last_modified: new Date(t.updatedAt),
        used_count: 0,
      },
    }))

    // SMS defaults
    const smsRows: UnifiedRow[] = SMS_DEFAULTS.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      channel: 'sms',
      used_count: t.used_count,
      last_modified: t.last_modified,
      created_at: t.created_at,
      isDefault: defaultSMSId === t.id,
      _sms: t,
    }))

    // API templates — classify by category
    const apiRows: UnifiedRow[] = apiTemplates.map(t => {
      const cat = (t.category || 'custom').toLowerCase().trim()
      const channel: Channel = SMS_CATEGORIES.has(cat) ? 'sms' : 'email'
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        category: cat,
        channel,
        used_count: t.used_count,
        last_modified: new Date(t.last_modified),
        created_at: new Date(t.created_at),
        isDefault: channel === 'email' ? defaultEmailId === t.id : defaultSMSId === t.id,
        _email: channel === 'email' ? t : undefined,
        _sms: channel === 'sms' ? {
          id: t.id,
          name: t.name,
          description: t.description,
          content: (t.panels?.[0] as any)?.content ?? '',
          category: cat as any,
          variables: [],
          created_at: new Date(t.created_at),
          last_modified: new Date(t.last_modified),
          used_count: t.used_count,
        } : undefined,
      }
    })

    // Merge, deduplicate
    const combined = [...emailRows, ...smsRows, ...apiRows]
    return combined.filter((r, i, arr) => arr.findIndex(x => x.id === r.id) === i)
  }, [apiTemplates, defaultEmailId, defaultSMSId])

  // ── Filtered + sorted rows ─────────────────────────────────────────────────

  const visible = useMemo<UnifiedRow[]>(() => {
    let out = [...rows]

    if (navFilter === 'email')     out = out.filter(r => r.channel === 'email')
    else if (navFilter === 'sms')  out = out.filter(r => r.channel === 'sms')
    else if (navFilter !== 'all')  out = out.filter(r => r.category === navFilter)

    if (search) {
      const q = search.toLowerCase()
      out = out.filter(r =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      )
    }

    return out.sort((a, b) => {
      switch (sortBy) {
        case 'name':  return a.name.localeCompare(b.name)
        case 'usage': return b.used_count - a.used_count
        default:      return new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime()
      }
    })
  }, [rows, navFilter, search, sortBy])

  // ── Grouped visible rows ───────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const map = new Map<string, UnifiedRow[]>()
    visible.forEach(r => {
      const key = r.category
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    })
    return Array.from(map.entries())
  }, [visible])

  // ── Sidebar use-case categories (derived from actual data) ─────────────────

  const presentCategories = useMemo(() =>
    Array.from(new Set(rows.map(r => r.category))),
    [rows]
  )

  // ── Close menu on outside click ────────────────────────────────────────────

  useEffect(() => {
    if (!openMenu) return
    const handler = () => setOpenMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [openMenu])

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleDuplicate = useCallback(async (row: UnifiedRow) => {
    try {
      if (row._email) {
        const { id: _id, ...rest } = row._email
        await apiCreate({ ...rest, name: `${row.name} (Copy)`, created_at: new Date(), last_modified: new Date(), used_count: 0 })
      } else if (row._sms) {
        await apiCreate({
          name: `${row.name} (Copy)`,
          description: row.description,
          category: row.category as any,
          subject: '',
          thumbnail: '',
          panels: [{ id: 'sms-body', type: 'text' as any, title: '', content: row._sms.content, config: {} as any }],
          created_at: new Date(),
          last_modified: new Date(),
          used_count: 0,
        })
      }
    } catch { /* ignore */ }
  }, [apiCreate])

  const handleDelete = useCallback(async (row: UnifiedRow) => {
    if (!confirm(`Delete "${row.name}"?\n\nThis action cannot be undone.`)) return
    try { await apiDelete(row.id) } catch { /* ignore */ }
  }, [apiDelete])

  const handleToggleFavorite = useCallback((row: UnifiedRow) => {
    if (row.channel === 'email') {
      const next = emailFavorites.includes(row.id)
        ? emailFavorites.filter(id => id !== row.id)
        : [...emailFavorites, row.id]
      updatePreferences({ templateFavorites: next })
    } else {
      const next = smsFavorites.includes(row.id)
        ? smsFavorites.filter(id => id !== row.id)
        : [...smsFavorites, row.id]
      updatePreferences({ smsFavorites: next } as any)
    }
  }, [emailFavorites, smsFavorites, updatePreferences])

  const handleSetDefault = useCallback((row: UnifiedRow) => {
    if (row.channel === 'email') {
      if (defaultEmailId === row.id) {
        const next = { ...emailDefaults }; delete next['email']
        updatePreferences({ templateDefaults: next })
      } else {
        updatePreferences({ templateDefaults: { ...emailDefaults, email: { templateId: row.id, templateName: row.name } } })
      }
    } else {
      updatePreferences({ smsDefaultTemplate: defaultSMSId === row.id ? null : row.id } as any)
    }
    setOpenMenu(null)
  }, [defaultEmailId, defaultSMSId, emailDefaults, updatePreferences])

  const handleUse = useCallback((row: UnifiedRow) => {
    setSendTo('')
    setSendSuccess(false)
    if (row.channel === 'email') setSendEmailModal(row)
    else setSendSMSModal(row)
  }, [])

  const handleSendEmail = useCallback(async () => {
    if (!sendTo || !sendEmailModal) return
    setSending(true)
    await new Promise(r => setTimeout(r, 1500))
    try { await apiUpdate(sendEmailModal.id, { used_count: sendEmailModal.used_count + 1, last_modified: new Date() }) } catch { /* ignore */ }
    setSending(false)
    setSendSuccess(true)
    setTimeout(() => { setSendEmailModal(null); setSendTo(''); setSendSuccess(false) }, 2000)
  }, [sendTo, sendEmailModal, apiUpdate])

  const handleSendSMS = useCallback(async () => {
    if (!sendTo || !sendSMSModal) return
    setSending(true)
    await new Promise(r => setTimeout(r, 1500))
    try { await apiUpdate(sendSMSModal.id, { used_count: sendSMSModal.used_count + 1, last_modified: new Date() }) } catch { /* ignore */ }
    setSending(false)
    setSendSuccess(true)
    setTimeout(() => { setSendSMSModal(null); setSendTo(''); setSendSuccess(false) }, 2000)
  }, [sendTo, sendSMSModal, apiUpdate])

  const isFavorite = (row: UnifiedRow) =>
    row.channel === 'email' ? emailFavorites.includes(row.id) : smsFavorites.includes(row.id)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 bg-[#f4f5f7]" style={{ minHeight: 'calc(100vh - 160px)' }}>

      {/* ── Sidebar ── */}
      <aside className="w-48 flex-shrink-0 bg-white border-r border-gray-100 flex flex-col py-5 px-2.5 gap-0.5 overflow-y-auto">

        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 px-2.5 mb-1.5">Channel</p>

        {([
          { key: 'all',   label: 'All Templates', icon: FileText,      count: rows.length },
          { key: 'email', label: 'Email',          icon: Mail,          count: rows.filter(r => r.channel === 'email').length },
          { key: 'sms',   label: 'SMS',            icon: MessageSquare, count: rows.filter(r => r.channel === 'sms').length },
        ] as const).map(({ key, label, icon: Icon, count }) => (
          <button
            key={key}
            onClick={() => setNavFilter(key)}
            className={[
              'flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left w-full transition-all text-sm',
              navFilter === key
                ? 'bg-[#fdf1f4] text-[#9b1d3a] font-semibold'
                : 'text-gray-600 hover:bg-gray-50',
            ].join(' ')}
          >
            <Icon className="w-4 h-4 flex-shrink-0 opacity-60" />
            <span className="flex-1 truncate">{label}</span>
            <span className={[
              'text-[10px] font-bold px-1.5 py-0.5 rounded-md',
              navFilter === key ? 'bg-[#f9d0da] text-[#9b1d3a]' : 'bg-gray-100 text-gray-500',
            ].join(' ')}>{count}</span>
          </button>
        ))}

        <div className="h-px bg-gray-100 mx-1 my-3" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 px-2.5 mb-1.5">Use Case</p>

        {presentCategories.map(cat => {
          const cfg = getCatConfig(cat)
          const Icon = cfg.icon
          const count = rows.filter(r => r.category === cat).length
          return (
            <button
              key={cat}
              onClick={() => setNavFilter(cat)}
              className={[
                'flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left w-full transition-all text-sm',
                navFilter === cat
                  ? 'bg-[#fdf1f4] text-[#9b1d3a] font-semibold'
                  : 'text-gray-600 hover:bg-gray-50',
              ].join(' ')}
            >
              <Icon className="w-4 h-4 flex-shrink-0 opacity-60" />
              <span className="flex-1 truncate">{cfg.label}</span>
              <span className={[
                'text-[10px] font-bold px-1.5 py-0.5 rounded-md',
                navFilter === cat ? 'bg-[#f9d0da] text-[#9b1d3a]' : 'bg-gray-100 text-gray-500',
              ].join(' ')}>{count}</span>
            </button>
          )
        })}

        {/* New Template CTA */}
        <div className="mt-auto pt-4 px-0.5">
          <button
            onClick={() => setShowNewModal(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:brightness-110"
            style={{ background: '#9b1d3a' }}
          >
            <Plus className="w-4 h-4" />
            New Template
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 overflow-y-auto flex flex-col min-w-0">

        {/* Page header */}
        <div className="px-7 pt-7 pb-4 bg-[#f4f5f7]">
          <div className="flex items-end justify-between gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Templates</h1>
              <p className="text-sm text-gray-500 mt-0.5">{rows.length} template{rows.length !== 1 ? 's' : ''} — Email &amp; SMS</p>
            </div>
            {/* Search */}
            <div className="relative w-60">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search templates…"
                className="w-full pl-9 pr-4 py-2.5 text-sm bg-white border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:border-[#9b1d3a]/40 transition-all"
              />
            </div>
          </div>

          {/* Sort control */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              {visible.length} result{visible.length !== 1 ? 's' : ''}
              {search ? ` for "${search}"` : ''}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Sort</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                className="text-xs text-gray-600 bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none cursor-pointer"
              >
                <option value="recent">Recently used</option>
                <option value="name">Name A–Z</option>
                <option value="usage">Most used</option>
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="px-7 pb-10">
          {visible.length === 0 ? (
            <EmptyState search={search} onNew={() => setShowNewModal(true)} />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

              {/* Table header */}
              <div className={`${GRID} gap-4 px-5 py-2.5 border-b border-gray-100 bg-gray-50/60`}>
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Name</span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Channel</span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Last used</span>
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400 text-right">Actions</span>
              </div>

              {/* Grouped rows */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${navFilter}-${search}-${sortBy}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  {grouped.map(([cat, catRows]) => (
                    <div key={cat}>
                      {/* Group header — only show when multiple categories visible */}
                      {grouped.length > 1 && (
                        <div className="flex items-center gap-2 px-5 py-2 border-b border-gray-50 bg-gray-50/30">
                          <span className={`w-1.5 h-1.5 rounded-full ${getCatConfig(cat).dot}`} />
                          <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                            {getCatConfig(cat).label}
                          </span>
                          <span className="text-[10px] text-gray-300 font-medium">{catRows.length}</span>
                        </div>
                      )}
                      {catRows.map((row, idx) => (
                        <TemplateRow
                          key={row.id}
                          row={row}
                          isLast={idx === catRows.length - 1}
                          isFav={isFavorite(row)}
                          openMenu={openMenu}
                          defaultEmailId={defaultEmailId}
                          defaultSMSId={defaultSMSId}
                          onEdit={() => {
                            if (row._email) onEditEmailTemplate(row._email)
                            else if (row._sms) onEditSMSTemplate(row._sms)
                          }}
                          onDuplicate={() => handleDuplicate(row)}
                          onDelete={() => handleDelete(row)}
                          onUse={() => handleUse(row)}
                          onToggleFav={() => handleToggleFavorite(row)}
                          onSetDefault={() => handleSetDefault(row)}
                          onOpenMenu={id => setOpenMenu(openMenu === id ? null : id)}
                        />
                      ))}
                    </div>
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>

      {/* ── New Template Modal ── */}
      <AnimatePresence>
        {showNewModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
            onClick={() => setShowNewModal(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-gray-900">New Template</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Choose how you'd like to start</p>
                </div>
                <button onClick={() => setShowNewModal(false)} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-all">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="space-y-2.5">
                <NewModalOption
                  icon={<Mail className="w-5 h-5 text-blue-600" />}
                  bg="bg-blue-100 group-hover:bg-blue-200"
                  border="border-blue-100 hover:border-blue-300"
                  title="Email — blank"
                  desc="Drag-and-drop canvas with live preview"
                  onClick={() => { setShowNewModal(false); onNewEmailTemplate() }}
                />
                <NewModalOption
                  icon={<MessageSquare className="w-5 h-5 text-emerald-600" />}
                  bg="bg-emerald-100 group-hover:bg-emerald-200"
                  border="border-emerald-100 hover:border-emerald-300"
                  title="SMS — blank"
                  desc="Short message with live iPhone preview"
                  onClick={() => { setShowNewModal(false); onNewSMSTemplate() }}
                />
                <NewModalOption
                  icon={<Sparkles className="w-5 h-5 text-purple-600" />}
                  bg="bg-purple-100 group-hover:bg-purple-200"
                  border="border-purple-100 hover:border-purple-300"
                  title="AI Generate"
                  desc="Describe what you need, AI writes the draft"
                  onClick={() => { setShowNewModal(false); onNewEmailTemplate() }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Email Send Modal ── */}
      <SendModal
        open={!!sendEmailModal}
        title="Send Email"
        subtitle={sendEmailModal?.name ?? ''}
        inputType="email"
        inputLabel="Recipient Email"
        inputPlaceholder="provider@example.com"
        value={sendTo}
        onChange={setSendTo}
        sending={sending}
        success={sendSuccess}
        onSend={handleSendEmail}
        onClose={() => { setSendEmailModal(null); setSendTo('') }}
        accentClass="focus:ring-blue-500"
        btnClass="bg-blue-600 hover:bg-blue-700"
      />

      {/* ── SMS Send Modal ── */}
      <SendModal
        open={!!sendSMSModal}
        title="Send SMS"
        subtitle={sendSMSModal?.name ?? ''}
        inputType="tel"
        inputLabel="Recipient Phone"
        inputPlaceholder="+1 (555) 000-0000"
        value={sendTo}
        onChange={setSendTo}
        sending={sending}
        success={sendSuccess}
        onSend={handleSendSMS}
        onClose={() => { setSendSMSModal(null); setSendTo('') }}
        accentClass="focus:ring-emerald-500"
        btnClass="bg-emerald-600 hover:bg-emerald-700"
      />
    </div>
  )
}

// ─── TemplateRow ──────────────────────────────────────────────────────────────

interface RowProps {
  row: UnifiedRow
  isLast: boolean
  isFav: boolean
  openMenu: string | null
  defaultEmailId: string | null
  defaultSMSId: string | null
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onUse: () => void
  onToggleFav: () => void
  onSetDefault: () => void
  onOpenMenu: (id: string) => void
}

function TemplateRow({
  row, isLast, isFav, openMenu,
  defaultEmailId, defaultSMSId,
  onEdit, onDuplicate, onDelete, onUse, onToggleFav, onSetDefault, onOpenMenu,
}: RowProps) {
  const cfg = getCatConfig(row.category)
  const Icon = cfg.icon
  const isDefault = row.channel === 'email' ? defaultEmailId === row.id : defaultSMSId === row.id
  const menuOpen = openMenu === row.id

  return (
    <div
      className={[
        GRID,
        'gap-4 items-center px-5 py-4 group transition-colors',
        !isLast ? 'border-b border-gray-50' : '',
        'hover:bg-gray-50/60 cursor-pointer',
      ].join(' ')}
      onClick={onEdit}
    >
      {/* Col 1: Icon + name + badges + description */}
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          row.channel === 'email'
            ? 'bg-blue-50 group-hover:bg-blue-100'
            : 'bg-emerald-50 group-hover:bg-emerald-100'
        } transition-colors`}>
          <Icon className={`w-4 h-4 ${row.channel === 'email' ? 'text-blue-500' : 'text-emerald-500'}`} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{row.name}</span>
            {isDefault && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 text-amber-600 text-[10px] font-semibold rounded-md border border-amber-100 flex-shrink-0">
                <Crown className="w-2.5 h-2.5 fill-amber-500" />Default
              </span>
            )}
            {row.isAI && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-50 text-green-600 text-[10px] font-semibold rounded-md border border-green-100 flex-shrink-0">
                <Sparkles className="w-2.5 h-2.5" />AI
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 truncate mt-0.5 leading-tight">{row.description}</p>
        </div>
      </div>

      {/* Col 2: Channel badge */}
      <div>
        {row.channel === 'email' ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-50 text-blue-600 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />Email
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />SMS
          </span>
        )}
      </div>

      {/* Col 3: Last used */}
      <div className="min-w-0">
        {row.used_count > 0 ? (
          <>
            <p className="text-sm text-gray-600 truncate">{relativeDate(row.last_modified)}</p>
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
              <BarChart3 className="w-3 h-3" />Used {row.used_count}×
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-400 italic">Never used</p>
        )}
      </div>

      {/* Col 4: Actions */}
      <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
        {/* Favorite */}
        <button
          onClick={onToggleFav}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-gray-100 transition-all text-gray-400"
        >
          <Star className={`w-4 h-4 ${isFav ? 'fill-amber-400 text-amber-400' : ''}`} />
        </button>

        {/* Edit */}
        <button
          onClick={onEdit}
          title="Edit"
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-gray-100 transition-all text-gray-400"
        >
          <Edit3 className="w-4 h-4" />
        </button>

        {/* Use */}
        <button
          onClick={onUse}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg text-white transition-all hover:brightness-110"
          style={{ background: '#9b1d3a' }}
        >
          Use<Send className="w-3 h-3" />
        </button>

        {/* ··· Menu */}
        <div className="relative">
          <button
            onClick={e => { e.stopPropagation(); onOpenMenu(row.id) }}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-all text-gray-400"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.1 }}
                className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1 z-30"
                onClick={e => e.stopPropagation()}
              >
                <MenuItem icon={Edit3} label="Edit" onClick={onEdit} />
                <MenuItem icon={Copy} label="Duplicate" onClick={onDuplicate} />
                <div className="h-px bg-gray-100 my-1" />
                <MenuItem
                  icon={isFav ? Star : Star}
                  label={isFav ? 'Remove favorite' : 'Add to favorites'}
                  onClick={onToggleFav}
                />
                <MenuItem
                  icon={Crown}
                  label={isDefault ? 'Remove as default' : 'Set as default'}
                  onClick={onSetDefault}
                  className={isDefault ? 'text-amber-700' : ''}
                />
                <div className="h-px bg-gray-100 my-1" />
                <MenuItem icon={Trash2} label="Delete" onClick={onDelete} className="text-rose-600 hover:bg-rose-50" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function MenuItem({ icon: Icon, label, onClick, className = '' }: {
  icon: React.ElementType; label: string; onClick: () => void; className?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors ${className}`}
    >
      <Icon className="w-4 h-4 flex-shrink-0 opacity-70" />
      {label}
    </button>
  )
}

function NewModalOption({ icon, bg, border, title, desc, onClick }: {
  icon: React.ReactNode; bg: string; border: string; title: string; desc: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3.5 p-3.5 rounded-xl border-2 transition-all text-left group ${border}`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors ${bg}`}>
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
      </div>
    </button>
  )
}

function EmptyState({ search, onNew }: { search: string; onNew: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-16 text-center">
      <div className="w-14 h-14 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
        <FileText className="w-7 h-7 text-gray-400" />
      </div>
      <p className="text-base font-semibold text-gray-700 mb-1">
        {search ? 'No templates found' : 'No templates yet'}
      </p>
      <p className="text-sm text-gray-400 mb-5">
        {search ? 'Try a different search term or clear the filter' : 'Create your first Email or SMS template to get started'}
      </p>
      {!search && (
        <button
          onClick={onNew}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl transition-all hover:brightness-110"
          style={{ background: '#9b1d3a' }}
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      )}
    </div>
  )
}

interface SendModalProps {
  open: boolean
  title: string
  subtitle: string
  inputType: 'email' | 'tel'
  inputLabel: string
  inputPlaceholder: string
  value: string
  onChange: (v: string) => void
  sending: boolean
  success: boolean
  onSend: () => void
  onClose: () => void
  accentClass: string
  btnClass: string
}

function SendModal({ open, title, subtitle, inputType, inputLabel, inputPlaceholder, value, onChange, sending, success, onSend, onClose, accentClass, btnClass }: SendModalProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[300] flex items-center justify-center p-4"
          onClick={() => { if (!sending) onClose() }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            {success ? (
              <div className="p-10 text-center">
                <div className="w-14 h-14 bg-emerald-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                  <Check className="w-7 h-7 text-emerald-600" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Sent!</h3>
                <p className="text-gray-500 text-sm">Your message was delivered successfully.</p>
              </div>
            ) : (
              <>
                <div className="p-5 border-b border-gray-100">
                  <h3 className="text-base font-bold text-gray-900">{title}</h3>
                  <p className="text-sm text-gray-500 mt-0.5">Using: {subtitle}</p>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{inputLabel}</label>
                    <div className="relative">
                      {inputType === 'tel' && <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />}
                      <input
                        type={inputType}
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        placeholder={inputPlaceholder}
                        disabled={sending}
                        className={`w-full ${inputType === 'tel' ? 'pl-10' : 'pl-4'} pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 ${accentClass} transition-all`}
                      />
                    </div>
                  </div>
                  <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">Template variables like <code className="bg-amber-100 px-1 rounded">{'{{date}}'}</code> will be replaced when sent.</p>
                  </div>
                </div>
                <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-2">
                  <button onClick={onClose} disabled={sending} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-200 rounded-xl transition-colors disabled:opacity-50">
                    Cancel
                  </button>
                  <button
                    onClick={onSend}
                    disabled={!value || sending}
                    className={`flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed ${btnClass}`}
                  >
                    {sending ? (
                      <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Sending…</>
                    ) : (
                      <><Send className="w-4 h-4" />{title}</>
                    )}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
