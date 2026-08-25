import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Mail,
  MessageSquare,
  Search,
  Send,
  Check,
  AlertCircle,
  Package,
  DollarSign,
  FileText,
  Clock,
  BarChart3,
  ChevronRight,
  ArrowLeft,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useTemplates } from '../../hooks/useTemplates'
import { defaultTemplates } from '../../data/emailTemplateCategories'
import { PhoneNumberInput } from '../ui/PhoneNumberInput'
import type { SavedTemplate } from '../documents/GmailTemplateBuilder'
import { convertLegacyPanel, type TemplatePanel } from '../documents/templatePanelPreview'

// ── SMS template type (mirrored from SavedSMSTemplates) ─────────────────
interface SMSTemplate {
  id: string
  name: string
  description: string
  content: string
  category: string
  variables: string[]
}

// ── Default SMS templates (same as in SavedSMSTemplates.tsx) ────────────
const DEFAULT_SMS_TEMPLATES: SMSTemplate[] = [
  {
    id: 'sms-default-1',
    name: 'Low Stock Alert',
    description: 'Notify when wine stock is low',
    content: 'Alert: {{wine_name}} is running low ({{current_stock}} bottles). Reorder threshold: {{threshold}}. Order now to avoid stockout.',
    category: 'alert',
    variables: ['wine_name', 'current_stock', 'threshold'],
  },
  {
    id: 'sms-default-2',
    name: 'Order Confirmation',
    description: 'Confirm order placement with provider',
    content: 'Order #{{order_id}} confirmed! {{quantity}} bottles of {{wine_name}} from {{provider}}. Expected delivery: {{delivery_date}}.',
    category: 'confirmation',
    variables: ['order_id', 'quantity', 'wine_name', 'provider', 'delivery_date'],
  },
  {
    id: 'sms-default-3',
    name: 'Delivery Reminder',
    description: 'Remind about upcoming delivery',
    content: 'Reminder: Wine delivery scheduled for {{delivery_date}} at {{delivery_time}}. {{total_bottles}} bottles from {{provider}}. Please ensure someone is available.',
    category: 'reminder',
    variables: ['delivery_date', 'delivery_time', 'total_bottles', 'provider'],
  },
  {
    id: 'sms-default-4',
    name: 'Weekly Inventory Summary',
    description: 'Weekly inventory status summary',
    content: 'Weekly Inventory: {{total_bottles}} bottles ({{healthy_count}} healthy, {{low_count}} low, {{critical_count}} critical). Total value: ${{total_value}}.',
    category: 'alert',
    variables: ['total_bottles', 'healthy_count', 'low_count', 'critical_count', 'total_value'],
  },
  {
    id: 'sms-default-5',
    name: 'Special Promotion',
    description: 'Announce special wine promotions',
    content: '🍷 Special Offer! {{wine_name}} now {{discount}}% off. Limited to {{quantity}} bottles. Valid until {{end_date}}. Reply YES to order.',
    category: 'promotion',
    variables: ['wine_name', 'discount', 'quantity', 'end_date'],
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────
type Channel = 'email' | 'sms'

function getCategoryIcon(category: string) {
  switch (category) {
    case 'inventory': return Package
    case 'financial': return DollarSign
    case 'order': return Send
    default: return FileText
  }
}

function getCategoryColor(category: string) {
  switch (category) {
    case 'inventory': return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', accent: '#3b82f6' }
    case 'financial': return { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', accent: '#10b981' }
    case 'order': return { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', accent: '#8b5cf6' }
    case 'alert': return { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', accent: '#f43f5e' }
    case 'confirmation': return { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', accent: '#14b8a6' }
    case 'reminder': return { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', accent: '#f59e0b' }
    case 'promotion': return { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200', accent: '#ec4899' }
    default: return { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', accent: '#6b7280' }
  }
}

/** Extract the plain-text panels from an (already-normalized) template for the compose body. */
function extractBodyFromPanels(panels: TemplatePanel[]): string {
  if (!panels?.length) return ''
  return panels
    .filter(p => p.type === 'text' && typeof p.content?.text === 'string')
    .map(p => p.content.text as string)
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Count "rich" panels — tables, charts, metrics — to show alongside the
 * preview so the user knows the template has more than plain text.
 */
function countRichPanels(panels: TemplatePanel[]): { tables: number; charts: number; metrics: number } {
  let tables = 0, charts = 0, metrics = 0
  for (const p of panels ?? []) {
    if (p.type === 'table') tables++
    else if (p.type === 'chart-bar' || p.type === 'chart-pie' || p.type === 'chart-line') charts++
    else if (p.type === 'metric' || p.type === 'financial') metrics++
  }
  return { tables, charts, metrics }
}

// ── Props ───────────────────────────────────────────────────────────────
interface SendMessageSlideOverProps {
  isOpen: boolean
  onClose: () => void
  providerName: string
  providerEmail: string
  providerPhone: string
}

export function SendMessageSlideOver({
  isOpen,
  onClose,
  providerName,
  providerEmail,
  providerPhone,
}: SendMessageSlideOverProps) {
  // ── State ─────────────────────────────────────────────────────────
  const [channel, setChannel] = useState<Channel>('email')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)

  // Compose state — email
  const [emailTo, setEmailTo] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [emailBody, setEmailBody] = useState('')

  // Compose state — SMS
  const [smsTo, setSmsTo] = useState('')
  const [smsBody, setSmsBody] = useState('')

  // Send state
  const [sending, setSending] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)

  // ── Data ──────────────────────────────────────────────────────────
  const { templates: apiTemplates } = useTemplates()

  // Build merged email templates. Default templates use a different panel
  // schema (position/size + type-specific config) than the ones the API
  // returns (already in GmailTemplateBuilder's content/config shape) — run
  // them through convertLegacyPanel so both end up in the shape the real
  // renderer understands, instead of collapsing everything to fake text.
  const emailTemplates: SavedTemplate[] = useMemo(() => {
    const convertedDefaults: SavedTemplate[] = defaultTemplates.map((template) => {
      const normalizedCategory = (template.category || 'custom').toLowerCase().trim() as 'inventory' | 'financial' | 'order' | 'custom'
      return {
        id: template.id,
        name: template.name,
        description: template.description || '',
        subject: template.subject,
        thumbnail: '',
        category: normalizedCategory,
        panels: template.panels
          .map(convertLegacyPanel)
          .filter((p): p is TemplatePanel => p !== null),
        created_at: new Date(template.createdAt),
        last_modified: new Date(template.updatedAt),
        used_count: 0,
      }
    })

    const allTemplates = [...convertedDefaults, ...apiTemplates].map(t => ({
      ...t,
      category: (t.category || 'custom').toLowerCase().trim() as 'inventory' | 'financial' | 'order' | 'custom'
    }))

    return allTemplates.filter((template, index, self) =>
      index === self.findIndex(t => t.id === template.id)
    )
  }, [apiTemplates])

  // SMS templates — defaults + API templates that look like SMS
  const smsTemplates: SMSTemplate[] = useMemo(() => {
    const apiConverted: SMSTemplate[] = apiTemplates
      .filter((t: any) => t.category && ['promotion', 'appointment', 'alert', 'confirmation', 'reminder', 'custom'].includes(t.category))
      .map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? '',
        content: t.panels?.[0]?.content ?? '',
        category: t.category,
        variables: t.panels?.[0]?.variables ?? [],
      }))
    const combined = [...DEFAULT_SMS_TEMPLATES, ...apiConverted]
    return combined.filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i)
  }, [apiTemplates])

  // Filter templates by search
  const filteredEmailTemplates = useMemo(() => {
    if (!searchQuery) return emailTemplates
    const q = searchQuery.toLowerCase()
    return emailTemplates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      (t.subject || '').toLowerCase().includes(q)
    )
  }, [emailTemplates, searchQuery])

  const filteredSmsTemplates = useMemo(() => {
    if (!searchQuery) return smsTemplates
    const q = searchQuery.toLowerCase()
    return smsTemplates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.content.toLowerCase().includes(q)
    )
  }, [smsTemplates, searchQuery])

  // Get currently selected template
  const selectedEmailTemplate = useMemo(
    () => (selectedTemplateId ? emailTemplates.find(t => t.id === selectedTemplateId) ?? null : null),
    [selectedTemplateId, emailTemplates],
  )
  const selectedSmsTemplate = useMemo(
    () => (selectedTemplateId ? smsTemplates.find(t => t.id === selectedTemplateId) ?? null : null),
    [selectedTemplateId, smsTemplates],
  )

  // ── Reset form when opening ──────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setEmailTo(providerEmail || '')
      setSmsTo(providerPhone || '')
      setEmailSubject('')
      setEmailBody('')
      setSmsBody('')
      setSelectedTemplateId(null)
      setSearchQuery('')
      setSending(false)
      setSendSuccess(false)
      setShowPreview(false)
      setChannel(providerEmail ? 'email' : providerPhone ? 'sms' : 'email')
    }
  }, [isOpen, providerEmail, providerPhone])

  // ── Handlers ─────────────────────────────────────────────────────
  const handleSelectEmailTemplate = (template: SavedTemplate) => {
    setSelectedTemplateId(template.id)
    setEmailSubject(template.subject || '')
    const body = extractBodyFromPanels(template.panels)
    setEmailBody(body || `Hi ${providerName},\n\n`)
    setShowPreview(false)
  }

  const handleSelectSmsTemplate = (template: SMSTemplate) => {
    setSelectedTemplateId(template.id)
    setSmsBody(template.content)
    setShowPreview(false)
  }

  const handleDeselectTemplate = () => {
    setSelectedTemplateId(null)
    setShowPreview(false)
    if (channel === 'email') {
      setEmailSubject('')
      setEmailBody('')
    } else {
      setSmsBody('')
    }
  }

  const handleSend = async () => {
    setSending(true)
    // Simulate sending (same as SavedTemplates)
    await new Promise(resolve => setTimeout(resolve, 1500))
    setSending(false)
    setSendSuccess(true)
    setTimeout(() => {
      setSendSuccess(false)
      onClose()
    }, 2000)
  }

  const canSend = channel === 'email'
    ? !!emailTo && !!emailSubject.trim()
    : !!smsTo && !!smsBody.trim()

  // ── Render ────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100]"
            onClick={onClose}
          />

          {/* Slide-over panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-[720px] bg-white shadow-2xl z-[101] flex flex-col"
          >
            {/* ── Success overlay ─────────────────────────────────── */}
            <AnimatePresence>
              {sendSuccess && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center"
                >
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', damping: 15 }}
                    className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mb-5"
                  >
                    <Check className="w-10 h-10 text-emerald-600" />
                  </motion.div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">
                    {channel === 'email' ? 'Email Sent!' : 'SMS Sent!'}
                  </h3>
                  <p className="text-gray-500 text-sm">
                    Your message to <span className="font-semibold text-gray-700">{providerName}</span> has been sent.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Header ──────────────────────────────────────────── */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-orange-50 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <Send className="w-4 h-4 text-amber-700" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-gray-900 truncate">Send Message</h2>
                  <p className="text-xs text-gray-500 truncate">To {providerName}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/80 text-gray-400 hover:bg-white hover:text-gray-600 transition-all flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── Channel switcher ────────────────────────────────── */}
            <div className="px-6 pt-4 pb-3 flex-shrink-0">
              <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl">
                <button
                  onClick={() => { setChannel('email'); setSelectedTemplateId(null); setShowPreview(false) }}
                  className={[
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                    channel === 'email'
                      ? 'bg-white text-amber-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}
                >
                  <Mail className="w-4 h-4" />
                  Email
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${channel === 'email' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'}`}>
                    {emailTemplates.length}
                  </span>
                </button>
                <button
                  onClick={() => { setChannel('sms'); setSelectedTemplateId(null); setShowPreview(false) }}
                  className={[
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                    channel === 'sms'
                      ? 'bg-white text-amber-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}
                >
                  <MessageSquare className="w-4 h-4" />
                  SMS
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${channel === 'sms' ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-500'}`}>
                    {smsTemplates.length}
                  </span>
                </button>
              </div>
            </div>

            {/* ── Scrollable content ──────────────────────────────── */}
            <div className="flex-1 overflow-y-auto">

              {/* Template picker ─────────────────────────────────── */}
              <div className="px-6 pb-3">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    {selectedTemplateId ? 'Selected Template' : 'Choose a Template'}
                  </h3>
                  {selectedTemplateId && (
                    <button
                      onClick={handleDeselectTemplate}
                      className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors"
                    >
                      <ArrowLeft className="w-3 h-3" />
                      Change template
                    </button>
                  )}
                </div>

                {/* Search (only when no template selected) */}
                {!selectedTemplateId && (
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={`Search ${channel === 'email' ? 'email' : 'SMS'} templates…`}
                      className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-all bg-gray-50"
                    />
                  </div>
                )}

                {/* Template list */}
                <AnimatePresence mode="wait">
                  {channel === 'email' ? (
                    <motion.div
                      key="email-templates"
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 10 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-2"
                    >
                      {selectedTemplateId && selectedEmailTemplate ? (
                        // ── Selected template card with preview ──
                        <div className="rounded-xl border-2 border-amber-300 bg-amber-50/50 overflow-hidden">
                          <div className="p-3 flex items-center gap-3">
                            {(() => {
                              const colors = getCategoryColor(selectedEmailTemplate.category)
                              const Icon = getCategoryIcon(selectedEmailTemplate.category)
                              return (
                                <>
                                  <div className={`w-9 h-9 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0`}>
                                    <Icon className={`w-4 h-4 ${colors.text}`} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{selectedEmailTemplate.name}</p>
                                    <p className="text-xs text-gray-500 truncate">{selectedEmailTemplate.description}</p>
                                  </div>
                                </>
                              )
                            })()}
                            <button
                              onClick={() => setShowPreview(!showPreview)}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors flex-shrink-0"
                            >
                              {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              {showPreview ? 'Hide' : 'Preview'}
                            </button>
                            <Check className="w-5 h-5 text-amber-600 flex-shrink-0" />
                          </div>

                          {/* ── Inline email preview mockup ── */}
                          <AnimatePresence>
                            {showPreview && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                <div className="px-3 pb-3">
                                  {(() => {
                                    const accent = selectedEmailTemplate.category === 'inventory'
                                      ? { bg: '#eff6ff', bar: '#3b82f6' }
                                      : selectedEmailTemplate.category === 'financial'
                                      ? { bg: '#f0fdf4', bar: '#10b981' }
                                      : selectedEmailTemplate.category === 'order'
                                      ? { bg: '#f5f3ff', bar: '#8b5cf6' }
                                      : { bg: '#f9fafb', bar: '#6b7280' }
                                    const rich = countRichPanels(selectedEmailTemplate.panels)
                                    return (
                                      <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm" style={{ background: accent.bg }}>
                                        {/* Email chrome */}
                                        <div className="h-8 px-3 flex items-center gap-2" style={{ background: accent.bar }}>
                                          <div className="flex gap-1">
                                            <div className="w-2 h-2 rounded-full bg-white/30" />
                                            <div className="w-2 h-2 rounded-full bg-white/30" />
                                            <div className="w-2 h-2 rounded-full bg-white/30" />
                                          </div>
                                          <span className="text-[10px] font-semibold text-white/90 truncate flex-1">
                                            {selectedEmailTemplate.subject || selectedEmailTemplate.name}
                                          </span>
                                        </div>
                                        {/* Body simulation */}
                                        <div className="bg-white p-4 space-y-2.5">
                                          {/* Title line */}
                                          <div className="h-2 rounded-full bg-gray-300 w-3/5" />
                                          {/* Text lines */}
                                          <div className="space-y-1.5">
                                            <div className="h-1.5 rounded-full bg-gray-200 w-full" />
                                            <div className="h-1.5 rounded-full bg-gray-200 w-11/12" />
                                            <div className="h-1.5 rounded-full bg-gray-200 w-4/5" />
                                          </div>
                                          {/* Rich content indicators */}
                                          {(rich.metrics > 0 || rich.charts > 0 || rich.tables > 0) && (
                                            <div className="flex items-center gap-2 pt-1.5">
                                              {rich.metrics > 0 && (
                                                <div className="flex items-center gap-3">
                                                  {Array.from({ length: Math.min(rich.metrics, 4) }).map((_, i) => (
                                                    <div key={i} className="flex-1 h-10 rounded-lg border border-gray-200 bg-gray-50 flex flex-col items-center justify-center px-3">
                                                      <div className="h-1 w-8 rounded-full bg-gray-300 mb-1" />
                                                      <div className="h-2 w-12 rounded-full" style={{ background: accent.bar, opacity: 0.4 }} />
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          )}
                                          {rich.charts > 0 && (
                                            <div className="h-16 rounded-lg border border-gray-200 bg-gray-50 flex items-end justify-center gap-1 px-4 pb-2">
                                              {[40, 65, 50, 80, 35, 70, 55].map((h, i) => (
                                                <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, background: accent.bar, opacity: 0.3 + (i * 0.07) }} />
                                              ))}
                                            </div>
                                          )}
                                          {rich.tables > 0 && (
                                            <div className="rounded-lg border border-gray-200 overflow-hidden">
                                              <div className="h-5 bg-gray-100 border-b border-gray-200 flex items-center gap-2 px-2">
                                                <div className="h-1 w-12 rounded-full bg-gray-300" />
                                                <div className="h-1 w-10 rounded-full bg-gray-300" />
                                                <div className="h-1 w-8 rounded-full bg-gray-300" />
                                              </div>
                                              {[1, 2, 3].map(r => (
                                                <div key={r} className="h-4 flex items-center gap-2 px-2 border-b border-gray-100 last:border-0">
                                                  <div className="h-1 w-14 rounded-full bg-gray-200" />
                                                  <div className="h-1 w-8 rounded-full bg-gray-200" />
                                                  <div className="h-1 w-10 rounded-full bg-gray-200" />
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {/* CTA button */}
                                          <div className="h-6 rounded-lg w-1/3 mx-auto mt-1" style={{ background: accent.bar, opacity: 0.5 }} />
                                        </div>
                                        {/* Includes badge */}
                                        {(rich.metrics > 0 || rich.charts > 0 || rich.tables > 0) && (
                                          <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 flex items-center gap-2 flex-wrap">
                                            <span className="text-[10px] text-gray-400 font-medium">Includes:</span>
                                            {rich.metrics > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">{rich.metrics} metric{rich.metrics > 1 ? 's' : ''}</span>}
                                            {rich.charts > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium">{rich.charts} chart{rich.charts > 1 ? 's' : ''}</span>}
                                            {rich.tables > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">{rich.tables} table{rich.tables > 1 ? 's' : ''}</span>}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })()}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ) : (
                        // Show all templates
                        filteredEmailTemplates.length === 0 ? (
                          <div className="text-center py-8">
                            <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-400">No templates found</p>
                          </div>
                        ) : (
                          filteredEmailTemplates.map((template, index) => {
                            const colors = getCategoryColor(template.category)
                            const Icon = getCategoryIcon(template.category)
                            return (
                              <motion.button
                                key={template.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03, duration: 0.2 }}
                                onClick={() => handleSelectEmailTemplate(template)}
                                className="w-full p-3 rounded-xl border border-gray-100 bg-white hover:border-amber-200 hover:bg-amber-50/30 transition-all group text-left flex items-center gap-3"
                              >
                                <div className={`w-9 h-9 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}>
                                  <Icon className={`w-4 h-4 ${colors.text}`} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{template.name}</p>
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border} capitalize flex-shrink-0`}>
                                      {template.category}
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-400 truncate">{template.description}</p>
                                  <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                                    <span className="flex items-center gap-0.5">
                                      <Clock className="w-3 h-3" />
                                      {new Date(template.last_modified).toLocaleDateString()}
                                    </span>
                                    <span className="flex items-center gap-0.5">
                                      <BarChart3 className="w-3 h-3" />
                                      {template.used_count}× used
                                    </span>
                                  </div>
                                </div>
                                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-amber-500 flex-shrink-0 transition-colors" />
                              </motion.button>
                            )
                          })
                        )
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="sms-templates"
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -10 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-2"
                    >
                      {selectedTemplateId && selectedSmsTemplate ? (
                        // ── Selected SMS template with preview ──
                        <div className="rounded-xl border-2 border-amber-300 bg-amber-50/50 overflow-hidden">
                          <div className="p-3 flex items-center gap-3">
                            {(() => {
                              const colors = getCategoryColor(selectedSmsTemplate.category)
                              return (
                                <>
                                  <div className={`w-9 h-9 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0`}>
                                    <MessageSquare className={`w-4 h-4 ${colors.text}`} />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{selectedSmsTemplate.name}</p>
                                    <p className="text-xs text-gray-500 truncate">{selectedSmsTemplate.description}</p>
                                  </div>
                                </>
                              )
                            })()}
                            <button
                              onClick={() => setShowPreview(!showPreview)}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors flex-shrink-0"
                            >
                              {showPreview ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              {showPreview ? 'Hide' : 'Preview'}
                            </button>
                            <Check className="w-5 h-5 text-amber-600 flex-shrink-0" />
                          </div>

                          {/* ── Inline SMS phone preview ── */}
                          <AnimatePresence>
                            {showPreview && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.2 }}
                                className="overflow-hidden"
                              >
                                <div className="px-3 pb-3">
                                  <div className="rounded-2xl bg-gray-900 p-3 max-w-[280px] mx-auto shadow-lg">
                                    {/* Status bar */}
                                    <div className="flex justify-between items-center px-2 mb-2">
                                      <span className="text-[9px] text-gray-400 font-medium">Messages</span>
                                      <span className="text-[9px] text-gray-500">now</span>
                                    </div>
                                    {/* Chat bubble */}
                                    <div className="bg-emerald-500 rounded-2xl rounded-br-md px-3 py-2.5 ml-auto max-w-[85%] w-fit">
                                      <p className="text-[11px] text-white leading-relaxed break-words">
                                        {selectedSmsTemplate.content}
                                      </p>
                                    </div>
                                    {/* Input bar */}
                                    <div className="mt-2 flex items-center gap-2">
                                      <div className="flex-1 h-7 bg-gray-800 rounded-full px-3 flex items-center">
                                        <span className="text-[9px] text-gray-500">iMessage</span>
                                      </div>
                                      <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                                        <Send className="w-3 h-3 text-white" />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ) : (
                        filteredSmsTemplates.length === 0 ? (
                          <div className="text-center py-8">
                            <MessageSquare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                            <p className="text-sm text-gray-400">No templates found</p>
                          </div>
                        ) : (
                          filteredSmsTemplates.map((template, index) => {
                            const colors = getCategoryColor(template.category)
                            return (
                              <motion.button
                                key={template.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.03, duration: 0.2 }}
                                onClick={() => handleSelectSmsTemplate(template)}
                                className="w-full p-3 rounded-xl border border-gray-100 bg-white hover:border-amber-200 hover:bg-amber-50/30 transition-all group text-left flex items-center gap-3"
                              >
                                <div className={`w-9 h-9 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}>
                                  <MessageSquare className={`w-4 h-4 ${colors.text}`} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <p className="text-sm font-semibold text-gray-900 truncate">{template.name}</p>
                                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border} capitalize flex-shrink-0`}>
                                      {template.category}
                                    </span>
                                  </div>
                                  <p className="text-xs text-gray-400 line-clamp-1">{template.content}</p>
                                </div>
                                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-amber-500 flex-shrink-0 transition-colors" />
                              </motion.button>
                            )
                          })
                        )
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* ── Compose form ─────────────────────────────────── */}
              {selectedTemplateId && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, delay: 0.1 }}
                  className="px-6 pb-6"
                >
                  <div className="h-px bg-gray-100 mb-4" />
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Compose</h3>

                  {channel === 'email' ? (
                    <div className="space-y-3">
                      {/* To */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                        <input
                          type="email"
                          value={emailTo}
                          onChange={(e) => setEmailTo(e.target.value)}
                          placeholder="provider@example.com"
                          className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-all"
                        />
                      </div>

                      {/* Subject */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                        <input
                          type="text"
                          value={emailSubject}
                          onChange={(e) => setEmailSubject(e.target.value)}
                          placeholder="Email subject…"
                          className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-all"
                        />
                      </div>

                      {/* Body */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Body</label>
                        <textarea
                          value={emailBody}
                          onChange={(e) => setEmailBody(e.target.value)}
                          placeholder={`Hi ${providerName},\n\nWrite your message here…`}
                          rows={7}
                          className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-all resize-none leading-relaxed"
                        />
                      </div>

                      {/* Variable hint */}
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800 leading-relaxed">
                          Template variables like <code className="bg-amber-100 px-1 py-0.5 rounded text-[11px]">{'{{provider_name}}'}</code> will be replaced with actual values when sent.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* To (phone) */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                        <PhoneNumberInput
                          value={smsTo}
                          onChange={setSmsTo}
                        />
                      </div>

                      {/* Message */}
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                        <textarea
                          value={smsBody}
                          onChange={(e) => setSmsBody(e.target.value)}
                          placeholder="Write your message here…"
                          rows={5}
                          className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-amber-500/30 focus:border-amber-400 transition-all resize-none leading-relaxed"
                        />
                        <div className="flex justify-between mt-1.5">
                          <p className="text-[10px] text-gray-400">
                            {smsBody.length} / 160 characters
                            {smsBody.length > 160 && <span className="text-amber-600 ml-1">({Math.ceil(smsBody.length / 160)} segments)</span>}
                          </p>
                        </div>
                      </div>

                      {/* Variable hint */}
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-800 leading-relaxed">
                          Variables like <code className="bg-amber-100 px-1 py-0.5 rounded text-[11px]">{'{{provider}}'}</code> will be auto-filled before sending.
                        </p>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Empty state when no template selected */}
              {!selectedTemplateId && (channel === 'email' ? filteredEmailTemplates.length > 0 : filteredSmsTemplates.length > 0) && (
                <div className="px-6 pb-6">
                  <div className="h-px bg-gray-100 mb-4" />
                  <div className="text-center py-6">
                    <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
                      {channel === 'email' ? (
                        <Mail className="w-5 h-5 text-gray-400" />
                      ) : (
                        <MessageSquare className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <p className="text-sm text-gray-500 font-medium">Select a template above</p>
                    <p className="text-xs text-gray-400 mt-1">to start composing your message</p>
                  </div>
                </div>
              )}
            </div>

            {/* ── Footer ──────────────────────────────────────────── */}
            <div className="flex-shrink-0 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-3">
                <button
                  onClick={onClose}
                  disabled={sending}
                  className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSend}
                  disabled={!canSend || sending}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-amber-500 rounded-xl hover:bg-amber-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-amber-200"
                >
                  {sending ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      {channel === 'email' ? 'Send Email' : 'Send SMS'}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
