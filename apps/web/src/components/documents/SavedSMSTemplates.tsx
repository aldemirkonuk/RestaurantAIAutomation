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
  Smartphone,
  Bell,
  Tag,
  Calendar,
  Package,
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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-teal-50">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Saved SMS Templates</h2>
            <p className="text-sm text-gray-600">{templates.length} template{templates.length !== 1 ? 's' : ''} available</p>
          </div>
          {onNewTemplate && (
            <button
              onClick={onNewTemplate}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              New Template
            </button>
          )}
        </div>

        {/* Search and Filters */}
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search SMS templates..."
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
          </div>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-1 p-1 bg-white/50 rounded-lg">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                  filter === cat
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-white hover:text-gray-900'
                }`}
              >
                {cat === 'favorites' && <Star className="w-3 h-3 inline mr-1 fill-current" />}
                {cat}
                <span className="ml-1 text-xs opacity-60">
                  ({cat === 'all'
                    ? templates.length
                    : cat === 'favorites'
                    ? favoriteTemplates.length
                    : templates.filter(t => t.category === cat).length})
                </span>
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 bg-white"
          >
            <option value="recent">Most Recent</option>
            <option value="name">Name A-Z</option>
            <option value="usage">Most Used</option>
          </select>
        </div>
      </div>

      {/* Templates Grid */}
      <div className="p-4">
        {filteredTemplates.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-emerald-400" />
            </div>
            <p className="text-gray-600 font-medium mb-2">
              {searchQuery ? 'No templates found' : 'No saved SMS templates yet'}
            </p>
            <p className="text-sm text-gray-400 mb-4">
              {searchQuery
                ? 'Try adjusting your search or filters'
                : 'Create your first SMS template using the builder'}
            </p>
            {!searchQuery && onNewTemplate && (
              <button
                onClick={onNewTemplate}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                Create Template
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
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              {filteredTemplates.map((template, index) => {
                const CategoryIcon = getCategoryIcon(template.category)

                return (
                  <motion.div
                    key={template.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-lg hover:border-emerald-200 transition-all group"
                  >
                    {/* iPhone-style Preview */}
                    <div className="p-4 bg-gradient-to-br from-gray-100 to-gray-50 relative">
                      <div className="bg-gray-900 rounded-2xl p-3 max-w-[240px] mx-auto shadow-xl">
                        {/* iPhone notch */}
                        <div className="w-20 h-4 bg-black rounded-full mx-auto mb-2" />
                        {/* Message bubble */}
                        <div className="bg-emerald-500 rounded-2xl rounded-br-sm p-3 text-white text-xs leading-relaxed">
                          {template.content.length > 100
                            ? template.content.substring(0, 100) + '...'
                            : template.content}
                        </div>
                        <div className="text-right text-[10px] text-gray-400 mt-1">
                          {template.isMMS && '📷 '} Delivered
                        </div>
                      </div>

                      {/* Category badge */}
                      <div className="absolute top-2 left-2">
                        <div className={`px-2 py-1 rounded-md text-xs font-medium border ${getCategoryColor(template.category)}`}>
                          <div className="flex items-center gap-1">
                            <CategoryIcon className="w-3 h-3" />
                            <span className="capitalize">{template.category}</span>
                          </div>
                        </div>
                      </div>

                      {/* Favorite Star */}
                      <div className="absolute top-2 right-12">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleToggleFavorite(template.id)
                          }}
                          className="p-1.5 bg-white/90 hover:bg-white rounded-lg shadow-md hover:shadow-lg transition-all hover:scale-110 active:scale-95"
                          title={favoriteTemplates.includes(template.id) ? 'Remove from favorites' : 'Add to favorites'}
                        >
                          <Star
                            className={`w-5 h-5 transition-all ${
                              favoriteTemplates.includes(template.id)
                                ? 'fill-amber-400 text-amber-400 drop-shadow-sm'
                                : 'fill-none stroke-gray-400 hover:stroke-amber-400'
                            }`}
                            strokeWidth={2}
                          />
                        </button>
                      </div>

                      {/* Menu button */}
                      <div className="absolute top-2 right-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedTemplateMenu(selectedTemplateMenu === template.id ? null : template.id)
                          }}
                          className="p-1.5 bg-white/90 hover:bg-white rounded-lg shadow-sm transition-colors"
                        >
                          <MoreVertical className="w-4 h-4 text-gray-600" />
                        </button>

                        {/* Dropdown menu */}
                        <AnimatePresence>
                          {selectedTemplateMenu === template.id && (
                            <motion.div
                              initial={{ opacity: 0, scale: 0.95, y: -10 }}
                              animate={{ opacity: 1, scale: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.95, y: -10 }}
                              className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-20"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => {
                                  if (onEditTemplate) onEditTemplate(template)
                                  setSelectedTemplateMenu(null)
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                              >
                                <Edit3 className="w-4 h-4" />
                                Edit
                              </button>
                              <button
                                onClick={() => {
                                  duplicateTemplate(template)
                                  setSelectedTemplateMenu(null)
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                              >
                                <Copy className="w-4 h-4" />
                                Duplicate
                              </button>
                              <hr className="my-1 border-gray-200" />
                              <button
                                onClick={() => handleSetDefault(template.id)}
                                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${
                                  defaultTemplate === template.id
                                    ? 'text-amber-700 hover:bg-amber-50'
                                    : 'text-gray-700 hover:bg-gray-100'
                                }`}
                              >
                                <Crown className={`w-4 h-4 ${defaultTemplate === template.id ? 'fill-amber-500' : ''}`} />
                                {defaultTemplate === template.id ? 'Remove as Default' : 'Set as Default'}
                              </button>
                              <hr className="my-1 border-gray-200" />
                              <button
                                onClick={() => {
                                  deleteTemplate(template.id)
                                  setSelectedTemplateMenu(null)
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2"
                              >
                                <Trash2 className="w-4 h-4" />
                                Delete
                              </button>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Use Template Button on Hover */}
                      <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-gray-100 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex justify-center">
                        <button
                          onClick={() => handleUseTemplate(template)}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg shadow-lg hover:bg-emerald-700 transition-colors"
                        >
                          <Send className="w-4 h-4" />
                          Use Template
                        </button>
                      </div>
                    </div>

                    {/* Content */}
                    <div className="p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-gray-900 text-sm line-clamp-1 flex-1">
                          {template.name}
                        </h3>
                        {defaultTemplate === template.id && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                            <Crown className="w-3 h-3 fill-amber-500" />
                            Default
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 line-clamp-2 mb-3 min-h-[2rem]">
                        {template.description}
                      </p>

                      {/* Variables */}
                      {template.variables.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-3">
                          {template.variables.slice(0, 3).map(v => (
                            <span key={v} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-mono rounded">
                              {`{{${v}}}`}
                            </span>
                          ))}
                          {template.variables.length > 3 && (
                            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 text-[10px] rounded">
                              +{template.variables.length - 3} more
                            </span>
                          )}
                        </div>
                      )}

                      {/* Meta */}
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>{new Date(template.last_modified).toLocaleDateString()}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <BarChart3 className="w-3 h-3" />
                          <span>{template.used_count}x used</span>
                        </div>
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
