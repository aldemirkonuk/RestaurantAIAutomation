import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Header } from '../components/layout/Header'
import { Card, Button } from '../components/ui'
import {
  FileText,
  Mail,
  MessageSquare,
  Download,
  Eye,
  Edit,
  Copy,
  Trash2,
  Plus,
  Calendar,
  Clock,
  Send,
  Save,
  Sparkles,
  Zap,
  LayoutTemplate,
  Upload,
  ChevronDown,
  FileInput,
  Wand2,
  Library,
  Search,
} from 'lucide-react'
import { GmailTemplateBuilder, SavedTemplate } from '../components/documents/GmailTemplateBuilder'
import { SMSTemplateBuilder } from '../components/documents/SMSTemplateBuilder'
import { SavedTemplates } from '../components/documents/SavedTemplates'
import { SavedSMSTemplates, SavedSMSTemplate } from '../components/documents/SavedSMSTemplates'
import { ReportScheduler } from '../components/communications/ReportScheduler'
import {
  useConversations,
  useConversationStats,
  type ConversationFilters,
} from '../hooks/queries/useConversationQueries'

type DocumentType = 'email' | 'sms' | 'report' | 'notification'

interface Document {
  id: string
  name: string
  type: DocumentType
  description: string
  lastModified: Date
  createdAt: Date
  category: 'communication' | 'report' | 'notification'
}

// Quick template presets for common use cases
const QUICK_TEMPLATES = [
  { id: 'order-confirm', name: 'Order Confirmation', category: 'Orders' },
  { id: 'delivery-update', name: 'Delivery Update', category: 'Orders' },
  { id: 'provider-intro', name: 'Provider Introduction', category: 'Providers' },
  { id: 'inventory-alert', name: 'Low Stock Alert', category: 'Inventory' },
  { id: 'follow-up', name: 'Follow-up Email', category: 'General' },
  { id: 'thank-you', name: 'Thank You Note', category: 'General' },
]

function ApiCommunicationHistory() {
  const [searchQuery, setSearchQuery] = useState('')
  const [filterChannel, setFilterChannel] = useState<string>('')
  const [page, setPage] = useState(1)

  const filters: ConversationFilters = {
    channel: filterChannel || undefined,
    search: searchQuery || undefined,
    page,
    limit: 20,
    sortBy: 'created_at',
    sortOrder: 'desc',
  }

  const { data: conversationsData, isLoading, error } = useConversations(filters)
  const { data: statsData } = useConversationStats()

  const conversations = conversationsData?.conversations || []
  const total = conversationsData?.total || 0
  const totalPages = conversationsData?.totalPages || 0

  const channelConfig: Record<string, { icon: any; color: string; label: string }> = {
    email: { icon: Mail, color: 'bg-blue-100 text-blue-600', label: 'Email' },
    sms: { icon: MessageSquare, color: 'bg-emerald-100 text-emerald-600', label: 'SMS' },
    voice: { icon: FileText, color: 'bg-purple-100 text-purple-600', label: 'Voice' },
    whatsapp: { icon: MessageSquare, color: 'bg-green-100 text-green-600', label: 'WhatsApp' },
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(channelConfig).map(([channel, config]) => {
          const Icon = config.icon
          const count = (statsData?.byChannel as any)?.[channel] || 0
          return (
            <button
              key={channel}
              onClick={() => setFilterChannel(filterChannel === channel ? '' : channel)}
              className={`p-4 rounded-xl border-2 transition-all ${
                filterChannel === channel
                  ? 'border-wine-500 bg-wine-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`w-8 h-8 ${config.color} rounded-lg flex items-center justify-center mx-auto mb-2`}>
                <Icon className="w-4 h-4" />
              </div>
              <p className="text-lg font-bold text-gray-900">{count}</p>
              <p className="text-xs text-gray-500">{config.label}</p>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
          placeholder="Search conversations..."
          className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-wine-500 focus:border-transparent"
        />
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Communication History</h3>
          <p className="text-sm text-gray-500">{total} conversations {isLoading && '(loading...)'}</p>
        </div>

        <div className="divide-y divide-gray-100">
          {isLoading ? (
            <div className="p-12 text-center">
              <Clock className="w-8 h-8 text-wine-400 mx-auto mb-3 animate-spin" />
              <p className="text-gray-600">Loading...</p>
            </div>
          ) : error ? (
            <div className="p-12 text-center">
              <p className="text-gray-600">Failed to load conversations</p>
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-12 text-center">
              <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No conversations found</p>
            </div>
          ) : (
            conversations.map((conv) => {
              const conf = channelConfig[conv.channel] || channelConfig.email
              const Icon = conf.icon
              return (
                <div key={conv.id} className="px-6 py-4 hover:bg-gray-50/50 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className={`p-2 ${conf.color} rounded-xl flex-shrink-0`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 truncate">
                        {conv.procurement_orders?.wine_name || conv.detected_intent || 'Conversation'}
                      </h4>
                      <p className="text-sm text-gray-500 truncate">
                        {conv.providers?.name || 'Unknown vendor'}
                      </p>
                      <p className="text-sm text-gray-600 line-clamp-1 mt-1">{conv.message_text}</p>
                    </div>
                    <span className="text-xs text-gray-500 flex-shrink-0">
                      {conv.created_at ? new Date(conv.created_at).toLocaleDateString() : '—'}
                    </span>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function Communications() {
  const [selectedTab, setSelectedTab] = useState<'templates' | 'history' | 'scheduled-reports'>('templates')
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'communication' | 'report' | 'notification'>('communication')
  const [showGmailBuilder, setShowGmailBuilder] = useState(false)
  const [showSMSBuilder, setShowSMSBuilder] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<SavedTemplate | null>(null)
  const [editingSMSTemplate, setEditingSMSTemplate] = useState<SavedSMSTemplate | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [smsRefreshKey, setSmsRefreshKey] = useState(0)
  const [showQuickTemplatesMenu, setShowQuickTemplatesMenu] = useState(false)
  const [isGeneratingAI, setIsGeneratingAI] = useState(false)

  // Email Template handlers
  const handleEditTemplate = useCallback((template: SavedTemplate) => {
    setEditingTemplate(template)
    setShowGmailBuilder(true)
  }, [])

  const handleDuplicateTemplate = useCallback((template: SavedTemplate) => {
    setRefreshKey(prev => prev + 1)
  }, [])

  const handleDeleteTemplate = useCallback((templateId: string) => {
    setRefreshKey(prev => prev + 1)
  }, [])

  const handleUseTemplate = useCallback((template: SavedTemplate) => {
    console.log('Using template:', template.name)
  }, [])

  const handleNewTemplate = useCallback(() => {
    setEditingTemplate(null)
    setShowGmailBuilder(true)
  }, [])

  const handleSaveTemplate = useCallback((template: SavedTemplate) => {
    setRefreshKey(prev => prev + 1)
  }, [])

  const handleCloseBuilder = useCallback(() => {
    setShowGmailBuilder(false)
    setEditingTemplate(null)
    setRefreshKey(prev => prev + 1)
  }, [])

  // Import template from file
  const handleImportTemplate = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.html'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (event) => {
          try {
            const content = event.target?.result as string
            // Parse and validate imported template
            if (file.name.endsWith('.json')) {
              const template = JSON.parse(content)
              console.log('Imported template:', template)
              alert(`Template "${template.name || 'Untitled'}" imported successfully!`)
            } else {
              // HTML template - create new with imported content
              console.log('Imported HTML template')
              alert('HTML template imported! Opening editor...')
            }
            setShowGmailBuilder(true)
            setRefreshKey(prev => prev + 1)
          } catch (error) {
            console.error('Failed to import template:', error)
            alert('Failed to import template. Please check the file format.')
          }
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }, [])

  // Quick template selection
  const handleQuickTemplate = useCallback((templateId: string) => {
    console.log('Loading quick template:', templateId)
    setShowQuickTemplatesMenu(false)
    // In a real implementation, this would load the preset template
    setShowGmailBuilder(true)
  }, [])

  // AI generate template
  const handleAIGenerate = useCallback(async () => {
    setIsGeneratingAI(true)
    // Simulate AI generation
    setTimeout(() => {
      setIsGeneratingAI(false)
      setShowGmailBuilder(true)
      // In a real implementation, this would open the builder with AI-generated content
    }, 1500)
  }, [])
  
  // SMS Template handlers
  const handleEditSMSTemplate = useCallback((template: SavedSMSTemplate) => {
    setEditingSMSTemplate(template)
    setShowSMSBuilder(true)
  }, [])

  const handleDuplicateSMSTemplate = useCallback((template: SavedSMSTemplate) => {
    setSmsRefreshKey(prev => prev + 1)
  }, [])

  const handleDeleteSMSTemplate = useCallback((templateId: string) => {
    setSmsRefreshKey(prev => prev + 1)
  }, [])

  const handleUseSMSTemplate = useCallback((template: SavedSMSTemplate) => {
    console.log('Using SMS template:', template.name)
  }, [])

  const handleNewSMSTemplate = useCallback(() => {
    setEditingSMSTemplate(null)
    setShowSMSBuilder(true)
  }, [])

  const handleCloseSMSBuilder = useCallback(() => {
    setShowSMSBuilder(false)
    setEditingSMSTemplate(null)
    setSmsRefreshKey(prev => prev + 1)
  }, [])

  const getTypeIcon = (type: DocumentType) => {
    switch (type) {
      case 'email': return Mail
      case 'sms': return MessageSquare
      case 'report': return FileText
      case 'notification': return Send
    }
  }

  const getTypeColor = (type: DocumentType) => {
    switch (type) {
      case 'email': return 'bg-blue-100 text-blue-600'
      case 'sms': return 'bg-green-100 text-green-600'
      case 'report': return 'bg-purple-100 text-purple-600'
      case 'notification': return 'bg-orange-100 text-orange-600'
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header 
        title="Documents & Templates" 
        subtitle="Manage communication templates, reports, and notifications" 
      />

      <div className="p-6">
        {/* Tabs */}
        <div className="flex gap-4 mb-6">
          <Button
            variant={selectedTab === 'templates' ? 'default' : 'outline'}
            onClick={() => setSelectedTab('templates')}
            className={selectedTab === 'templates' ? 'bg-wine-600' : ''}
          >
            <LayoutTemplate className="w-4 h-4 mr-2" />
            Templates
          </Button>
          <Button
            variant={selectedTab === 'history' ? 'default' : 'outline'}
            onClick={() => setSelectedTab('history')}
            className={selectedTab === 'history' ? 'bg-wine-600' : ''}
          >
            <Clock className="w-4 h-4 mr-2" />
            Communication History
          </Button>
          <Button
            variant={selectedTab === 'scheduled-reports' ? 'default' : 'outline'}
            onClick={() => setSelectedTab('scheduled-reports')}
            className={selectedTab === 'scheduled-reports' ? 'bg-wine-600' : ''}
          >
            <Calendar className="w-4 h-4 mr-2" />
            Scheduled Reports
          </Button>
        </div>

        {selectedTab === 'templates' && (
          <>
            {/* Two-Column Hero Section - Email & SMS Builders */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
              {/* Gmail Template Builder CTA */}
              <Card variant="glass" padding="lg" className="overflow-hidden relative">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 via-transparent to-indigo-600/5" />
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl shadow-lg shadow-blue-600/30">
                        <Mail className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-xl font-bold text-gray-900">Email Templates</h2>
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded-full flex items-center gap-1">
                        <Sparkles className="w-3 h-3" />
                        Enhanced
                      </span>
                    </div>
                        <p className="text-sm text-gray-600">
                          Professional email templates with drag-and-drop components
                    </p>
                      </div>
                    </div>
                  </div>

                  {/* Feature highlights */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                      { icon: Zap, label: 'Dynamic Variables' },
                      { icon: LayoutTemplate, label: '10+ Components' },
                      { icon: Eye, label: 'Live Preview' },
                      { icon: Save, label: 'Save & Reuse' },
                    ].map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-blue-50/50 rounded-lg">
                        <feature.icon className="w-4 h-4 text-blue-600" />
                        <span className="text-xs font-medium text-gray-700">{feature.label}</span>
                      </div>
                    ))}
                </div>

                {/* Primary Create Button */}
                <Button
                  variant="default"
                  onClick={handleNewTemplate}
                    className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-600/30"
                >
                  <Plus className="w-4 h-4 mr-2" />
                    Create Email Template
                </Button>

                {/* Secondary Action Buttons */}
                <div className="flex gap-2 mt-3">
                  {/* Import Template */}
                  <button
                    onClick={handleImportTemplate}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all text-sm font-medium"
                  >
                    <Upload className="w-4 h-4" />
                    Import
                  </button>

                  {/* Quick Templates Dropdown */}
                  <div className="flex-1 relative">
                    <button
                      onClick={() => setShowQuickTemplatesMenu(!showQuickTemplatesMenu)}
                      className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all text-sm font-medium"
                    >
                      <Library className="w-4 h-4" />
                      Quick
                      <ChevronDown className={`w-3 h-3 transition-transform ${showQuickTemplatesMenu ? 'rotate-180' : ''}`} />
                    </button>
                    
                    {showQuickTemplatesMenu && (
                      <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-10 max-h-64 overflow-y-auto">
                        <p className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase">Quick Templates</p>
                        {QUICK_TEMPLATES.map((template) => (
                          <button
                            key={template.id}
                            onClick={() => handleQuickTemplate(template.id)}
                            className="w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                          >
                            <p className="text-sm font-medium text-gray-900">{template.name}</p>
                            <p className="text-xs text-gray-500">{template.category}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* AI Generate */}
                  <button
                    onClick={handleAIGenerate}
                    disabled={isGeneratingAI}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 hover:border-purple-300 transition-all text-sm font-medium disabled:opacity-50"
                  >
                    {isGeneratingAI ? (
                      <>
                        <div className="w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-4 h-4" />
                        AI
                      </>
                    )}
                  </button>
                </div>
              </div>
              </Card>

              {/* SMS Template Builder CTA */}
              <Card variant="glass" padding="lg" className="overflow-hidden relative">
                <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/5 via-transparent to-teal-600/5" />
                <div className="relative">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl shadow-lg shadow-emerald-500/30">
                        <MessageSquare className="w-6 h-6 text-white" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-xl font-bold text-gray-900">SMS Templates</h2>
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-full flex items-center gap-1">
                            <Sparkles className="w-3 h-3" />
                            New
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">
                          Professional SMS templates with iPhone preview
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Feature highlights */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                      { icon: Zap, label: 'Variables Support' },
                      { icon: Eye, label: 'iPhone Preview' },
                      { icon: LayoutTemplate, label: 'Character Count' },
                      { icon: Save, label: 'Template Library' },
                    ].map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-emerald-50/50 rounded-lg">
                        <feature.icon className="w-4 h-4 text-emerald-600" />
                        <span className="text-xs font-medium text-gray-700">{feature.label}</span>
                  </div>
                ))}
                  </div>

                  <Button
                    variant="default"
                    onClick={handleNewSMSTemplate}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg shadow-emerald-500/30"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create SMS Template
                  </Button>
              </div>
            </Card>
            </div>

            {/* Two-Column Saved Templates Section - Email & SMS Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Saved Email Templates */}
              <div>
              <SavedTemplates
                key={refreshKey}
                onEditTemplate={handleEditTemplate}
                onDuplicateTemplate={handleDuplicateTemplate}
                onDeleteTemplate={handleDeleteTemplate}
                onUseTemplate={handleUseTemplate}
                onNewTemplate={handleNewTemplate}
              />
            </div>

              {/* Saved SMS Templates */}
              <div>
                <SavedSMSTemplates
                  key={smsRefreshKey}
                  onEditTemplate={handleEditSMSTemplate}
                  onDuplicateTemplate={handleDuplicateSMSTemplate}
                  onDeleteTemplate={handleDeleteSMSTemplate}
                  onUseTemplate={handleUseSMSTemplate}
                  onNewTemplate={handleNewSMSTemplate}
                />
                </div>
            </div>
          </>
        )}

        {selectedTab === 'history' && (
          <ApiCommunicationHistory />
        )}

        {selectedTab === 'scheduled-reports' && (
          <ReportScheduler
            onSchedule={(config) => {
              console.log('Report schedule saved:', config)
            }}
            onGenerateNow={(reportType, format) => {
              console.log('Generating report now:', reportType, format)
            }}
          />
        )}
      </div>

      {/* Gmail Template Builder Modal */}
      {showGmailBuilder && (
        <GmailTemplateBuilder 
          onClose={handleCloseBuilder}
          onSave={handleSaveTemplate}
          editingTemplate={editingTemplate}
        />
      )}

      {/* SMS Template Builder Modal */}
      {showSMSBuilder && (
        <SMSTemplateBuilder 
          onClose={handleCloseSMSBuilder}
          onSave={() => setSmsRefreshKey(prev => prev + 1)}
        />
      )}
    </div>
  )
}
export default Communications
