import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X,
  Plus,
  Type,
  Image as ImageIcon,
  BarChart3,
  PieChart,
  Table,
  DollarSign,
  TrendingUp,
  Mail,
  Download,
  Eye,
  Save,
  Trash2,
  Palette,
  Layout,
  ChevronUp,
  ChevronDown,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Send,
  Copy,
  Check,
  Wine,
  Package,
  Truck,
  Calendar,
  Clock,
  FileText,
  Sparkles,
  Monitor,
  Smartphone,
  Tablet,
  Star,
  Reply,
  Forward,
  MoreVertical,
  Paperclip,
  Archive,
  Inbox,
  User,
  Edit3,
  GripVertical,
} from 'lucide-react'
import { templateCategories, defaultTemplates } from '../../data/emailTemplateCategories'
import { getUserCategories } from '../../data/userTemplateCategories'
import { NewCategoryModal } from './NewCategoryModal'
import { VariationSelectorModal } from './VariationSelectorModal'
import { getCombinedSuggestions, searchRecipients, addEmailRecipient } from '../../data/emailRecipients'
import { PreviewOverlay } from '../reports/preview'

type PanelType = 'text' | 'image' | 'chart-bar' | 'chart-pie' | 'table' | 'financial' | 'metric' | 'header' | 'divider' | 'spacer' | 'button'

interface TemplatePanel {
  id: string
  type: PanelType
  title: string
  content: any
  config: {
    backgroundColor?: string
    textColor?: string
    fontSize?: 'small' | 'medium' | 'large'
    padding?: 'small' | 'medium' | 'large'
    alignment?: 'left' | 'center' | 'right'
    borderRadius?: 'none' | 'small' | 'medium' | 'large'
  }
}

interface GmailTemplateBuilderProps {
  onClose: () => void
  onSave?: (template: SavedTemplate) => void
  editingTemplate?: SavedTemplate | null
}

export interface SavedTemplate {
  id: string
  name: string
  description: string
  subject: string
  panels: TemplatePanel[]
  thumbnail: string
  category: 'inventory' | 'financial' | 'order' | 'custom'
  created_at: Date
  last_modified: Date
  used_count: number
}

// Template variable suggestions
const TEMPLATE_VARIABLES = [
  { key: '{{restaurant_name}}', label: 'Restaurant Name', icon: FileText },
  { key: '{{date}}', label: 'Current Date', icon: Calendar },
  { key: '{{time}}', label: 'Current Time', icon: Clock },
  { key: '{{wine_name}}', label: 'Wine Name', icon: Wine },
  { key: '{{wine_count}}', label: 'Wine Count', icon: Package },
  { key: '{{provider_name}}', label: 'Provider Name', icon: Truck },
  { key: '{{total_value}}', label: 'Total Value', icon: DollarSign },
  { key: '{{order_id}}', label: 'Order ID', icon: FileText },
]

// Preset color palettes
const COLOR_PALETTES = [
  { name: 'Wine Theme', primary: '#991B1B', secondary: '#FEF2F2', accent: '#B91C1C' },
  { name: 'Ocean Blue', primary: '#1E40AF', secondary: '#EFF6FF', accent: '#2563EB' },
  { name: 'Forest Green', primary: '#166534', secondary: '#F0FDF4', accent: '#16A34A' },
  { name: 'Sunset Orange', primary: '#C2410C', secondary: '#FFF7ED', accent: '#EA580C' },
  { name: 'Royal Purple', primary: '#6B21A8', secondary: '#FAF5FF', accent: '#7C3AED' },
  { name: 'Professional Gray', primary: '#374151', secondary: '#F9FAFB', accent: '#6B7280' },
]

export function GmailTemplateBuilder({ onClose, onSave, editingTemplate }: GmailTemplateBuilderProps) {
  const [templateName, setTemplateName] = useState(editingTemplate?.name || 'New Gmail Template')
  const [templateSubject, setTemplateSubject] = useState(editingTemplate?.subject || 'Weekly Wine Report - {{date}}')
  const [templateDescription, setTemplateDescription] = useState(editingTemplate?.description || '')
  const [templateCategory, setTemplateCategory] = useState<string>(editingTemplate?.category || 'custom')
  const [toRecipients, setToRecipients] = useState<string>('')
  const [ccRecipients, setCcRecipients] = useState<string>('')
  const [bccRecipients, setBccRecipients] = useState<string>('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [recipientSearchQuery, setRecipientSearchQuery] = useState('')
  const [showRecipientSuggestions, setShowRecipientSuggestions] = useState(false)
  
  // Get smart recipient suggestions based on category and usage history
  const smartSuggestions = getCombinedSuggestions(templateCategory, 8)
  
  // Get search results when user types
  const recipientSearchResults = recipientSearchQuery.length >= 2
    ? searchRecipients(recipientSearchQuery)
    : []
  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false)
  const [showVariationModal, setShowVariationModal] = useState<string | null>(null)
  const [allCategories, setAllCategories] = useState(() => {
    const userCategories = getUserCategories()
    // Predefined categories (Inventory, Financial, Order, Custom)
    const predefined = templateCategories.map(cat => ({
      name: cat.name,
      color: cat.color,
      icon: cat.icon,
      description: cat.description
    }))
    // User-created categories
    const custom = userCategories.map(uc => ({
      name: uc.name,
      color: uc.color,
      icon: uc.icon,
      description: `Custom category created by ${uc.createdBy}`
    }))
    return [...predefined, ...custom]
  })
  
  // Component variation mapping - smart suggestions for related types
  const COMPONENT_VARIATIONS: Record<PanelType, PanelType[]> = {
    'chart-bar': ['chart-pie', 'chart-line', 'table'],
    'chart-pie': ['chart-bar', 'chart-line', 'table'],
    'chart-line': ['chart-bar', 'chart-pie', 'table'],
    'table': ['chart-bar', 'chart-pie', 'chart-line'],
    'financial': ['metric', 'table'],
    'metric': ['financial', 'text'],
    'text': ['header', 'metric'],
    'header': ['text'],
    'image': ['button'],
    'button': ['image', 'text'],
    'divider': ['spacer'],
    'spacer': ['divider'],
  }
  const [panels, setPanels] = useState<TemplatePanel[]>(editingTemplate?.panels || [
    {
      id: 'panel-1',
      type: 'header',
      title: 'Email Header',
      content: {
        title: 'Weekly Inventory Report',
        subtitle: '{{restaurant_name}} · Generated on {{date}}'
      },
      config: {
        backgroundColor: '#991B1B',
        textColor: '#FFFFFF',
        padding: 'large',
        alignment: 'center',
        borderRadius: 'none'
      }
    }
  ])
  
  const [selectedPanel, setSelectedPanel] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const [isEditMode, setIsEditMode] = useState(false)
  const [previewPanels, setPreviewPanels] = useState<TemplatePanel[] | null>(null)
  const [previewZoom, setPreviewZoom] = useState(100)
  const [draggedPanelId, setDraggedPanelId] = useState<string | null>(null)
  const [showVariables, setShowVariables] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [activeTab, setActiveTab] = useState<'content' | 'style'>('content')
  const textInputRef = useRef<HTMLTextAreaElement>(null)

  // Panel type definitions with proper colors
  const panelTypes = [
    { type: 'header' as PanelType, icon: Mail, label: 'Header', color: 'bg-rose-100 text-rose-600' },
    { type: 'text' as PanelType, icon: Type, label: 'Text Block', color: 'bg-blue-100 text-blue-600' },
    { type: 'metric' as PanelType, icon: TrendingUp, label: 'Metric Card', color: 'bg-amber-100 text-amber-600' },
    { type: 'financial' as PanelType, icon: DollarSign, label: 'Financial', color: 'bg-emerald-100 text-emerald-600' },
    { type: 'table' as PanelType, icon: Table, label: 'Data Table', color: 'bg-indigo-100 text-indigo-600' },
    { type: 'chart-bar' as PanelType, icon: BarChart3, label: 'Bar Chart', color: 'bg-purple-100 text-purple-600' },
    { type: 'chart-pie' as PanelType, icon: PieChart, label: 'Pie Chart', color: 'bg-pink-100 text-pink-600' },
    { type: 'image' as PanelType, icon: ImageIcon, label: 'Image', color: 'bg-teal-100 text-teal-600' },
    { type: 'divider' as PanelType, icon: Layout, label: 'Divider', color: 'bg-gray-100 text-gray-600' },
    { type: 'button' as PanelType, icon: Send, label: 'Button', color: 'bg-orange-100 text-orange-600' },
  ]

  const addPanel = (type: PanelType) => {
    const newPanel: TemplatePanel = {
      id: `panel-${Date.now()}`,
      type,
      title: `New ${type} Panel`,
      content: getDefaultContent(type),
      config: {
        backgroundColor: type === 'header' ? '#991B1B' : '#FFFFFF',
        textColor: type === 'header' ? '#FFFFFF' : '#1F2937',
        fontSize: 'medium',
        padding: 'medium',
        alignment: type === 'header' || type === 'metric' ? 'center' : 'left',
        borderRadius: 'medium'
      }
    }
    setPanels([...panels, newPanel])
    setSelectedPanel(newPanel.id)
  }

  const getDefaultContent = (type: PanelType): any => {
    switch (type) {
      case 'text':
        return { text: 'Enter your content here. You can use variables like {{wine_name}} or {{date}} which will be replaced with actual values when sending.' }
      case 'image':
        return { url: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600', alt: 'Wine Image', caption: 'Image caption (optional)' }
      case 'chart-bar':
        return { 
          variant: 'wine-sales-by-type',
          title: 'Wine Sales by Type',
          data: [65, 45, 30, 25, 15], 
          labels: ['Red', 'White', 'Sparkling', 'Rosé', 'Dessert'],
          colors: ['#991B1B', '#F59E0B', '#FBBF24', '#EC4899', '#8B5CF6']
        }
      case 'chart-pie':
        return { 
          variant: 'revenue-by-provider',
          title: 'Revenue by Provider',
          data: [35, 25, 20, 12, 8], 
          labels: ['Southern Glazer\'s', 'Breakthru', 'Winebow', 'Kobrand', 'Others'],
          colors: ['#991B1B', '#DC2626', '#EF4444', '#F87171', '#FCA5A5']
        }
      case 'table':
        return { 
          title: 'Low Stock Wines',
          headers: ['Wine', 'Current Stock', 'Threshold', 'Status'],
          rows: [
            ['Château Lafite 2018', '3', '12', '🔴 Critical'],
            ['Dom Pérignon 2012', '8', '10', '🟡 Low'],
            ['Opus One 2019', '15', '12', '🟢 OK'],
          ]
        }
      case 'financial':
        return { 
          title: 'Financial Summary',
          metrics: [
            { label: 'Total Revenue', value: '${{total_value}}', trend: '+12.5%', trendUp: true },
            { label: 'Cost of Goods', value: '$8,240', trend: '+8.2%', trendUp: false },
            { label: 'Gross Profit', value: '$4,210', trend: '+18.3%', trendUp: true }
          ]
        }
      case 'metric':
        return { label: 'Total Orders This Week', value: '48', trend: '+23%', trendUp: true, icon: 'package' }
      case 'header':
        return { title: 'Email Title', subtitle: 'Subtitle or description text' }
      case 'divider':
        return { style: 'solid', color: '#E5E7EB' }
      case 'button':
        return { text: 'View Full Report', url: '#', style: 'primary' }
      default:
        return {}
    }
  }

  const updatePanelContent = (panelId: string, newContent: any) => {
    setPanels(panels.map(p => 
      p.id === panelId ? { ...p, content: { ...p.content, ...newContent } } : p
    ))
  }

  const updatePanelConfig = (panelId: string, newConfig: Partial<TemplatePanel['config']>) => {
    setPanels(panels.map(p => 
      p.id === panelId ? { ...p, config: { ...p.config, ...newConfig } } : p
    ))
  }

  const removePanel = (id: string) => {
    setPanels(panels.filter(p => p.id !== id))
    if (selectedPanel === id) setSelectedPanel(null)
  }

  const movePanel = (id: string, direction: 'up' | 'down') => {
    const index = panels.findIndex(p => p.id === id)
    if (direction === 'up' && index > 0) {
      const newPanels = [...panels]
      ;[newPanels[index - 1], newPanels[index]] = [newPanels[index], newPanels[index - 1]]
      setPanels(newPanels)
    } else if (direction === 'down' && index < panels.length - 1) {
      const newPanels = [...panels]
      ;[newPanels[index], newPanels[index + 1]] = [newPanels[index + 1], newPanels[index]]
      setPanels(newPanels)
    }
  }

  const openPanelArrange = () => {
    setPreviewPanels([...panels])
    setPreviewZoom(100)
  }

  const applyPanelArrange = () => {
    if (previewPanels) {
      setPanels(previewPanels)
    }
    setPreviewPanels(null)
  }

  const cancelPanelArrange = () => {
    setPreviewPanels(null)
    setDraggedPanelId(null)
  }

  const movePreviewPanel = (panelId: string, direction: 'up' | 'down') => {
    if (!previewPanels) return
    const index = previewPanels.findIndex(p => p.id === panelId)
    if (direction === 'up' && index > 0) {
      const next = [...previewPanels]
      ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
      setPreviewPanels(next)
    } else if (direction === 'down' && index < previewPanels.length - 1) {
      const next = [...previewPanels]
      ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
      setPreviewPanels(next)
    }
  }

  const handlePreviewDrop = (targetId: string) => {
    if (!previewPanels || !draggedPanelId || draggedPanelId === targetId) return
    const next = [...previewPanels]
    const fromIndex = next.findIndex(p => p.id === draggedPanelId)
    const toIndex = next.findIndex(p => p.id === targetId)
    if (fromIndex === -1 || toIndex === -1) return
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)
    setPreviewPanels(next)
    setDraggedPanelId(null)
  }

  const handlePanelDoubleClick = (panelId: string) => {
    const panel = panels.find(p => p.id === panelId)
    if (panel && COMPONENT_VARIATIONS[panel.type]?.length > 0) {
      setShowVariationModal(panelId)
    }
  }

  const convertPanelType = (panelId: string, newType: PanelType) => {
    const panel = panels.find(p => p.id === panelId)
    if (!panel) return

    // Smart content adaptation based on type conversion
    const adaptedContent = adaptContentForType(panel.content, panel.type, newType)

    setPanels(panels.map(p =>
      p.id === panelId
        ? { ...p, type: newType, content: adaptedContent }
        : p
    ))
  }

  const adaptContentForType = (oldContent: any, oldType: PanelType, newType: PanelType): any => {
    // Chart to Table conversion
    if ((oldType.startsWith('chart-') && newType === 'table') || (oldType === 'table' && newType.startsWith('chart-'))) {
      if (oldType === 'table') {
        // Table → Chart: Extract data from table rows
        const data = oldContent.rows?.map((row: any[]) => parseFloat(row[1]) || 0) || []
        const labels = oldContent.rows?.map((row: any[]) => row[0] || '') || []
        return {
          variant: `${newType}-default`,
          title: oldContent.title || 'Chart',
          data,
          labels,
          colors: ['#991B1B', '#DC2626', '#EF4444', '#F87171', '#FCA5A5']
        }
      } else {
        // Chart → Table: Convert chart data to table rows
        const rows = (oldContent.labels || []).map((label: string, i: number) => [
          label,
          String(oldContent.data?.[i] || 0),
          i === 0 ? '🟢' : i === 1 ? '🟡' : '🔴'
        ])
        return {
          title: oldContent.title || 'Data Table',
          headers: ['Item', 'Value', 'Status'],
          rows
        }
      }
    }

    // Chart type conversions (preserve data)
    if (oldType.startsWith('chart-') && newType.startsWith('chart-')) {
      return {
        ...oldContent,
        variant: `${newType.replace('chart-', '')}-variant`
      }
    }

    // Financial → Metric conversion
    if (oldType === 'financial' && newType === 'metric') {
      const firstMetric = oldContent.metrics?.[0]
      return {
        label: firstMetric?.label || 'Key Metric',
        value: firstMetric?.value || '$0',
        trend: firstMetric?.trend || '+0%',
        trendUp: firstMetric?.trendUp ?? true,
        icon: 'package'
      }
    }

    // Metric → Financial conversion
    if (oldType === 'metric' && newType === 'financial') {
      return {
        title: 'Financial Summary',
        metrics: [
          {
            label: oldContent.label || 'Metric',
            value: oldContent.value || '0',
            trend: oldContent.trend || '+0%',
            trendUp: oldContent.trendUp ?? true
          }
        ]
      }
    }

    // Text → Header conversion
    if (oldType === 'text' && newType === 'header') {
      const text = oldContent.text || ''
      const lines = text.split('\n')
      return {
        title: lines[0] || 'Header Title',
        subtitle: lines[1] || 'Subtitle'
      }
    }

    // Header → Text conversion
    if (oldType === 'header' && newType === 'text') {
      return {
        text: `${oldContent.title || 'Title'}\n\n${oldContent.subtitle || 'Description'}`
      }
    }

    // Default: return existing content (works for divider ↔ spacer, etc.)
    return oldContent
  }


  const applyColorPalette = (palette: typeof COLOR_PALETTES[0]) => {
    // Apply to header panels
    setPanels(panels.map(p => {
      if (p.type === 'header') {
        return { ...p, config: { ...p.config, backgroundColor: palette.primary, textColor: '#FFFFFF' } }
      }
      if (p.type === 'button') {
        return { ...p, config: { ...p.config, backgroundColor: palette.primary } }
      }
      return p
    }))
  }

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      alert('Please enter a template name')
      return
    }

    setIsSaving(true)

    // Generate thumbnail
    const thumbnailData = `data:image/svg+xml,${encodeURIComponent(`
      <svg width="300" height="200" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#f3f4f6"/>
            <stop offset="100%" style="stop-color:#e5e7eb"/>
          </linearGradient>
        </defs>
        <rect width="300" height="200" fill="url(#bg)"/>
        <rect x="20" y="20" width="260" height="40" rx="4" fill="${panels[0]?.config.backgroundColor || '#991B1B'}"/>
        <text x="150" y="45" font-family="system-ui" font-size="12" text-anchor="middle" fill="white" font-weight="bold">
          ${templateName.slice(0, 25)}
        </text>
        <rect x="20" y="70" width="260" height="20" rx="2" fill="#e5e7eb"/>
        <rect x="20" y="100" width="120" height="60" rx="4" fill="#dbeafe"/>
        <rect x="160" y="100" width="120" height="60" rx="4" fill="#dcfce7"/>
        <text x="150" y="185" font-family="system-ui" font-size="10" text-anchor="middle" fill="#6b7280">
          ${panels.length} components
        </text>
      </svg>
    `)}`

    const template: SavedTemplate = {
      id: editingTemplate?.id || `template-${Date.now()}`,
      name: templateName,
      description: templateDescription || `Template with ${panels.length} components`,
      subject: templateSubject,
      panels: panels,
      thumbnail: thumbnailData,
      category: templateCategory.toLowerCase() as 'inventory' | 'financial' | 'order' | 'custom',
      created_at: editingTemplate?.created_at || new Date(),
      last_modified: new Date(),
      used_count: editingTemplate?.used_count || 0,
    }

    setIsSaving(false)
    setSaveSuccess(true)

    if (onSave) {
      onSave(template)
    }

    setTimeout(() => {
      setSaveSuccess(false)
      onClose()
    }, 1500)
  }

  const selectedPanelData = panels.find(p => p.id === selectedPanel)
  const hasPanelOrderChanges = previewPanels
    ? previewPanels.map(panel => panel.id).join('|') !== panels.map(panel => panel.id).join('|')
    : false

  const renderPanelPreview = (panel: TemplatePanel) => {
    const baseStyle: React.CSSProperties = {
      backgroundColor: panel.config.backgroundColor,
      color: panel.config.textColor,
      padding: panel.config.padding === 'large' ? '2rem' : panel.config.padding === 'small' ? '0.75rem' : '1.25rem',
      textAlign: panel.config.alignment as any,
      borderRadius: panel.config.borderRadius === 'large' ? '1rem' : panel.config.borderRadius === 'medium' ? '0.5rem' : panel.config.borderRadius === 'small' ? '0.25rem' : '0',
    }

    switch (panel.type) {
      case 'header':
        return (
          <div style={baseStyle}>
            <h1 className="text-2xl font-bold mb-2">{panel.content.title}</h1>
            <p className="text-sm opacity-90">{panel.content.subtitle}</p>
          </div>
        )
      
      case 'text':
        return (
          <div style={baseStyle} className="prose prose-sm max-w-none">
            <p className="whitespace-pre-wrap leading-relaxed">{panel.content.text}</p>
          </div>
        )
      
      case 'metric':
        return (
          <div style={baseStyle} className="text-center">
            <p className="text-sm font-medium opacity-70 mb-2">{panel.content.label}</p>
            <p className="text-4xl font-bold mb-2">{panel.content.value}</p>
            <p className={`text-sm font-semibold ${panel.content.trendUp ? 'text-emerald-600' : 'text-rose-600'}`}>
              {panel.content.trend}
            </p>
          </div>
        )
      
      case 'financial':
        return (
          <div style={baseStyle}>
            {panel.content.title && <h3 className="text-lg font-bold mb-4">{panel.content.title}</h3>}
            <div className="grid grid-cols-3 gap-4">
              {panel.content.metrics.map((metric: any, idx: number) => (
                <div key={idx} className="text-center p-4 bg-black/5 rounded-lg">
                  <p className="text-xs font-semibold opacity-70 mb-1">{metric.label}</p>
                  <p className="text-2xl font-bold mb-1">{metric.value}</p>
                  <p className={`text-xs font-semibold ${metric.trendUp ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {metric.trend}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )
      
      case 'table':
        return (
          <div style={baseStyle}>
            {panel.content.title && <h3 className="text-lg font-bold mb-4">{panel.content.title}</h3>}
            <div className="overflow-hidden rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    {panel.content.headers.map((header: string, idx: number) => (
                      <th key={idx} className="px-4 py-3 text-left font-semibold text-gray-700">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {panel.content.rows.map((row: string[], idx: number) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      {row.map((cell: string, cellIdx: number) => (
                        <td key={cellIdx} className="px-4 py-3">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      
      case 'chart-bar':
        const maxValue = Math.max(...panel.content.data)
        return (
          <div style={baseStyle}>
            {panel.content.title && <h3 className="text-lg font-bold mb-4 text-center">{panel.content.title}</h3>}
            <div className="flex items-end justify-center gap-3 h-40">
              {panel.content.data.map((value: number, idx: number) => (
                <div key={idx} className="flex-1 max-w-16 flex flex-col items-center gap-2">
                  <span className="text-xs font-bold">{value}</span>
                  <div 
                    className="w-full rounded-t-lg transition-all"
                    style={{ 
                      height: `${(value / maxValue) * 100}%`,
                      backgroundColor: panel.content.colors?.[idx] || '#991B1B',
                      minHeight: '8px'
                    }}
                  />
                  <span className="text-xs text-center">{panel.content.labels[idx]}</span>
                </div>
              ))}
            </div>
          </div>
        )
      
      case 'chart-pie':
        const total = panel.content.data.reduce((a: number, b: number) => a + b, 0)
        return (
          <div style={baseStyle}>
            {panel.content.title && <h3 className="text-lg font-bold mb-4 text-center">{panel.content.title}</h3>}
            <div className="flex items-center justify-center gap-8">
              <div 
                className="w-32 h-32 rounded-full"
                style={{
                  background: `conic-gradient(${panel.content.data.map((value: number, idx: number) => {
                    const startPercent = panel.content.data.slice(0, idx).reduce((a: number, b: number) => a + b, 0) / total * 100
                    const endPercent = startPercent + (value / total * 100)
                    return `${panel.content.colors?.[idx] || '#991B1B'} ${startPercent}% ${endPercent}%`
                  }).join(', ')})`
                }}
              />
              <div className="space-y-2">
                {panel.content.labels.map((label: string, idx: number) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: panel.content.colors?.[idx] || '#991B1B' }}
                    />
                    <span className="text-xs">{label}: {Math.round(panel.content.data[idx] / total * 100)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      
      case 'image':
        return (
          <div style={baseStyle}>
            <img 
              src={panel.content.url} 
              alt={panel.content.alt}
              className="w-full max-h-64 object-cover rounded-lg"
            />
            {panel.content.caption && (
              <p className="text-xs text-center mt-2 opacity-70">{panel.content.caption}</p>
            )}
          </div>
        )
      
      case 'divider':
        return (
          <div style={{ padding: '1rem 0' }}>
            <hr style={{ borderColor: panel.content.color, borderStyle: panel.content.style }} />
          </div>
        )
      
      case 'button':
        return (
          <div style={{ ...baseStyle, backgroundColor: 'transparent' }} className="text-center">
            <a
              href={panel.content.url}
              className="inline-block px-8 py-3 font-semibold rounded-lg text-white transition-all hover:opacity-90"
              style={{ backgroundColor: panel.config.backgroundColor === '#FFFFFF' ? '#991B1B' : panel.config.backgroundColor }}
            >
              {panel.content.text}
            </a>
          </div>
        )
      
      default:
        return <div style={baseStyle}>Panel type: {panel.type}</div>
    }
  }

  // Render panel editor based on type
  const renderPanelEditor = () => {
    if (!selectedPanelData) return null

    const panel = selectedPanelData

    return (
      <div className="space-y-4">
        {/* Content Tab */}
        {activeTab === 'content' && (
          <>
            {panel.type === 'header' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Title</label>
                  <input
                    type="text"
                    value={panel.content.title}
                    onChange={(e) => updatePanelContent(panel.id, { title: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Subtitle</label>
                  <input
                    type="text"
                    value={panel.content.subtitle}
                    onChange={(e) => updatePanelContent(panel.id, { subtitle: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </>
            )}

            {panel.type === 'text' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-gray-600">Content</label>
                  <button
                    onClick={() => setShowVariables(!showVariables)}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                  >
                    <Sparkles className="w-3 h-3" />
                    Insert Variable
                  </button>
                </div>
                {showVariables && (
                  <div className="mb-2 p-2 bg-blue-50 rounded-lg border border-blue-100">
                    <div className="grid grid-cols-2 gap-1">
                      {TEMPLATE_VARIABLES.map((v) => (
                        <button
                          key={v.key}
                          onClick={() => {
                            updatePanelContent(panel.id, { text: panel.content.text + ' ' + v.key })
                            setShowVariables(false)
                          }}
                          className="flex items-center gap-2 px-2 py-1.5 text-xs text-left hover:bg-blue-100 rounded transition-colors"
                        >
                          <v.icon className="w-3 h-3 text-blue-600" />
                          <span>{v.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <textarea
                  ref={textInputRef}
                  value={panel.content.text}
                  onChange={(e) => updatePanelContent(panel.id, { text: e.target.value })}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                />
              </div>
            )}

            {panel.type === 'metric' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Label</label>
                  <input
                    type="text"
                    value={panel.content.label}
                    onChange={(e) => updatePanelContent(panel.id, { label: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Value</label>
                  <input
                    type="text"
                    value={panel.content.value}
                    onChange={(e) => updatePanelContent(panel.id, { value: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Trend %</label>
                    <input
                      type="text"
                      value={panel.content.trend}
                      onChange={(e) => updatePanelContent(panel.id, { trend: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1.5">Direction</label>
                    <select
                      value={panel.content.trendUp ? 'up' : 'down'}
                      onChange={(e) => updatePanelContent(panel.id, { trendUp: e.target.value === 'up' })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="up">↑ Up (Green)</option>
                      <option value="down">↓ Down (Red)</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {panel.type === 'button' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Button Text</label>
                  <input
                    type="text"
                    value={panel.content.text}
                    onChange={(e) => updatePanelContent(panel.id, { text: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Link URL</label>
                  <input
                    type="text"
                    value={panel.content.url}
                    onChange={(e) => updatePanelContent(panel.id, { url: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </>
            )}

            {panel.type === 'image' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Image URL</label>
                  <input
                    type="text"
                    value={panel.content.url}
                    onChange={(e) => updatePanelContent(panel.id, { url: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Alt Text</label>
                  <input
                    type="text"
                    value={panel.content.alt}
                    onChange={(e) => updatePanelContent(panel.id, { alt: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Caption</label>
                  <input
                    type="text"
                    value={panel.content.caption || ''}
                    onChange={(e) => updatePanelContent(panel.id, { caption: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </>
            )}

            {(panel.type === 'table' || panel.type === 'financial' || panel.type === 'chart-bar' || panel.type === 'chart-pie') && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">Section Title</label>
                <input
                  type="text"
                  value={panel.content.title || ''}
                  onChange={(e) => updatePanelContent(panel.id, { title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            )}
          </>
        )}

        {/* Style Tab */}
        {activeTab === 'style' && (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Background Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={panel.config.backgroundColor}
                  onChange={(e) => updatePanelConfig(panel.id, { backgroundColor: e.target.value })}
                  className="w-10 h-10 rounded-lg cursor-pointer border border-gray-200"
                />
                <input
                  type="text"
                  value={panel.config.backgroundColor}
                  onChange={(e) => updatePanelConfig(panel.id, { backgroundColor: e.target.value })}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Text Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={panel.config.textColor}
                  onChange={(e) => updatePanelConfig(panel.id, { textColor: e.target.value })}
                  className="w-10 h-10 rounded-lg cursor-pointer border border-gray-200"
                />
                <input
                  type="text"
                  value={panel.config.textColor}
                  onChange={(e) => updatePanelConfig(panel.id, { textColor: e.target.value })}
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Alignment</label>
              <div className="flex gap-1">
                {[
                  { value: 'left', icon: AlignLeft },
                  { value: 'center', icon: AlignCenter },
                  { value: 'right', icon: AlignRight },
                ].map(({ value, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => updatePanelConfig(panel.id, { alignment: value as any })}
                    className={`flex-1 p-2 rounded-lg border transition-colors ${
                      panel.config.alignment === value
                        ? 'bg-blue-100 border-blue-300 text-blue-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 mx-auto" />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Padding</label>
              <select
                value={panel.config.padding}
                onChange={(e) => updatePanelConfig(panel.id, { padding: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Border Radius</label>
              <select
                value={panel.config.borderRadius}
                onChange={(e) => updatePanelConfig(panel.id, { borderRadius: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="none">None</option>
                <option value="small">Small</option>
                <option value="medium">Medium</option>
                <option value="large">Large</option>
              </select>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-[95vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-700 px-6 py-4 flex items-center gap-4">
            <div className="p-2.5 bg-white/20 rounded-xl">
              <Mail className="w-6 h-6 text-white" />
            </div>
            
            <div className="flex-1 space-y-2">
              <input
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                className="w-full bg-white/10 text-white text-xl font-bold border-none outline-none focus:bg-white/20 px-3 py-1.5 rounded-lg transition-colors placeholder-white/50"
                placeholder="Template Name"
              />
              <div className="flex items-center gap-2">
                <span className="text-white/70 text-sm">Subject:</span>
                <input
                  type="text"
                  value={templateSubject}
                  onChange={(e) => setTemplateSubject(e.target.value)}
                  className="flex-1 bg-white/10 text-white/90 text-sm border-none outline-none focus:bg-white/20 px-3 py-1 rounded transition-colors placeholder-white/50"
                  placeholder="Email subject line..."
                />
              </div>
              
              {/* To Recipients (Optional) */}
              <div className="space-y-1 relative">
                <div className="flex items-center gap-2">
                  <span className="text-white/70 text-sm">To:</span>
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      value={toRecipients}
                      onChange={(e) => {
                        setToRecipients(e.target.value)
                        setRecipientSearchQuery(e.target.value.split(',').pop()?.trim() || '')
                        setShowRecipientSuggestions(true)
                      }}
                      onFocus={() => setShowRecipientSuggestions(true)}
                      onBlur={() => setTimeout(() => setShowRecipientSuggestions(false), 200)}
                      className="w-full bg-white/10 text-white/90 text-sm border-none outline-none focus:bg-white/20 px-3 py-1 rounded transition-colors placeholder-white/50"
                      placeholder="Start typing email address..."
                    />
                    
                    {/* Autocomplete dropdown */}
                    {showRecipientSuggestions && (recipientSearchResults.length > 0 || recipientSearchQuery.length < 2) && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 max-h-48 overflow-y-auto z-50">
                        {recipientSearchQuery.length >= 2 ? (
                          // Show search results
                          recipientSearchResults.map((recipient) => (
                            <button
                              key={recipient.email}
                              onClick={() => {
                                const emails = toRecipients.split(',').map(e => e.trim()).filter(Boolean)
                                emails[emails.length - 1] = recipient.email
                                setToRecipients(emails.join(', '))
                                setRecipientSearchQuery('')
                                addEmailRecipient(recipient.email, templateCategory.toLowerCase())
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                            >
                              <div className="font-medium text-gray-900 text-sm">{recipient.email}</div>
                              {recipient.name && <div className="text-xs text-gray-500">{recipient.name}</div>}
                              <div className="text-xs text-gray-400">Used {recipient.usageCount}x</div>
                            </button>
                          ))
                        ) : (
                          // Show smart suggestions
                          smartSuggestions.map((email) => (
                            <button
                              key={email}
                              onClick={() => {
                                setToRecipients(prev => prev ? `${prev}, ${email}` : email)
                                setRecipientSearchQuery('')
                                addEmailRecipient(email, templateCategory.toLowerCase())
                              }}
                              className="w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                            >
                              <div className="font-medium text-gray-900 text-sm">{email}</div>
                              <div className="text-xs text-gray-400">Suggested for {templateCategory}</div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {/* Quick add chips */}
                {!toRecipients && smartSuggestions.length > 0 && (
                  <div className="ml-9 flex flex-wrap gap-1">
                    <span className="text-xs text-white/50">Quick add:</span>
                    {smartSuggestions.slice(0, 4).map((email) => (
                      <button
                        key={email}
                        onClick={() => {
                          setToRecipients(prev => prev ? `${prev}, ${email}` : email)
                          addEmailRecipient(email, templateCategory.toLowerCase())
                        }}
                        className="px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded text-xs text-white/80 transition-colors"
                      >
                        + {email.split('@')[0]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Advanced Options Toggle */}
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="flex items-center gap-2 text-white/70 hover:text-white text-xs transition-colors"
              >
                <span>{showAdvanced ? 'Hide' : 'Show'} CC/BCC</span>
                {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
              
              {/* CC and BCC Fields */}
              {showAdvanced && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-white/70 text-sm">CC:</span>
                    <input
                      type="text"
                      value={ccRecipients}
                      onChange={(e) => setCcRecipients(e.target.value)}
                      className="flex-1 bg-white/10 text-white/90 text-sm border-none outline-none focus:bg-white/20 px-3 py-1 rounded transition-colors placeholder-white/50"
                      placeholder="Comma-separated emails (e.g., manager@example.com, owner@example.com)"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white/70 text-sm">BCC:</span>
                    <input
                      type="text"
                      value={bccRecipients}
                      onChange={(e) => setBccRecipients(e.target.value)}
                      className="flex-1 bg-white/10 text-white/90 text-sm border-none outline-none focus:bg-white/20 px-3 py-1 rounded transition-colors placeholder-white/50"
                      placeholder="Hidden recipients (e.g., accounting@example.com)"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsEditMode(prev => !prev)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isEditMode ? 'bg-white text-blue-700' : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                <Edit3 className="w-4 h-4" />
                {isEditMode ? 'Editing' : 'Edit Layout'}
              </button>
              <button
                onClick={openPanelArrange}
                disabled={!isEditMode || panels.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-white/10 text-white hover:bg-white/20 disabled:opacity-50 disabled:hover:bg-white/10"
              >
                <GripVertical className="w-4 h-4" />
                Arrange
              </button>
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  showPreview ? 'bg-white text-blue-700' : 'bg-white/20 text-white hover:bg-white/30'
                }`}
              >
                <Eye className="w-4 h-4" />
                Preview
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2 bg-white text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-50 transition-colors disabled:opacity-70"
              >
                {isSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : saveSuccess ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    Saved!
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Template
                  </>
                )}
              </button>
              <button
                onClick={onClose}
                className="p-2 text-white/80 hover:text-white hover:bg-white/20 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Template Meta */}
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">Category:</span>
              <select
                value={templateCategory}
                onChange={(e) => setTemplateCategory(e.target.value)}
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 capitalize"
                title={allCategories.find(c => c.name.toLowerCase() === templateCategory.toLowerCase())?.description}
              >
                {allCategories.map((category) => (
                  <option key={category.name} value={category.name.toLowerCase()} className="capitalize">
                    {category.name}
                  </option>
                ))}
              </select>
              {templateCategory.toLowerCase() === 'custom' && (
                <button
                  onClick={() => setShowNewCategoryModal(true)}
                  className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors"
                  title="Create New Category"
                >
                  <Plus className="w-4 h-4 text-gray-600" />
                </button>
              )}
            </div>
            <div className="flex-1">
              <input
                type="text"
                value={templateDescription}
                onChange={(e) => setTemplateDescription(e.target.value)}
                placeholder="Template description (optional)"
                className="w-full px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">Color Theme:</span>
              <div className="flex gap-1">
                {COLOR_PALETTES.map((palette) => (
                  <button
                    key={palette.name}
                    onClick={() => applyColorPalette(palette)}
                    title={palette.name}
                    className="w-6 h-6 rounded-full border-2 border-white shadow-sm hover:scale-110 transition-transform"
                    style={{ backgroundColor: palette.primary }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden flex">
            {/* Left Sidebar - Components */}
            <div className="w-56 bg-gray-50 border-r border-gray-200 p-4 overflow-y-auto">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">
                Components
              </h3>
              <div className="space-y-1.5">
                {panelTypes.map((panelType) => {
                  const Icon = panelType.icon
                  return (
                    <button
                      key={panelType.type}
                      onClick={() => addPanel(panelType.type)}
                      className="w-full p-2.5 bg-white hover:bg-gray-100 rounded-lg border border-gray-200 flex items-center gap-2.5 transition-all hover:shadow-sm hover:border-gray-300 group"
                    >
                      <div className={`p-1.5 rounded-md ${panelType.color} transition-colors`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-sm font-medium text-gray-700">{panelType.label}</span>
                      <Plus className="w-3.5 h-3.5 text-gray-400 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Main Canvas */}
            <div className="flex-1 overflow-y-auto p-6 bg-gray-100">
              <div className="max-w-2xl mx-auto">
                {/* Email Preview Container */}
                <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
                  {/* Email Header */}
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-rose-400" />
                      <div className="w-3 h-3 rounded-full bg-amber-400" />
                      <div className="w-3 h-3 rounded-full bg-emerald-400" />
                    </div>
                    <div className="flex-1 text-center">
                      <span className="text-xs font-medium text-gray-500">{templateSubject}</span>
                    </div>
                  </div>

                  {/* Email Body */}
                  {panels.length === 0 ? (
                    <div className="p-12 text-center">
                      <Layout className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                      <p className="text-gray-600 font-medium mb-2">Start building your template</p>
                      <p className="text-sm text-gray-400">Add components from the left sidebar</p>
                    </div>
                  ) : (
                    <div>
                      {panels.map((panel, index) => (
                        <motion.div
                          key={panel.id}
                          layout
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className={`relative group ${isEditMode ? 'cursor-pointer' : 'cursor-default'} ${
                            selectedPanel === panel.id && isEditMode ? 'ring-2 ring-blue-500 ring-inset' : ''
                          }`}
                          onClick={() => {
                            if (isEditMode) setSelectedPanel(panel.id)
                          }}
                          onDoubleClick={() => {
                            if (isEditMode) handlePanelDoubleClick(panel.id)
                          }}
                          title="Double-click to change component type"
                        >
                          {/* Edit Badge */}
                          {isEditMode && (
                            <div className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                              <span className="px-2 py-1 bg-blue-600 text-white text-[10px] font-semibold rounded-full">
                                Edit
                              </span>
                            </div>
                          )}

                          {/* Panel Controls */}
                          {isEditMode && (
                            <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => { e.stopPropagation(); movePanel(panel.id, 'up') }}
                                disabled={index === 0}
                                className="p-1.5 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-100 disabled:opacity-30 transition-colors"
                              >
                                <ChevronUp className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); movePanel(panel.id, 'down') }}
                                disabled={index === panels.length - 1}
                                className="p-1.5 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-100 disabled:opacity-30 transition-colors"
                              >
                                <ChevronDown className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); removePanel(panel.id) }}
                                className="p-1.5 bg-white border border-rose-300 rounded-md shadow-sm hover:bg-rose-50 transition-colors"
                              >
                                <Trash2 className="w-3 h-3 text-rose-600" />
                              </button>
                            </div>
                          )}

                          {/* Panel Content */}
                          {renderPanelPreview(panel)}
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Sidebar - Panel Editor (when not in preview mode) */}
            {!showPreview && (
              <div className="w-80 bg-white border-l border-gray-200 overflow-y-auto">
                {!isEditMode ? (
                  <div className="p-6 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                      <Edit3 className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-600 font-medium mb-2">Editing is off</p>
                    <p className="text-sm text-gray-400">Enable Edit Layout to change components.</p>
                  </div>
                ) : selectedPanelData ? (
                  <div className="p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold text-gray-900">
                        Edit {panelTypes.find(p => p.type === selectedPanelData.type)?.label}
                      </h3>
                      <button
                        onClick={() => setSelectedPanel(null)}
                        className="p-1 hover:bg-gray-100 rounded transition-colors"
                      >
                        <X className="w-4 h-4 text-gray-400" />
                      </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-4">
                      <button
                        onClick={() => setActiveTab('content')}
                        className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          activeTab === 'content' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Content
                      </button>
                      <button
                        onClick={() => setActiveTab('style')}
                        className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          activeTab === 'style' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        Style
                      </button>
                    </div>

                    {renderPanelEditor()}
                  </div>
                ) : (
                  <div className="p-6 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                      <Palette className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-600 font-medium mb-2">No component selected</p>
                    <p className="text-sm text-gray-400">Click on a component to edit its properties</p>
                  </div>
                )}
              </div>
            )}

            {/* Gmail Preview Panel */}
            <AnimatePresence>
              {showPreview && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 480, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  className="border-l border-gray-200 bg-gradient-to-b from-gray-100 to-gray-200 flex flex-col overflow-hidden"
                >
                  {/* Preview Header */}
                  <div className="p-4 bg-white border-b border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                        <Eye className="w-4 h-4 text-blue-600" />
                        Email Preview
                      </h3>
                      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                        <button
                          onClick={() => setPreviewDevice('desktop')}
                          className={`p-1.5 rounded-md transition-colors ${
                            previewDevice === 'desktop' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'
                          }`}
                          title="Desktop"
                        >
                          <Monitor className="w-4 h-4 text-gray-600" />
                        </button>
                        <button
                          onClick={() => setPreviewDevice('tablet')}
                          className={`p-1.5 rounded-md transition-colors ${
                            previewDevice === 'tablet' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'
                          }`}
                          title="Tablet"
                        >
                          <Tablet className="w-4 h-4 text-gray-600" />
                        </button>
                        <button
                          onClick={() => setPreviewDevice('mobile')}
                          className={`p-1.5 rounded-md transition-colors ${
                            previewDevice === 'mobile' ? 'bg-white shadow-sm' : 'hover:bg-gray-200'
                          }`}
                          title="Mobile"
                        >
                          <Smartphone className="w-4 h-4 text-gray-600" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500">See how your email will appear to recipients</p>
                  </div>

                  {/* Preview Content */}
                  <div className="flex-1 overflow-y-auto p-4 flex items-start justify-center">
                    {/* Gmail Desktop Mockup */}
                    {previewDevice === 'desktop' && (
                      <div className="w-full max-w-[440px] bg-white rounded-xl shadow-2xl overflow-hidden border border-gray-300">
                        {/* Gmail Header */}
                        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1">
                              <div className="w-5 h-5 bg-gradient-to-br from-blue-500 to-blue-600 rounded flex items-center justify-center">
                                <Mail className="w-3 h-3 text-white" />
                              </div>
                              <span className="text-sm font-semibold text-gray-700">Gmail</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Archive className="w-4 h-4 text-gray-400" />
                            <Trash2 className="w-4 h-4 text-gray-400" />
                            <MoreVertical className="w-4 h-4 text-gray-400" />
                          </div>
                        </div>

                        {/* Email Header */}
                        <div className="px-4 py-3 border-b border-gray-100">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                              {templateName.charAt(0).toUpperCase() || 'W'}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="font-semibold text-gray-900 text-sm">WineOps AI</span>
                                <span className="text-xs text-gray-400">{new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                              </div>
                              <p className="text-sm font-medium text-gray-900 truncate">{templateSubject || 'No subject'}</p>
                              <p className="text-xs text-gray-500">to me</p>
                            </div>
                          </div>
                          
                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-gray-100">
                            <button className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-full text-xs font-medium">
                              <Reply className="w-3 h-3" />
                              Reply
                            </button>
                            <button className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-full text-xs font-medium text-gray-700">
                              <Forward className="w-3 h-3" />
                              Forward
                            </button>
                            <div className="ml-auto flex items-center gap-1">
                              <Star className="w-4 h-4 text-gray-300 hover:text-amber-400 cursor-pointer" />
                              <Paperclip className="w-4 h-4 text-gray-300" />
                            </div>
                          </div>
                        </div>

                        {/* Email Body */}
                        <div className="max-h-[400px] overflow-y-auto">
                          {panels.length === 0 ? (
                            <div className="p-8 text-center">
                              <Mail className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                              <p className="text-gray-400 text-sm">Add components to see preview</p>
                            </div>
                          ) : (
                            <div className="email-preview">
                              {panels.map((panel) => (
                                <div key={panel.id}>
                                  {renderPanelPreview(panel)}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Tablet Mockup */}
                    {previewDevice === 'tablet' && (
                      <div className="w-[380px] bg-black rounded-[2rem] p-2 shadow-2xl">
                        <div className="bg-white rounded-[1.5rem] overflow-hidden h-[500px] flex flex-col">
                          {/* Status Bar */}
                          <div className="h-6 bg-gray-100 flex items-center justify-center">
                            <div className="w-16 h-1 bg-black rounded-full" />
                          </div>
                          
                          {/* Mail App Header */}
                          <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-3">
                            <Inbox className="w-5 h-5 text-blue-600" />
                            <span className="font-semibold text-gray-900">Mail</span>
                          </div>

                          {/* Email Preview */}
                          <div className="flex-1 overflow-y-auto">
                            <div className="p-4 border-b border-gray-100">
                              <div className="flex items-center gap-3 mb-2">
                                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-bold text-xs">
                                  W
                                </div>
                                <div className="flex-1">
                                  <p className="font-semibold text-gray-900 text-sm">WineOps AI</p>
                                  <p className="text-xs text-gray-500">{templateSubject || 'No subject'}</p>
                                </div>
                              </div>
                            </div>
                            
                            <div className="email-preview">
                              {panels.map((panel) => (
                                <div key={panel.id} style={{ transform: 'scale(0.9)', transformOrigin: 'top center' }}>
                                  {renderPanelPreview(panel)}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Mobile Mockup */}
                    {previewDevice === 'mobile' && (
                      <div className="w-[280px] bg-black rounded-[3rem] p-3 shadow-2xl">
                        <div className="bg-white rounded-[2.5rem] overflow-hidden h-[560px] flex flex-col">
                          {/* Status Bar */}
                          <div className="h-12 bg-gray-100 flex items-center justify-between px-6 pt-2">
                            <span className="text-xs font-semibold">{new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                            <div className="w-24 h-6 bg-black rounded-full" />
                            <div className="flex items-center gap-1">
                              <div className="w-4 h-2 border border-gray-400 rounded-sm">
                                <div className="w-3 h-1.5 bg-gray-400 rounded-sm" />
                              </div>
                            </div>
                          </div>

                          {/* Mail Header */}
                          <div className="px-4 py-2 border-b border-gray-200 flex items-center gap-2">
                            <ChevronDown className="w-5 h-5 text-blue-600 rotate-90" />
                            <span className="font-semibold text-gray-900 text-sm flex-1">Inbox</span>
                            <User className="w-5 h-5 text-gray-400" />
                          </div>

                          {/* Email Header */}
                          <div className="px-4 py-3 border-b border-gray-100">
                            <div className="flex items-center gap-2 mb-2">
                              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white font-bold text-xs">
                                W
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-900 text-sm">WineOps AI</p>
                                <p className="text-[10px] text-gray-500 truncate">{templateSubject || 'No subject'}</p>
                              </div>
                            </div>
                          </div>

                          {/* Email Body */}
                          <div className="flex-1 overflow-y-auto">
                            {panels.length === 0 ? (
                              <div className="p-6 text-center">
                                <Mail className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                <p className="text-gray-400 text-xs">Add components</p>
                              </div>
                            ) : (
                              <div className="email-preview" style={{ transform: 'scale(0.85)', transformOrigin: 'top center' }}>
                                {panels.map((panel) => (
                                  <div key={panel.id}>
                                    {renderPanelPreview(panel)}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Bottom Actions */}
                          <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-around">
                            <Reply className="w-5 h-5 text-blue-600" />
                            <Forward className="w-5 h-5 text-gray-400" />
                            <Archive className="w-5 h-5 text-gray-400" />
                            <Trash2 className="w-5 h-5 text-gray-400" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Preview Footer */}
                  <div className="p-3 bg-white border-t border-gray-200">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{panels.length} component{panels.length !== 1 ? 's' : ''}</span>
                      <span className="flex items-center gap-1">
                        <Check className="w-3 h-3 text-emerald-500" />
                        Live preview
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>{panels.length} component{panels.length !== 1 ? 's' : ''}</span>
              {editingTemplate && (
                <span className="text-amber-600">• Editing existing template</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const html = document.querySelector('.email-preview')?.innerHTML || ''
                  navigator.clipboard.writeText(html)
                  alert('HTML copied to clipboard!')
                }}
                className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-100 transition-colors"
              >
                <Copy className="w-4 h-4" />
                Copy HTML
              </button>
              <button
                onClick={handleSaveTemplate}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-70"
              >
                {isSaving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {isSaving ? 'Saving...' : 'Save & Close'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Arrange Components Preview */}
      <PreviewOverlay
        isActive={!!previewPanels}
        onApply={applyPanelArrange}
        onCancel={cancelPanelArrange}
        zoom={previewZoom}
        onZoomChange={setPreviewZoom}
        hasChanges={hasPanelOrderChanges}
      >
        <div className="min-h-screen bg-gray-50 p-6">
          <div className="max-w-3xl mx-auto space-y-3">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Arrange Components</h3>
                <p className="text-sm text-gray-500">Drag to reorder and preview before applying.</p>
              </div>
              <span className="text-xs text-gray-500">{previewPanels?.length || 0} components</span>
            </div>
            {previewPanels && previewPanels.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-500 bg-white rounded-xl border border-gray-200">
                No components to arrange.
              </div>
            )}
            {previewPanels?.map((panel, index) => (
              <div
                key={panel.id}
                draggable
                onDragStart={() => setDraggedPanelId(panel.id)}
                onDragEnd={() => setDraggedPanelId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handlePreviewDrop(panel.id)}
                className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm flex items-start gap-3"
              >
                <div className="flex items-center gap-2 pt-2">
                  <GripVertical className="w-4 h-4 text-gray-400" />
                  <span className="text-xs font-semibold text-gray-500 uppercase">
                    {panel.title || panel.type}
                  </span>
                </div>
                <div className="flex-1 overflow-hidden">
                  {renderPanelPreview(panel)}
                </div>
                <div className="flex flex-col gap-1 pt-1">
                  <button
                    onClick={() => movePreviewPanel(panel.id, 'up')}
                    disabled={index === 0}
                    className="p-1.5 bg-white border border-gray-200 rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-30"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => movePreviewPanel(panel.id, 'down')}
                    disabled={index === (previewPanels?.length || 0) - 1}
                    className="p-1.5 bg-white border border-gray-200 rounded-md shadow-sm hover:bg-gray-50 disabled:opacity-30"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </PreviewOverlay>

      {/* New Category Modal */}
      {showNewCategoryModal && (
        <NewCategoryModal
          onClose={() => setShowNewCategoryModal(false)}
          onSuccess={(categoryName) => {
            // Refresh categories list
            const userCategories = getUserCategories()
            const predefined = templateCategories.map(cat => ({
              name: cat.name,
              color: cat.color,
              icon: cat.icon,
              description: cat.description
            }))
            const custom = userCategories.map(uc => ({
              name: uc.name,
              color: uc.color,
              icon: uc.icon,
              description: `Custom category created by ${uc.createdBy}`
            }))
            setAllCategories([...predefined, ...custom])
            // Set the newly created category as selected (lowercase)
            setTemplateCategory(categoryName.toLowerCase())
          }}
        />
      )}

      {/* Component Variation Modal */}
      {showVariationModal && (() => {
        const panel = panels.find(p => p.id === showVariationModal)
        if (!panel) return null
        const variations = COMPONENT_VARIATIONS[panel.type] || []
        if (variations.length === 0) return null
        
        return (
          <VariationSelectorModal
            currentType={panel.type}
            variations={variations}
            onSelect={(newType) => convertPanelType(showVariationModal, newType)}
            onClose={() => setShowVariationModal(null)}
          />
        )
      })()}
    </AnimatePresence>
  )
}
