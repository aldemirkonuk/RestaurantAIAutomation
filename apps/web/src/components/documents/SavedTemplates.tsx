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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Saved Templates</h2>
            <p className="text-sm text-gray-600">{templates.length} template{templates.length !== 1 ? 's' : ''} available</p>
          </div>
          {onNewTemplate && (
            <button
              onClick={onNewTemplate}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors"
            >
              <Mail className="w-4 h-4" />
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
              placeholder="Search templates..."
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Category Filter */}
          <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-lg">
            {availableCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                  filter === cat
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {cat === 'favorites' && <Star className="w-3 h-3 inline mr-1 fill-amber-400 text-amber-400" />}
                {cat}
                <span className="ml-1 text-xs opacity-60">
                  ({cat === 'all' 
                    ? templates.length 
                    : cat === 'favorites' 
                    ? favoriteTemplates.length 
                    : templates.filter(t => String(t.category || 'custom').toLowerCase().trim() === String(cat).toLowerCase().trim()).length})
                </span>
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
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
                
                return (
                  <motion.div
                    key={template.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-white rounded-xl border border-gray-200 hover:shadow-lg hover:border-blue-200 transition-all group relative"
                  >
                  {/* Thumbnail */}
                  <div className="h-36 bg-gradient-to-br from-gray-100 to-gray-50 relative overflow-hidden rounded-t-xl">
                    <img 
                      src={template.thumbnail} 
                      alt={template.name}
                      className="w-full h-full object-cover"
                    />
                    
                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-all flex items-end justify-center pb-4">
                      <button
                        onClick={() => handleUseTemplate(template)}
                        className="flex items-center gap-2 px-4 py-2 bg-white text-gray-900 font-medium rounded-lg shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform"
                      >
                        <Send className="w-4 h-4" />
                        Use Template
                      </button>
                    </div>

                    {/* Category badge */}
                    <div className="absolute top-2 left-2 flex flex-col gap-1">
                      <div className={`px-2 py-1 rounded-md text-xs font-medium border ${getCategoryColor(template.category)}`}>
                        <div className="flex items-center gap-1">
                          <CategoryIcon className="w-3 h-3" />
                          <span className="capitalize">{template.category}</span>
                        </div>
                      </div>
                      {/* Show Default badge if this template is set as default */}
                      {defaultEmailTemplate === template.id && (
                        <div className="px-2 py-1 rounded-md text-xs font-medium border bg-amber-100 text-amber-700 border-amber-200">
                          <div className="flex items-center gap-1">
                            <Star className="w-3 h-3 fill-current" />
                            <span>Default</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Favorite Star Button - Enhanced Interactive */}
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
                    <div className="absolute top-2 right-2 z-10">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedTemplateMenu(selectedTemplateMenu === template.id ? null : template.id)
                        }}
                        className="p-1.5 bg-white/90 hover:bg-white rounded-lg shadow-sm transition-colors"
                      >
                        <MoreVertical className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                  </div>

                  {/* Dropdown menu - OUTSIDE thumbnail to avoid overflow clipping */}
                  <AnimatePresence>
                    {selectedTemplateMenu === template.id && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -10 }}
                        className="absolute top-10 right-2 w-48 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-[100]"
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
                        {defaultEmailTemplate === template.id ? (
                          <button
                            onClick={() => {
                              const updated = { ...templateDefaults }
                              delete updated['email']
                              updatePreferences({ templateDefaults: updated })
                              setSelectedTemplateMenu(null)
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-amber-700 hover:bg-amber-50 flex items-center gap-2"
                          >
                            <Star className="w-4 h-4 fill-amber-500" />
                            Remove as Default
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              updatePreferences({
                                templateDefaults: {
                                  ...templateDefaults,
                                  email: { templateId: template.id, templateName: template.name },
                                },
                              })
                              setSelectedTemplateMenu(null)
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2"
                          >
                            <Star className="w-4 h-4" />
                            Set as Default
                          </button>
                        )}
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

                  {/* Content */}
                  <div className="p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-gray-900 text-sm line-clamp-1 flex-1">
                        {template.name}
                      </h3>
                      {defaultEmailTemplate === template.id && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">
                          <Crown className="w-3 h-3 fill-amber-500" />
                          Default
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2 mb-3 min-h-[2rem]">
                      {template.description}
                    </p>

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
