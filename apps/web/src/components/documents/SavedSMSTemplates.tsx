import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare,
  Edit3,
  Copy,
  Trash2,
  BarChart3,
  Send,
  Search,
  MoreVertical,
  Check,
  AlertCircle,
  Clock,
  Star,
  Crown,
  Phone,
  Bell,
  Tag,
  Calendar,
} from 'lucide-react'
import { useTemplates } from '../../hooks/useTemplates'
import { useUserPreferences } from '../../hooks/useUserPreferences'

export interface SavedSMSTemplate {
  id: string
  name: string
  description: string
  content: string
  category: 'promotion' | 'appointment' | 'alert' | 'confirmation' | 'reminder' | 'custom'
  variables: string[]
  created_at: Date
  last_modified: Date
  used_count: number
  isMMS?: boolean
}

interface SavedSMSTemplatesProps {
  onEditTemplate?: (template: SavedSMSTemplate) => void
  onDuplicateTemplate?: (template: SavedSMSTemplate) => void
  onDeleteTemplate?: (templateId: string) => void
  onUseTemplate?: (template: SavedSMSTemplate) => void
  onNewTemplate?: () => void
}

// Default SMS templates
const defaultSMSTemplates: SavedSMSTemplate[] = [
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

export function SavedSMSTemplates({
  onEditTemplate,
  onDuplicateTemplate,
  onDeleteTemplate,
  onUseTemplate,
  onNewTemplate,
}: SavedSMSTemplatesProps) {
  const { templates: apiSmsTemplates, deleteTemplate: apiDeleteSms, createTemplate: apiCreateSms, updateTemplate: apiUpdateSms } = useTemplates()
  const { preferences, updatePreferences } = useUserPreferences()
  const [filter, setFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'usage'>('recent')
  const [selectedTemplateMenu, setSelectedTemplateMenu] = useState<string | null>(null)
  const [showSendModal, setShowSendModal] = useState<SavedSMSTemplate | null>(null)
  const [sendPhone, setSendPhone] = useState('')
  const [sending, setSending] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)

  const smsFavorites: string[] = (preferences as any).smsFavorites ?? []
  const smsDefaultId: string | null = (preferences as any).smsDefaultTemplate ?? null
  const favoriteTemplates = smsFavorites
  const defaultTemplate = smsDefaultId

  const templates = useMemo(() => {
    const apiConverted: SavedSMSTemplate[] = apiSmsTemplates
      .filter((t: any) => t.category && ['promotion', 'appointment', 'alert', 'confirmation', 'reminder', 'custom'].includes(t.category))
      .map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description ?? '',
        content: t.panels?.[0]?.content ?? '',
        category: t.category as SavedSMSTemplate['category'],
        variables: t.panels?.[0]?.variables ?? [],
        created_at: new Date(t.created_at ?? t.createdAt ?? Date.now()),
        last_modified: new Date(t.last_modified ?? t.updatedAt ?? Date.now()),
        used_count: t.used_count ?? 0,
        isMMS: false,
      }))
    const combined = [...defaultSMSTemplates, ...apiConverted]
    return combined.filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i)
  }, [apiSmsTemplates])

  // Close menu on outside click
  useEffect(() => {
    const handleClick = () => setSelectedTemplateMenu(null)
    if (selectedTemplateMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [selectedTemplateMenu])

  const duplicateTemplate = async (template: SavedSMSTemplate) => {
    try {
      await apiCreateSms({
        name: `${template.name} (Copy)`,
        description: template.description,
        category: template.category as any,
        panels: [{ id: 'sms-body', type: 'text' as any, title: '', content: template.content, config: {} as any }],
        subject: '',
        thumbnail: '',
        created_at: new Date(),
        last_modified: new Date(),
        used_count: 0,
      })
    } catch {
      console.error('Failed to duplicate SMS template')
    }
    onDuplicateTemplate?.(template)
  }

  const deleteTemplate = async (id: string) => {
    const template = templates.find(t => t.id === id)
    if (!template) return

    if (confirm(`Delete "${template.name}"?\n\nThis action cannot be undone.`)) {
      try {
        await apiDeleteSms(id)
      } catch {
        console.error('Failed to delete SMS template')
      }
      onDeleteTemplate?.(id)
    }
  }

  const handleUseTemplate = (template: SavedSMSTemplate) => {
    setShowSendModal(template)
  }

  const handleSendSMS = async () => {
    if (!sendPhone || !showSendModal) return

    setSending(true)
    await new Promise(resolve => setTimeout(resolve, 1500))

    try {
      await apiUpdateSms(showSendModal.id, {
        used_count: showSendModal.used_count + 1,
        last_modified: new Date(),
      })
    } catch { /* non-critical */ }

    setSending(false)
    setSendSuccess(true)

    setTimeout(() => {
      setShowSendModal(null)
      setSendPhone('')
      setSendSuccess(false)
    }, 2000)

    onUseTemplate?.(showSendModal)
  }

  const handleToggleFavorite = (templateId: string) => {
    const current = [...smsFavorites]
    const idx = current.indexOf(templateId)
    if (idx > -1) {
      current.splice(idx, 1)
    } else {
      current.push(templateId)
    }
    updatePreferences({ smsFavorites: current } as any)
  }

  const handleSetDefault = (templateId: string) => {
    if (defaultTemplate === templateId) {
      updatePreferences({ smsDefaultTemplate: null } as any)
    } else {
      updatePreferences({ smsDefaultTemplate: templateId } as any)
    }
    setSelectedTemplateMenu(null)
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'promotion': return Tag
      case 'appointment': return Calendar
      case 'alert': return Bell
      case 'confirmation': return Check
      case 'reminder': return Clock
      default: return MessageSquare
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'promotion':
        return 'bg-pink-100 text-pink-700 border-pink-200'
      case 'appointment':
        return 'bg-blue-100 text-blue-700 border-blue-200'
      case 'alert':
        return 'bg-rose-100 text-rose-700 border-rose-200'
      case 'confirmation':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200'
      case 'reminder':
        return 'bg-amber-100 text-amber-700 border-amber-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const categories = ['all', 'favorites', 'promotion', 'appointment', 'alert', 'confirmation', 'reminder', 'custom']

  // Filter and sort templates
  const filteredTemplates = useMemo(() => {
    let filtered = [...templates]

    // Filter by category
    if (filter === 'favorites') {
      filtered = filtered.filter(t => favoriteTemplates.includes(t.id))
    } else if (filter !== 'all') {
      filtered = filtered.filter(t => t.category === filter)
    }

    // Apply search
    if (searchQuery) {
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // Apply sort
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name)
        case 'usage':
          return b.used_count - a.used_count
        case 'recent':
        default:
          return new Date(b.last_modified).getTime() - new Date(a.last_modified).getTime()
      }
    })
  }, [templates, filter, favoriteTemplates, searchQuery, sortBy])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div>
            <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-emerald-500" />
              SMS Templates
              <span className="text-xs font-semibold px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full">{templates.length}</span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{templates.reduce((s, t) => s + t.used_count, 0)} total sends</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 w-44 transition-all"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 cursor-pointer bg-white"
            >
              <option value="recent">Recent</option>
              <option value="name">A–Z</option>
              <option value="usage">Most used</option>
            </select>
            {onNewTemplate && (
              <button
                onClick={onNewTemplate}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                New
              </button>
            )}
          </div>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          {categories.map((cat) => {
            const count = cat === 'all' ? templates.length
              : cat === 'favorites' ? favoriteTemplates.length
              : templates.filter(t => t.category === cat).length
            return (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={[
                  'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all border',
                  filter === cat
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-200'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-emerald-300 hover:text-emerald-600',
                ].join(' ')}
              >
                {cat === 'favorites' && <Star className="w-3 h-3 fill-amber-400 text-amber-400" />}
                {cat}
                <span className={`ml-0.5 ${filter === cat ? 'opacity-70' : 'opacity-50'}`}>({count})</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Templates Grid */}
      <div className="p-5">
        {filteredTemplates.length === 0 ? (
          <div className="text-center py-14">
            <div className="w-14 h-14 bg-emerald-50 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <MessageSquare className="w-7 h-7 text-emerald-400" />
            </div>
            <p className="text-gray-700 font-semibold mb-1">
              {searchQuery ? 'No templates found' : 'No SMS templates yet'}
            </p>
            <p className="text-sm text-gray-400 mb-5">
              {searchQuery ? 'Try a different search' : 'Create your first SMS template to get started'}
            </p>
            {!searchQuery && onNewTemplate && (
              <button onClick={onNewTemplate}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition-colors">
                <MessageSquare className="w-4 h-4" /> Create Template
              </button>
            )}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={`${filter}-${filteredTemplates.length}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {filteredTemplates.map((template, index) => {
                const CategoryIcon = getCategoryIcon(template.category)
                const isFav = favoriteTemplates.includes(template.id)
                const isDefault = defaultTemplate === template.id

                return (
                  <motion.div
                    key={template.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ delay: index * 0.04, duration: 0.25 }}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:border-emerald-100 transition-all duration-300 group relative flex flex-col overflow-visible"
                  >
                    {/* ── Preview: iPhone mockup ── */}
                    <div className="h-52 rounded-t-2xl relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900">
                      {/* Background glow orbs */}
                      <div className="absolute -top-6 -left-6 w-28 h-28 rounded-full blur-3xl opacity-30 bg-emerald-400" />
                      <div className="absolute -bottom-4 -right-4 w-24 h-24 rounded-full blur-2xl opacity-20 bg-teal-400" />

                      {/* Phone shell */}
                      <div className="relative z-10 w-[126px] bg-gray-900 rounded-[34px] p-[7px] shadow-2xl ring-1 ring-white/[0.06]">
                        {/* Dynamic island */}
                        <div className="w-12 h-[18px] bg-black rounded-full mx-auto mb-1.5 flex items-center justify-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-700 ring-1 ring-gray-600" />
                          <div className="w-3 h-1.5 rounded-sm bg-gray-700" />
                        </div>
                        {/* Screen */}
                        <div className="bg-white rounded-[26px] overflow-hidden">
                          {/* Status/header */}
                          <div className="px-2.5 py-1.5 flex items-center gap-1.5 bg-gray-50 border-b border-gray-100">
                            <div className="w-4 h-4 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                              <MessageSquare className="w-2.5 h-2.5 text-emerald-600" />
                            </div>
                            <span className="text-[7.5px] font-semibold text-gray-600 truncate">Messages</span>
                          </div>
                          {/* Bubble */}
                          <div className="p-2 pb-1">
                            <div className="bg-[#DCF8C6] rounded-2xl rounded-br-sm px-2 py-1.5 text-[7px] leading-relaxed text-gray-800 max-w-[92%] ml-auto shadow-sm">
                              {template.content.length > 65
                                ? template.content.substring(0, 65) + '…'
                                : template.content}
                            </div>
                            <p className="text-[6px] text-gray-400 text-right mt-0.5 mr-0.5">✓✓ Delivered</p>
                          </div>
                          {/* Home indicator */}
                          <div className="h-3 flex items-end justify-center pb-0.5">
                            <div className="w-7 h-[3px] bg-gray-300 rounded-full" />
                          </div>
                        </div>
                      </div>

                      {/* Top-left: category + default badges */}
                      <div className="absolute top-2.5 left-2.5 flex flex-col gap-1">
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border backdrop-blur-sm bg-white/85 ${getCategoryColor(template.category)}`}>
                          <CategoryIcon className="w-3 h-3" />
                          <span className="capitalize">{template.category}</span>
                        </div>
                        {isDefault && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100/90 text-amber-700 border border-amber-200 backdrop-blur-sm">
                            <Crown className="w-3 h-3 fill-amber-500" /> Default
                          </div>
                        )}
                      </div>

                      {/* Top-right: star + menu */}
                      <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleToggleFavorite(template.id) }}
                          className="p-1.5 bg-white/90 hover:bg-white rounded-lg shadow-sm hover:shadow-md transition-all hover:scale-110 active:scale-95"
                        >
                          <Star className={`w-3.5 h-3.5 transition-colors ${isFav ? 'fill-amber-400 text-amber-400' : 'text-gray-400'}`} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedTemplateMenu(selectedTemplateMenu === template.id ? null : template.id) }}
                          className="p-1.5 bg-white/90 hover:bg-white rounded-lg shadow-sm transition-colors"
                        >
                          <MoreVertical className="w-3.5 h-3.5 text-gray-500" />
                        </button>
                      </div>

                      {/* Hover overlay */}
                      <div className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center rounded-t-2xl">
                        <button
                          onClick={() => handleUseTemplate(template)}
                          className="flex items-center gap-2 px-4 py-2 bg-white text-gray-900 font-semibold text-sm rounded-xl shadow-xl translate-y-2 group-hover:translate-y-0 transition-transform duration-200"
                        >
                          <Send className="w-4 h-4" />
                          Use Template
                        </button>
                      </div>
                    </div>

                    {/* Dropdown */}
                    <AnimatePresence>
                      {selectedTemplateMenu === template.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95, y: -6 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95, y: -6 }}
                          transition={{ duration: 0.12 }}
                          className="absolute top-12 right-2 w-48 bg-white rounded-xl shadow-2xl border border-gray-100 py-1.5 z-[100]"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button onClick={() => { onEditTemplate?.(template); setSelectedTemplateMenu(null) }}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors">
                            <Edit3 className="w-4 h-4 text-gray-400" /> Edit
                          </button>
                          <button onClick={() => { duplicateTemplate(template); setSelectedTemplateMenu(null) }}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors">
                            <Copy className="w-4 h-4 text-gray-400" /> Duplicate
                          </button>
                          <div className="h-px bg-gray-100 my-1" />
                          <button onClick={() => handleSetDefault(template.id)}
                            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${isDefault ? 'text-amber-700 hover:bg-amber-50' : 'text-gray-700 hover:bg-gray-50'}`}>
                            <Crown className={`w-4 h-4 ${isDefault ? 'fill-amber-400 text-amber-500' : 'text-gray-400'}`} />
                            {isDefault ? 'Remove Default' : 'Set as Default'}
                          </button>
                          <div className="h-px bg-gray-100 my-1" />
                          <button onClick={() => { deleteTemplate(template.id); setSelectedTemplateMenu(null) }}
                            className="w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition-colors">
                            <Trash2 className="w-4 h-4" /> Delete
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* ── Card body ── */}
                    <div className="flex flex-col flex-1 p-4">
                      <h3 className="font-bold text-gray-900 text-sm leading-snug line-clamp-1 mb-1">
                        {template.name}
                      </h3>
                      <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed mb-2 min-h-[2.5rem]">
                        {template.description}
                      </p>

                      {/* Variable chips */}
                      {template.variables.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {template.variables.slice(0, 3).map(v => (
                            <span key={v} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-mono rounded-md border border-emerald-100">
                              {`{{${v}}}`}
                            </span>
                          ))}
                          {template.variables.length > 3 && (
                            <span className="px-1.5 py-0.5 bg-gray-50 text-gray-400 text-[10px] rounded-md border border-gray-100">
                              +{template.variables.length - 3}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between text-[11px] text-gray-400 mt-auto mb-3">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(template.last_modified).toLocaleDateString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <BarChart3 className="w-3 h-3" />
                          {template.used_count}× used
                        </span>
                      </div>

                      {/* Action row */}
                      <div className="flex gap-2 pt-3 border-t border-gray-50">
                        <button
                          onClick={() => onEditTemplate?.(template)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleUseTemplate(template)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors shadow-sm shadow-emerald-200"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Use
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Statistics Footer */}
      {templates.length > 0 && (
        <div className="px-4 py-3 bg-gradient-to-r from-emerald-50 to-teal-50 border-t border-emerald-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <MessageSquare className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-900">
                  {templates.length} SMS Template{templates.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-emerald-700">
                  {templates.reduce((sum, t) => sum + t.used_count, 0)} total sends
                </p>
              </div>
            </div>
            {templates.length > 0 && (
              <div className="text-right">
                <p className="text-xs text-emerald-700">Most popular:</p>
                <p className="text-sm font-medium text-emerald-900">
                  {templates.reduce((prev, curr) => prev.used_count > curr.used_count ? prev : curr).name}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Send Modal */}
      <AnimatePresence>
        {showSendModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[300] flex items-center justify-center p-4"
            onClick={() => {
              if (!sending) {
                setShowSendModal(null)
                setSendPhone('')
              }
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              {sendSuccess ? (
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full mx-auto mb-4 flex items-center justify-center">
                    <Check className="w-8 h-8 text-emerald-600" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-900 mb-2">SMS Sent!</h3>
                  <p className="text-gray-600">Your message has been sent successfully.</p>
                </div>
              ) : (
                <>
                  <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-teal-50">
                    <h3 className="text-lg font-bold text-gray-900 mb-1">Send SMS</h3>
                    <p className="text-sm text-gray-600">Using template: {showSendModal.name}</p>
                  </div>

                  <div className="p-6 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Recipient Phone Number
                      </label>
                      <div className="relative">
                        <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="tel"
                          value={sendPhone}
                          onChange={(e) => setSendPhone(e.target.value)}
                          placeholder="+1 (555) 000-0000"
                          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                          disabled={sending}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Message Preview
                      </label>
                      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                        {showSendModal.content}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {showSendModal.content.length} characters • {Math.ceil(showSendModal.content.length / 160)} segment(s)
                      </p>
                    </div>

                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                      <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-800">
                        Variables like <code className="bg-amber-100 px-1 rounded">{'{{wine_name}}'}</code> will be replaced with actual values.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setShowSendModal(null)
                        setSendPhone('')
                      }}
                      disabled={sending}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSendSMS}
                      disabled={!sendPhone || sending}
                      className="flex items-center gap-2 px-5 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {sending ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Send SMS
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
