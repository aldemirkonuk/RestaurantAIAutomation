import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText,
  Edit3,
  Copy,
  Trash2,
  BarChart3,
  Send,
  Mail,
  Package,
  DollarSign,
  Search,
  MoreVertical,
  Check,
  AlertCircle,
  Clock,
  Star,
  Crown,
} from 'lucide-react'
import { SavedTemplate } from './GmailTemplateBuilder'
import { defaultTemplates, templateCategories } from '../../data/emailTemplateCategories'
import { getUserCategories } from '../../data/userTemplateCategories'
import { useTemplates } from '../../hooks/useTemplates'
import { useUserPreferences } from '../../hooks/useUserPreferences'

interface SavedTemplatesProps {
  onEditTemplate?: (template: SavedTemplate) => void
  onDuplicateTemplate?: (template: SavedTemplate) => void
  onDeleteTemplate?: (templateId: string) => void
  onUseTemplate?: (template: SavedTemplate) => void
  onNewTemplate?: () => void
}

export function SavedTemplates({ 
  onEditTemplate, 
  onDuplicateTemplate, 
  onDeleteTemplate, 
  onUseTemplate,
  onNewTemplate 
}: SavedTemplatesProps) {
  const { templates: apiTemplates, deleteTemplate: apiDeleteTemplate, createTemplate: apiCreateTemplate, updateTemplate: apiUpdateTemplate } = useTemplates()
  const { preferences, updatePreferences } = useUserPreferences()
  const [filter, setFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'recent' | 'name' | 'usage'>('recent')
  const [selectedTemplateMenu, setSelectedTemplateMenu] = useState<string | null>(null)
  const [showSendModal, setShowSendModal] = useState<SavedTemplate | null>(null)
  const [sendEmail, setSendEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sendSuccess, setSendSuccess] = useState(false)

  const favoriteTemplates: string[] = preferences.templateFavorites ?? []
  const templateDefaults = preferences.templateDefaults ?? {}
  const defaultEmailTemplate = templateDefaults['email']?.templateId ?? null

  // Build the merged template list: API templates + hardcoded defaults
  const templates = useMemo(() => {
    const convertedDefaults: SavedTemplate[] = defaultTemplates.map((template) => {
      const normalizedCategory = (template.category || 'custom').toLowerCase().trim() as 'inventory' | 'financial' | 'order' | 'custom'
      return {
        id: template.id,
        name: template.name,
        description: template.description || '',
        subject: template.subject,
        thumbnail: `data:image/svg+xml,${encodeURIComponent(`
          <svg width="400" height="200" xmlns="http://www.w3.org/2000/svg">
            <rect width="400" height="200" fill="${templateCategories.find(c => c.name.toLowerCase() === normalizedCategory)?.color || '#6B7280'}"/>
            <text x="200" y="100" font-family="Arial" font-size="24" fill="white" text-anchor="middle" dominant-baseline="middle">${template.name}</text>
          </svg>
        `)}`,
        category: normalizedCategory,
        panels: template.panels.map(panel => ({
          id: panel.id,
          type: 'text' as any,
          title: '',
          content: panel.config,
          config: {
            backgroundColor: '#FFFFFF',
            textColor: '#1F2937',
            fontSize: 'medium' as const,
            padding: 'medium' as const,
            alignment: 'left' as const,
            borderRadius: 'medium' as const,
          }
        })),
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

  const [availableCategories, setAvailableCategories] = useState<string[]>([])

  useEffect(() => {
    const categories = new Set<string>(['all', 'favorites'])
    templateCategories.forEach(cat => categories.add(cat.name.toLowerCase()))
    getUserCategories().forEach(cat => categories.add(cat.name.toLowerCase()))
    templates.forEach(t => categories.add(t.category.toLowerCase()))
    setAvailableCategories(Array.from(categories))
  }, [templates])

  useEffect(() => {
    const handleClick = () => setSelectedTemplateMenu(null)
    if (selectedTemplateMenu) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [selectedTemplateMenu])

  const duplicateTemplate = async (template: SavedTemplate) => {
    const { id: _id, ...rest } = template
    try {
      await apiCreateTemplate({
        ...rest,
        name: `${template.name} (Copy)`,
        created_at: new Date(),
        last_modified: new Date(),
        used_count: 0,
      })
    } catch {
      console.error('Failed to duplicate template')
    }
    onDuplicateTemplate?.(template)
  }

  const deleteTemplate = async (id: string) => {
    const template = templates.find(t => t.id === id)
    if (!template) return

    if (confirm(`Delete "${template.name}"?\n\nThis action cannot be undone.`)) {
      try {
        await apiDeleteTemplate(id)
      } catch {
        console.error('Failed to delete template')
      }
      onDeleteTemplate?.(id)
    }
  }

  const handleUseTemplate = (template: SavedTemplate) => {
    setShowSendModal(template)
  }

  const handleSendEmail = async () => {
    if (!sendEmail || !showSendModal) return
    
    setSending(true)
    
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    try {
      await apiUpdateTemplate(showSendModal.id, {
        used_count: showSendModal.used_count + 1,
        last_modified: new Date(),
      })
    } catch {
      // Non-critical: usage tracking failure shouldn't block send
    }
    
    setSending(false)
    setSendSuccess(true)
    
    setTimeout(() => {
      setShowSendModal(null)
      setSendEmail('')
      setSendSuccess(false)
    }, 2000)
    
    onUseTemplate?.(showSendModal)
  }

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'inventory': return Package
      case 'financial': return DollarSign
      case 'order': return Send
      default: return FileText
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'inventory':
        return 'bg-blue-100 text-blue-700 border-blue-200'
      case 'financial':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200'
      case 'order':
        return 'bg-purple-100 text-purple-700 border-purple-200'
      case 'custom':
        return 'bg-gray-100 text-gray-700 border-gray-200'
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200'
    }
  }

  const handleToggleFavorite = (templateId: string) => {
    const current = [...favoriteTemplates]
    const idx = current.indexOf(templateId)
    if (idx > -1) {
      current.splice(idx, 1)
    } else {
      current.push(templateId)
    }
    updatePreferences({ templateFavorites: current })
  }

  // Filter and sort templates - Use useMemo to ensure proper re-renders
  const filteredTemplates = useMemo(() => {
    // CRITICAL: Normalize filter value and ensure strict comparison
    const normalizedFilter = String(filter || 'all').toLowerCase().trim()

    // Step 1: Filter by category
    let filtered = normalizedFilter === 'all'
      ? [...templates] // Create new array to ensure React detects changes
      : normalizedFilter === 'favorites'
      ? templates.filter(t => favoriteTemplates.includes(t.id))
      : templates.filter(t => {
          // Normalize template category for comparison - handle all edge cases
          const rawCategory = t.category
          const templateCategory = (typeof rawCategory === 'string' ? rawCategory : 'custom').toLowerCase().trim()
          const matches = templateCategory === normalizedFilter
          return matches
        })

    // Step 2: Apply search
    if (searchQuery) {
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    // Step 3: Apply sort
    return [...filtered].sort((a, b) => {
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
              <Mail className="w-4 h-4 text-blue-500" />
              Email Templates
              <span className="text-xs font-semibold px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">{templates.length}</span>
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{templates.reduce((s, t) => s + t.used_count, 0)} total sends</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 w-44 transition-all"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/30 cursor-pointer bg-white"
            >
              <option value="recent">Recent</option>
              <option value="name">A–Z</option>
              <option value="usage">Most used</option>
            </select>
            {onNewTemplate && (
              <button
                onClick={onNewTemplate}
                className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                <Mail className="w-3.5 h-3.5" />
                New
              </button>
            )}
          </div>
        </div>

        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          {availableCategories.map((cat) => {
            const count = cat === 'all'
              ? templates.length
              : cat === 'favorites'
              ? favoriteTemplates.length
              : templates.filter(t => String(t.category || 'custom').toLowerCase().trim() === cat).length
            return (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={[
                  'flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all border',
                  filter === cat
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-200'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-blue-300 hover:text-blue-600',
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
      <div className="p-4">
        {filteredTemplates.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <FileText className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-600 font-medium mb-2">
              {searchQuery ? 'No templates found' : 'No saved templates yet'}
            </p>
            <p className="text-sm text-gray-400 mb-4">
              {searchQuery 
                ? 'Try adjusting your search or filters'
                : 'Create your first template using the Gmail Template Builder'}
            </p>
            {!searchQuery && onNewTemplate && (
              <button
                onClick={onNewTemplate}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                <Mail className="w-4 h-4" />
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
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {filteredTemplates.map((template, index) => {
                const CategoryIcon = getCategoryIcon(template.category)
                const isFav = favoriteTemplates.includes(template.id)
                const isDefault = defaultEmailTemplate === template.id

                // Per-category accent colours for the preview mockup
                const accent = template.category === 'inventory'
                  ? { bg: '#eff6ff', bar: '#3b82f6', barText: '#1d4ed8' }
                  : template.category === 'financial'
                  ? { bg: '#f0fdf4', bar: '#10b981', barText: '#065f46' }
                  : template.category === 'order'
                  ? { bg: '#f5f3ff', bar: '#8b5cf6', barText: '#5b21b6' }
                  : { bg: '#f9fafb', bar: '#6b7280', barText: '#374151' }

                return (
                  <motion.div
                    key={template.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ delay: index * 0.04, duration: 0.25 }}
                    className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:border-blue-100 transition-all duration-300 group relative flex flex-col overflow-visible"
                  >
                    {/* ── Preview: mini email mockup ── */}
                    <div
                      className="h-44 rounded-t-2xl relative overflow-hidden flex items-center justify-center"
                      style={{ background: accent.bg }}
                    >
                      {/* Decorative orbs */}
                      <div className="absolute -top-8 -right-8 w-28 h-28 rounded-full opacity-20"
                        style={{ background: accent.bar }} />
                      <div className="absolute -bottom-6 -left-6 w-20 h-20 rounded-full opacity-10"
                        style={{ background: accent.bar }} />

                      {/* Mini email paper */}
                      <div className="relative z-10 w-[82%] bg-white rounded-xl shadow-lg overflow-hidden">
                        {/* Email chrome bar */}
                        <div className="h-7 px-3 flex items-center gap-2" style={{ background: accent.bar }}>
                          <div className="flex gap-1 mr-1">
                            <div className="w-2 h-2 rounded-full bg-white/30" />
                            <div className="w-2 h-2 rounded-full bg-white/30" />
                            <div className="w-2 h-2 rounded-full bg-white/30" />
                          </div>
                          <span className="text-[8px] font-semibold text-white/90 truncate flex-1">
                            {template.subject || template.name}
                          </span>
                        </div>
                        {/* Body lines */}
                        <div className="p-3 space-y-1.5">
                          <div className="h-1.5 rounded-full bg-gray-200 w-2/3" />
                          <div className="h-1.5 rounded-full bg-gray-100 w-full" />
                          <div className="h-1.5 rounded-full bg-gray-100 w-5/6" />
                          <div className="h-1.5 rounded-full bg-gray-100 w-3/4" />
                          <div className="h-1.5 rounded-full bg-gray-100 w-1/2" />
                          <div className="mt-2.5 h-5 rounded-lg w-1/3 opacity-60"
                            style={{ background: accent.bar }} />
                        </div>
                      </div>

                      {/* Top-left badges */}
                      <div className="absolute top-2.5 left-2.5 flex flex-col gap-1">
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getCategoryColor(template.category)} backdrop-blur-sm bg-white/80`}>
                          <CategoryIcon className="w-3 h-3" />
                          <span className="capitalize">{template.category}</span>
                        </div>
                        {isDefault && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100/90 text-amber-700 border border-amber-200 backdrop-blur-sm">
                            <Crown className="w-3 h-3 fill-amber-500" />
                            Default
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

                      {/* Hover overlay — Use button */}
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center rounded-t-2xl">
                        <button
                          onClick={() => handleUseTemplate(template)}
                          className="flex items-center gap-2 px-4 py-2 bg-white text-gray-900 font-semibold text-sm rounded-xl shadow-xl translate-y-2 group-hover:translate-y-0 transition-transform duration-200"
                        >
                          <Send className="w-4 h-4" />
                          Use Template
                        </button>
                      </div>
                    </div>

                    {/* Dropdown menu */}
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
                          {isDefault ? (
                            <button onClick={() => { const u = { ...templateDefaults }; delete u['email']; updatePreferences({ templateDefaults: u }); setSelectedTemplateMenu(null) }}
                              className="w-full px-3 py-2 text-left text-sm text-amber-700 hover:bg-amber-50 flex items-center gap-2 transition-colors">
                              <Star className="w-4 h-4 fill-amber-400" /> Remove Default
                            </button>
                          ) : (
                            <button onClick={() => { updatePreferences({ templateDefaults: { ...templateDefaults, email: { templateId: template.id, templateName: template.name } } }); setSelectedTemplateMenu(null) }}
                              className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2 transition-colors">
                              <Star className="w-4 h-4 text-gray-400" /> Set as Default
                            </button>
                          )}
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
                      <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed mb-3 min-h-[2.5rem]">
                        {template.description}
                      </p>
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
                          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm shadow-blue-200"
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
        <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-t border-blue-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Mail className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-900">
                  {templates.length} Template{templates.length !== 1 ? 's' : ''}
                </p>
                <p className="text-xs text-blue-700">
                  {templates.reduce((sum, t) => sum + t.used_count, 0)} total sends
                </p>
              </div>
            </div>
            {templates.length > 0 && (
              <div className="text-right">
                <p className="text-xs text-blue-700">Most popular:</p>
                <p className="text-sm font-medium text-blue-900">
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
                setSendEmail('')
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
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Email Sent!</h3>
                  <p className="text-gray-600">Your email has been sent successfully.</p>
                </div>
              ) : (
                <>
                  <div className="p-6 border-b border-gray-200">
                    <h3 className="text-lg font-bold text-gray-900 mb-1">Send Email</h3>
                    <p className="text-sm text-gray-600">Using template: {showSendModal.name}</p>
                  </div>

                  <div className="p-6 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Recipient Email
                      </label>
                      <input
                        type="email"
                        value={sendEmail}
                        onChange={(e) => setSendEmail(e.target.value)}
                        placeholder="provider@example.com"
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        disabled={sending}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Subject
                      </label>
                      <input
                        type="text"
                        value={showSendModal.subject || 'No subject'}
                        readOnly
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600"
                      />
                    </div>

                    <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
                      <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-amber-800">
                        Template variables like <code className="bg-amber-100 px-1 rounded">{'{{date}}'}</code> will be replaced with actual values when sent.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setShowSendModal(null)
                        setSendEmail('')
                      }}
                      disabled={sending}
                      className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSendEmail}
                      disabled={!sendEmail || sending}
                      className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {sending ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Sending...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Send Email
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
