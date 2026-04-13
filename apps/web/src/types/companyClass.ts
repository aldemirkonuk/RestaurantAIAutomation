/**
 * Company Class System
 * 
 * A modular ID system for assigning semantic classes to entities across the platform.
 * This architecture enables AI contextual awareness and facilitates synchronized,
 * profile-specific reporting.
 * 
 * @version 1.0.0
 * @description Core classification system for WineOps AI platform entities
 */

// ==================== Company Class Definitions ====================

/**
 * Primary entity categories in the WineOps ecosystem
 */
export type CompanyClassCategory = 
  | 'provider'      // Wine suppliers, distributors, importers
  | 'inventory'     // Wine stock and storage
  | 'order'         // Purchase orders and transactions
  | 'calendar'      // Events, deliveries, meetings
  | 'communication' // Emails, SMS, calls
  | 'report'        // Generated reports and analytics
  | 'wine'          // Wine catalog and library

/**
 * Provider subtypes for granular classification
 */
export type ProviderClass = 
  | 'PRV-DIST'     // Distributor
  | 'PRV-IMP'      // Importer
  | 'PRV-WHSL'     // Wholesaler
  | 'PRV-PROD'     // Producer/Winery
  | 'PRV-AGEN'     // Agent/Broker
  | 'PRV-COOP'     // Cooperative

/**
 * Wine type classifications
 */
export type WineTypeClass = 
  | 'WINE-RED'     // Red wines
  | 'WINE-WHT'     // White wines
  | 'WINE-SPK'     // Sparkling wines
  | 'WINE-RSE'     // Rosé wines
  | 'WINE-DES'     // Dessert wines
  | 'WINE-FRT'     // Fortified wines
  | 'WINE-NAT'     // Natural wines
  | 'WINE-ORG'     // Organic wines

/**
 * Event/Calendar classifications
 */
export type EventClass = 
  | 'EVT-DLV'      // Delivery
  | 'EVT-ORD'      // Order placement
  | 'EVT-MTG'      // Meeting
  | 'EVT-TST'      // Tasting
  | 'EVT-INV'      // Inventory check
  | 'EVT-RMD'      // Reminder
  | 'EVT-REC'      // Recurring event

/**
 * Label/Tag classifications for flexible categorization
 */
export type LabelClass = 
  | 'LBL-VIP'      // VIP client/priority
  | 'LBL-WHSL'     // Wholesale account
  | 'LBL-EVNT'     // Special event
  | 'LBL-TST'      // Wine tasting related
  | 'LBL-URG'      // Urgent/Time-sensitive
  | 'LBL-PREM'     // Premium/High-value
  | 'LBL-NEW'      // New relationship
  | 'LBL-ARCH'     // Archived/Inactive

/**
 * Order status classifications
 */
export type OrderClass = 
  | 'ORD-PEND'     // Pending approval
  | 'ORD-APPR'     // Approved
  | 'ORD-PLCD'     // Placed with provider
  | 'ORD-SHIP'     // In transit
  | 'ORD-DLVR'     // Delivered
  | 'ORD-CANC'     // Cancelled

/**
 * Union type for all company classes
 */
export type CompanyClass = 
  | ProviderClass 
  | WineTypeClass 
  | EventClass 
  | LabelClass 
  | OrderClass

// ==================== Company Class Entity ====================

/**
 * Represents a tagged entity with company class metadata
 */
export interface ClassifiedEntity {
  /** Unique identifier for the entity */
  id: string
  
  /** Human-readable name */
  name: string
  
  /** Primary company class */
  primaryClass: CompanyClass
  
  /** Category for grouping */
  category: CompanyClassCategory
  
  /** Additional class tags for multi-classification */
  secondaryClasses?: CompanyClass[]
  
  /** Custom labels applied by users */
  customLabels?: string[]
  
  /** Reference to parent entity if hierarchical */
  parentEntityId?: string
  
  /** Metadata for AI context */
  metadata?: {
    /** Last interaction timestamp */
    lastInteraction?: string
    /** Interaction frequency score (0-100) */
    frequencyScore?: number
    /** AI-generated relevance score */
    relevanceScore?: number
    /** Custom properties */
    [key: string]: any
  }
  
  /** Restaurant scope */
  restaurantId: string
  
  /** Timestamps */
  createdAt: string
  updatedAt: string
}

// ==================== Company Class Config ====================

/**
 * Configuration for each company class including display properties
 */
export interface CompanyClassConfig {
  id: CompanyClass
  label: string
  shortLabel: string
  description: string
  category: CompanyClassCategory
  color: string
  bgColor: string
  textColor: string
  icon: string
  sortOrder: number
}

/**
 * Complete configuration map for all company classes
 */
export const COMPANY_CLASS_CONFIG: Record<CompanyClass, CompanyClassConfig> = {
  // Provider Classes
  'PRV-DIST': {
    id: 'PRV-DIST',
    label: 'Distributor',
    shortLabel: 'Dist',
    description: 'Wine distribution company',
    category: 'provider',
    color: '#10B981',
    bgColor: 'bg-emerald-100',
    textColor: 'text-emerald-700',
    icon: 'Truck',
    sortOrder: 1,
  },
  'PRV-IMP': {
    id: 'PRV-IMP',
    label: 'Importer',
    shortLabel: 'Imp',
    description: 'Wine importing company',
    category: 'provider',
    color: '#6366F1',
    bgColor: 'bg-indigo-100',
    textColor: 'text-indigo-700',
    icon: 'Globe',
    sortOrder: 2,
  },
  'PRV-WHSL': {
    id: 'PRV-WHSL',
    label: 'Wholesaler',
    shortLabel: 'Whsl',
    description: 'Wholesale wine supplier',
    category: 'provider',
    color: '#F59E0B',
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-700',
    icon: 'Package',
    sortOrder: 3,
  },
  'PRV-PROD': {
    id: 'PRV-PROD',
    label: 'Producer',
    shortLabel: 'Prod',
    description: 'Winery or wine producer',
    category: 'provider',
    color: '#8B5CF6',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-700',
    icon: 'Wine',
    sortOrder: 4,
  },
  'PRV-AGEN': {
    id: 'PRV-AGEN',
    label: 'Agent',
    shortLabel: 'Agnt',
    description: 'Wine broker or agent',
    category: 'provider',
    color: '#EC4899',
    bgColor: 'bg-pink-100',
    textColor: 'text-pink-700',
    icon: 'UserCheck',
    sortOrder: 5,
  },
  'PRV-COOP': {
    id: 'PRV-COOP',
    label: 'Cooperative',
    shortLabel: 'Coop',
    description: 'Wine cooperative',
    category: 'provider',
    color: '#14B8A6',
    bgColor: 'bg-teal-100',
    textColor: 'text-teal-700',
    icon: 'Users',
    sortOrder: 6,
  },

  // Wine Type Classes
  'WINE-RED': {
    id: 'WINE-RED',
    label: 'Red Wine',
    shortLabel: 'Red',
    description: 'Red wine variety',
    category: 'wine',
    color: '#DC2626',
    bgColor: 'bg-red-100',
    textColor: 'text-red-700',
    icon: 'Wine',
    sortOrder: 10,
  },
  'WINE-WHT': {
    id: 'WINE-WHT',
    label: 'White Wine',
    shortLabel: 'Wht',
    description: 'White wine variety',
    category: 'wine',
    color: '#FCD34D',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-700',
    icon: 'Wine',
    sortOrder: 11,
  },
  'WINE-SPK': {
    id: 'WINE-SPK',
    label: 'Sparkling',
    shortLabel: 'Spk',
    description: 'Sparkling wine or Champagne',
    category: 'wine',
    color: '#FFD700',
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-600',
    icon: 'Sparkles',
    sortOrder: 12,
  },
  'WINE-RSE': {
    id: 'WINE-RSE',
    label: 'Rosé',
    shortLabel: 'Rsé',
    description: 'Rosé wine variety',
    category: 'wine',
    color: '#FB7185',
    bgColor: 'bg-rose-100',
    textColor: 'text-rose-600',
    icon: 'Wine',
    sortOrder: 13,
  },
  'WINE-DES': {
    id: 'WINE-DES',
    label: 'Dessert Wine',
    shortLabel: 'Des',
    description: 'Sweet or dessert wine',
    category: 'wine',
    color: '#D97706',
    bgColor: 'bg-orange-100',
    textColor: 'text-orange-700',
    icon: 'Cake',
    sortOrder: 14,
  },
  'WINE-FRT': {
    id: 'WINE-FRT',
    label: 'Fortified',
    shortLabel: 'Frt',
    description: 'Fortified wine (Port, Sherry)',
    category: 'wine',
    color: '#78350F',
    bgColor: 'bg-amber-200',
    textColor: 'text-amber-900',
    icon: 'Shield',
    sortOrder: 15,
  },
  'WINE-NAT': {
    id: 'WINE-NAT',
    label: 'Natural',
    shortLabel: 'Nat',
    description: 'Natural or minimal intervention wine',
    category: 'wine',
    color: '#65A30D',
    bgColor: 'bg-lime-100',
    textColor: 'text-lime-700',
    icon: 'Leaf',
    sortOrder: 16,
  },
  'WINE-ORG': {
    id: 'WINE-ORG',
    label: 'Organic',
    shortLabel: 'Org',
    description: 'Certified organic wine',
    category: 'wine',
    color: '#22C55E',
    bgColor: 'bg-green-100',
    textColor: 'text-green-700',
    icon: 'Leaf',
    sortOrder: 17,
  },

  // Event Classes
  'EVT-DLV': {
    id: 'EVT-DLV',
    label: 'Delivery',
    shortLabel: 'Dlv',
    description: 'Wine delivery event',
    category: 'calendar',
    color: '#10B981',
    bgColor: 'bg-emerald-100',
    textColor: 'text-emerald-700',
    icon: 'Truck',
    sortOrder: 20,
  },
  'EVT-ORD': {
    id: 'EVT-ORD',
    label: 'Order',
    shortLabel: 'Ord',
    description: 'Order placement event',
    category: 'calendar',
    color: '#F59E0B',
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-700',
    icon: 'Package',
    sortOrder: 21,
  },
  'EVT-MTG': {
    id: 'EVT-MTG',
    label: 'Meeting',
    shortLabel: 'Mtg',
    description: 'Business meeting',
    category: 'calendar',
    color: '#3B82F6',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
    icon: 'Users',
    sortOrder: 22,
  },
  'EVT-TST': {
    id: 'EVT-TST',
    label: 'Tasting',
    shortLabel: 'Tst',
    description: 'Wine tasting event',
    category: 'calendar',
    color: '#EC4899',
    bgColor: 'bg-pink-100',
    textColor: 'text-pink-700',
    icon: 'Wine',
    sortOrder: 23,
  },
  'EVT-INV': {
    id: 'EVT-INV',
    label: 'Inventory',
    shortLabel: 'Inv',
    description: 'Inventory check event',
    category: 'calendar',
    color: '#8B5CF6',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-700',
    icon: 'ClipboardList',
    sortOrder: 24,
  },
  'EVT-RMD': {
    id: 'EVT-RMD',
    label: 'Reminder',
    shortLabel: 'Rmd',
    description: 'General reminder',
    category: 'calendar',
    color: '#EF4444',
    bgColor: 'bg-red-100',
    textColor: 'text-red-700',
    icon: 'Bell',
    sortOrder: 25,
  },
  'EVT-REC': {
    id: 'EVT-REC',
    label: 'Recurring',
    shortLabel: 'Rec',
    description: 'Recurring event',
    category: 'calendar',
    color: '#6366F1',
    bgColor: 'bg-indigo-100',
    textColor: 'text-indigo-700',
    icon: 'Repeat',
    sortOrder: 26,
  },

  // Label Classes
  'LBL-VIP': {
    id: 'LBL-VIP',
    label: 'VIP',
    shortLabel: 'VIP',
    description: 'VIP client or priority contact',
    category: 'communication',
    color: '#FFD700',
    bgColor: 'bg-yellow-100',
    textColor: 'text-yellow-700',
    icon: 'Star',
    sortOrder: 30,
  },
  'LBL-WHSL': {
    id: 'LBL-WHSL',
    label: 'Wholesale',
    shortLabel: 'Whsl',
    description: 'Wholesale account',
    category: 'communication',
    color: '#3B82F6',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
    icon: 'Building',
    sortOrder: 31,
  },
  'LBL-EVNT': {
    id: 'LBL-EVNT',
    label: 'Event',
    shortLabel: 'Evt',
    description: 'Special event related',
    category: 'communication',
    color: '#EC4899',
    bgColor: 'bg-pink-100',
    textColor: 'text-pink-700',
    icon: 'Calendar',
    sortOrder: 32,
  },
  'LBL-TST': {
    id: 'LBL-TST',
    label: 'Tasting',
    shortLabel: 'Tst',
    description: 'Wine tasting related',
    category: 'communication',
    color: '#8B5CF6',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-700',
    icon: 'Wine',
    sortOrder: 33,
  },
  'LBL-URG': {
    id: 'LBL-URG',
    label: 'Urgent',
    shortLabel: 'Urg',
    description: 'Urgent or time-sensitive',
    category: 'communication',
    color: '#EF4444',
    bgColor: 'bg-red-100',
    textColor: 'text-red-700',
    icon: 'AlertTriangle',
    sortOrder: 34,
  },
  'LBL-PREM': {
    id: 'LBL-PREM',
    label: 'Premium',
    shortLabel: 'Prm',
    description: 'Premium or high-value',
    category: 'communication',
    color: '#9333EA',
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-700',
    icon: 'Crown',
    sortOrder: 35,
  },
  'LBL-NEW': {
    id: 'LBL-NEW',
    label: 'New',
    shortLabel: 'New',
    description: 'New relationship',
    category: 'communication',
    color: '#22C55E',
    bgColor: 'bg-green-100',
    textColor: 'text-green-700',
    icon: 'Sparkles',
    sortOrder: 36,
  },
  'LBL-ARCH': {
    id: 'LBL-ARCH',
    label: 'Archived',
    shortLabel: 'Arc',
    description: 'Archived or inactive',
    category: 'communication',
    color: '#6B7280',
    bgColor: 'bg-gray-100',
    textColor: 'text-gray-700',
    icon: 'Archive',
    sortOrder: 37,
  },

  // Order Classes
  'ORD-PEND': {
    id: 'ORD-PEND',
    label: 'Pending',
    shortLabel: 'Pnd',
    description: 'Order pending approval',
    category: 'order',
    color: '#F59E0B',
    bgColor: 'bg-amber-100',
    textColor: 'text-amber-700',
    icon: 'Clock',
    sortOrder: 40,
  },
  'ORD-APPR': {
    id: 'ORD-APPR',
    label: 'Approved',
    shortLabel: 'Apr',
    description: 'Order approved',
    category: 'order',
    color: '#10B981',
    bgColor: 'bg-emerald-100',
    textColor: 'text-emerald-700',
    icon: 'CheckCircle',
    sortOrder: 41,
  },
  'ORD-PLCD': {
    id: 'ORD-PLCD',
    label: 'Placed',
    shortLabel: 'Plc',
    description: 'Order placed with provider',
    category: 'order',
    color: '#3B82F6',
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-700',
    icon: 'Send',
    sortOrder: 42,
  },
  'ORD-SHIP': {
    id: 'ORD-SHIP',
    label: 'Shipping',
    shortLabel: 'Shp',
    description: 'Order in transit',
    category: 'order',
    color: '#6366F1',
    bgColor: 'bg-indigo-100',
    textColor: 'text-indigo-700',
    icon: 'Truck',
    sortOrder: 43,
  },
  'ORD-DLVR': {
    id: 'ORD-DLVR',
    label: 'Delivered',
    shortLabel: 'Dlv',
    description: 'Order delivered',
    category: 'order',
    color: '#22C55E',
    bgColor: 'bg-green-100',
    textColor: 'text-green-700',
    icon: 'PackageCheck',
    sortOrder: 44,
  },
  'ORD-CANC': {
    id: 'ORD-CANC',
    label: 'Cancelled',
    shortLabel: 'Cnc',
    description: 'Order cancelled',
    category: 'order',
    color: '#EF4444',
    bgColor: 'bg-red-100',
    textColor: 'text-red-700',
    icon: 'XCircle',
    sortOrder: 45,
  },
}

// ==================== Utility Functions ====================

/**
 * Get all classes for a specific category
 */
export function getClassesByCategory(category: CompanyClassCategory): CompanyClassConfig[] {
  return Object.values(COMPANY_CLASS_CONFIG)
    .filter(config => config.category === category)
    .sort((a, b) => a.sortOrder - b.sortOrder)
}

/**
 * Get class config by ID
 */
export function getClassConfig(classId: CompanyClass): CompanyClassConfig {
  return COMPANY_CLASS_CONFIG[classId]
}

/**
 * Check if a class ID is valid
 */
export function isValidClass(classId: string): classId is CompanyClass {
  return classId in COMPANY_CLASS_CONFIG
}

/**
 * Generate a unique entity ID with class prefix
 * Format: {CLASS}-{TIMESTAMP}-{RANDOM}
 */
export function generateClassifiedId(classId: CompanyClass): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${classId}-${timestamp}-${random}`
}

/**
 * Parse a classified ID to extract the class
 */
export function parseClassFromId(id: string): CompanyClass | null {
  const classPrefix = Object.keys(COMPANY_CLASS_CONFIG).find(cls => 
    id.startsWith(`${cls}-`)
  )
  return classPrefix as CompanyClass | null
}

/**
 * Get display badge for a company class
 */
export function getClassBadge(classId: CompanyClass): { label: string; bgColor: string; textColor: string } {
  const config = COMPANY_CLASS_CONFIG[classId]
  return {
    label: config.shortLabel,
    bgColor: config.bgColor,
    textColor: config.textColor,
  }
}

/**
 * Convert provider business type to company class
 */
export function providerTypeToClass(businessType: string): ProviderClass {
  const mapping: Record<string, ProviderClass> = {
    'Distributor': 'PRV-DIST',
    'Importer': 'PRV-IMP',
    'Wholesaler': 'PRV-WHSL',
    'Producer': 'PRV-PROD',
    'Winery': 'PRV-PROD',
    'Agent': 'PRV-AGEN',
    'Broker': 'PRV-AGEN',
    'Cooperative': 'PRV-COOP',
  }
  return mapping[businessType] || 'PRV-DIST'
}

/**
 * Convert wine type to company class
 */
export function wineTypeToClass(wineType: string): WineTypeClass {
  const normalizedType = wineType.toLowerCase()
  
  if (normalizedType.includes('red')) return 'WINE-RED'
  if (normalizedType.includes('white')) return 'WINE-WHT'
  if (normalizedType.includes('sparkling') || normalizedType.includes('champagne')) return 'WINE-SPK'
  if (normalizedType.includes('rosé') || normalizedType.includes('rose')) return 'WINE-RSE'
  if (normalizedType.includes('dessert') || normalizedType.includes('sweet')) return 'WINE-DES'
  if (normalizedType.includes('fortified') || normalizedType.includes('port') || normalizedType.includes('sherry')) return 'WINE-FRT'
  if (normalizedType.includes('natural')) return 'WINE-NAT'
  if (normalizedType.includes('organic')) return 'WINE-ORG'
  
  return 'WINE-RED' // Default
}

/**
 * Filter entities by class
 */
export function filterEntitiesByClass<T extends { primaryClass: CompanyClass }>(
  entities: T[],
  classes: CompanyClass[]
): T[] {
  if (classes.length === 0) return entities
  return entities.filter(entity => classes.includes(entity.primaryClass))
}

/**
 * Group entities by category
 */
export function groupEntitiesByCategory<T extends { primaryClass: CompanyClass }>(
  entities: T[]
): Record<CompanyClassCategory, T[]> {
  const grouped: Record<CompanyClassCategory, T[]> = {
    provider: [],
    inventory: [],
    order: [],
    calendar: [],
    communication: [],
    report: [],
    wine: [],
  }
  
  entities.forEach(entity => {
    const config = COMPANY_CLASS_CONFIG[entity.primaryClass]
    grouped[config.category].push(entity)
  })
  
  return grouped
}

// ==================== Type Guards ====================

export function isProviderClass(classId: CompanyClass): classId is ProviderClass {
  return classId.startsWith('PRV-')
}

export function isWineTypeClass(classId: CompanyClass): classId is WineTypeClass {
  return classId.startsWith('WINE-')
}

export function isEventClass(classId: CompanyClass): classId is EventClass {
  return classId.startsWith('EVT-')
}

export function isLabelClass(classId: CompanyClass): classId is LabelClass {
  return classId.startsWith('LBL-')
}

export function isOrderClass(classId: CompanyClass): classId is OrderClass {
  return classId.startsWith('ORD-')
}
