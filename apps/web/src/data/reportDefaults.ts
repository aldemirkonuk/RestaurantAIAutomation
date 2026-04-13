/**
 * Report Defaults Management
 * Stores default template IDs per report type
 * Persisted to localStorage
 */

export interface ReportDefault {
  reportType: string
  templateId: string | null
  templateName?: string
}

export interface ReportTypeConfig {
  value: string
  label: string
  description: string
  icon: string
  color: string
  bgColor: string
}

export const REPORT_TYPES: ReportTypeConfig[] = [
  { 
    value: 'comprehensive', 
    label: 'Comprehensive', 
    description: 'Complete overview with all sections',
    icon: 'FileText',
    color: 'text-purple-700',
    bgColor: 'bg-purple-100'
  },
  { 
    value: 'inventory', 
    label: 'Inventory', 
    description: 'Stock levels, alerts & reorder suggestions',
    icon: 'Package',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100'
  },
  { 
    value: 'financial', 
    label: 'Financial', 
    description: 'Revenue, costs & profit margins',
    icon: 'DollarSign',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-100'
  },
  { 
    value: 'sales', 
    label: 'Sales', 
    description: 'Sales trends, velocity & top performers',
    icon: 'TrendingUp',
    color: 'text-amber-700',
    bgColor: 'bg-amber-100'
  },
  { 
    value: 'procurement', 
    label: 'Procurement', 
    description: 'Orders, providers & delivery tracking',
    icon: 'Truck',
    color: 'text-rose-700',
    bgColor: 'bg-rose-100'
  },
]

const STORAGE_KEY = 'wineops_report_defaults'

export function getReportDefaults(): Record<string, ReportDefault> {
  if (typeof window === 'undefined') return {}
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

export function setReportDefault(reportType: string, templateId: string | null, templateName?: string): void {
  if (typeof window === 'undefined') return
  
  const defaults = getReportDefaults()
  
  if (templateId === null) {
    delete defaults[reportType]
  } else {
    defaults[reportType] = {
      reportType,
      templateId,
      templateName
    }
  }
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults))
}

export function getDefaultTemplateForReport(reportType: string): ReportDefault | null {
  const defaults = getReportDefaults()
  return defaults[reportType] || null
}

export function clearAllReportDefaults(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}

// Template defaults storage (for email/SMS templates)
const TEMPLATE_DEFAULTS_KEY = 'wineops_template_defaults'

export interface TemplateDefault {
  type: 'email' | 'sms'
  templateId: string
  templateName: string
}

export function getTemplateDefaults(): Record<string, TemplateDefault> {
  if (typeof window === 'undefined') return {}
  
  try {
    const stored = localStorage.getItem(TEMPLATE_DEFAULTS_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

export function setTemplateDefault(type: 'email' | 'sms', templateId: string, templateName: string): void {
  if (typeof window === 'undefined') return
  
  const defaults = getTemplateDefaults()
  defaults[type] = { type, templateId, templateName }
  
  localStorage.setItem(TEMPLATE_DEFAULTS_KEY, JSON.stringify(defaults))
}

export function removeTemplateDefault(type: 'email' | 'sms'): void {
  if (typeof window === 'undefined') return
  
  const defaults = getTemplateDefaults()
  delete defaults[type]
  
  localStorage.setItem(TEMPLATE_DEFAULTS_KEY, JSON.stringify(defaults))
}

export function getDefaultTemplate(type: 'email' | 'sms'): TemplateDefault | null {
  const defaults = getTemplateDefaults()
  return defaults[type] || null
}

export function isDefaultTemplate(type: 'email' | 'sms', templateId: string): boolean {
  const defaultTemplate = getDefaultTemplate(type)
  return defaultTemplate?.templateId === templateId
}
