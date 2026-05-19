// Wine data store backed by the project dataset:
// `library/wineops_basic_v1.jsonl` → converted to `src/data/wineops_basic_v1.json`
//
// This keeps the UI deterministic for MVP while allowing us to show all 200 wines
// without requiring a running backend.

export type SaleType = 'bottle' | 'glass' | 'both'

export interface Wine {
  id: string
  sku?: string
  name: string
  producer: string
  vintage: number | null
  price: number
  menuPrice?: number
  menuPriceGlass?: number
  type: 'red' | 'white' | 'sparkling' | 'rose' | 'dessert'
  grape: string
  country: string
  region: string
  appellation: string
  body: string
  sweetness: string
  acidity: string
  alcohol: number
  aromas: string[]
  flavors: string[]
  liveStock: number | null
  threshold: number
  bottleSizeMl: number
  saleType?: SaleType
  pourSizeMl?: number
  glassesPerBottle?: number
  glassesPerBottleOverride?: number
  provider: {
    id?: string
    name: string
    contact: string
    phone: string
    email?: string
    address?: string
  }
  image?: string
  isActive?: boolean
}

/**
 * Calculate profit margin percentage
 * @param costPrice - What you pay the supplier
 * @param menuPrice - What customer pays
 * @returns Margin percentage (e.g., 72.5 for 72.5% margin)
 */
export function calculateMargin(costPrice: number, menuPrice: number): number {
  if (!menuPrice || menuPrice === 0) return 0
  return ((menuPrice - costPrice) / menuPrice) * 100
}

/**
 * Calculate pour cost ratio (inverse of margin)
 * @param costPrice - What you pay the supplier
 * @param menuPrice - What customer pays
 * @returns Pour cost percentage (e.g., 27.5 for 27.5% pour cost)
 */
export function calculatePourCost(costPrice: number, menuPrice: number): number {
  if (!menuPrice || menuPrice === 0) return 0
  return (costPrice / menuPrice) * 100
}

/**
 * Get default menu price based on cost (3x markup as industry standard)
 */
export function getDefaultMenuPrice(costPrice: number): number {
  return Math.round(costPrice * 3)
}

type WineType = Wine['type']

type WineOpsBasicV1Record = {
  WINE_ID: string
  name: string
  producer: string
  vintage: number | null
  price: number
  classification?: {
    primary_type?: string
    grape_variety?: string
    country?: string
    region?: string
    appellation?: string
  }
  wine_structure?: {
    body?: string
    sweetness?: string
    acidity?: string
    alcohol_pct?: number
  }
  sensory_profile?: {
    primary_aromas?: string[]
    secondary_aromas?: string[]
    flavor_profile?: string[]
  }
  live_stock?: number | null
  threshold_min?: number
  bottle_size_ml?: number
  provider_info?: {
    primary?: {
      name?: string
      contact?: string
      phone?: string
    }
  }
}

import rawWineData from './wineops_basic_v1.json'
import { providers, getRecommendedProviders } from './providerData'

function coerceWineType(type: string | undefined): WineType {
  const t = (type || '').toLowerCase().trim()
  if (t === 'red') return 'red'
  if (t === 'white') return 'white'
  if (t === 'sparkling') return 'sparkling'
  if (t === 'rose' || t === 'rosé') return 'rose'
  if (t === 'dessert') return 'dessert'
  // default to red if unknown (should be rare)
  return 'red'
}

function toWine(record: WineOpsBasicV1Record, index: number): Wine {
  const classification = record.classification || {}
  const structure = record.wine_structure || {}
  const sensory = record.sensory_profile || {}
  const providerInfo = record.provider_info?.primary || {}
  
  // Determine wine type first
  const wineType = coerceWineType(classification.primary_type)
  
  // Get recommended providers based on wine type, or use a provider from our synthetic list
  const { primary, alternatives } = getRecommendedProviders(wineType)
  const availableProviders = primary ? [primary, ...alternatives].filter(Boolean) : providers
  
  // If provider info exists in record, use it; otherwise assign from verified US distributors
  // Use index to cycle through providers for variety
  let assignedProvider: { name: string; contact: string; phone: string; email?: string; address?: string }
  
  if (providerInfo.name) {
    assignedProvider = {
      name: providerInfo.name,
      contact: providerInfo.contact || 'Contact Provider',
      phone: providerInfo.phone || 'N/A',
      email: 'N/A',
      address: 'N/A',
    }
  } else {
    const provider = availableProviders.length > 0 
      ? availableProviders[index % availableProviders.length]
      : providers[index % providers.length]
    
    assignedProvider = {
      name: provider.name,
      contact: provider.knownPersonnel.length > 0 && provider.knownPersonnel[0] !== 'N/A' 
        ? provider.knownPersonnel[0] 
        : 'Sales Department',
      phone: provider.phone,
      email: provider.email,
      address: provider.physicalAddress,
    }
  }

  const aromas = [
    ...(sensory.primary_aromas || []),
    ...(sensory.secondary_aromas || []),
  ].filter(Boolean)

  const flavors = (sensory.flavor_profile || []).filter(Boolean)

  return {
    id: record.WINE_ID,
    name: record.name || 'Unknown Wine',
    producer: record.producer || 'Unknown Producer',
    vintage: record.vintage ?? null,
    price: Number.isFinite(record.price) ? record.price : 0,
    type: wineType,
    grape: classification.grape_variety || 'Unknown',
    country: classification.country || 'Unknown',
    region: classification.region || 'Unknown',
    appellation: classification.appellation || 'Unknown',
    body: structure.body || 'medium',
    sweetness: structure.sweetness || 'dry',
    acidity: structure.acidity || 'medium',
    alcohol: typeof structure.alcohol_pct === 'number' ? structure.alcohol_pct : 0,
    aromas: aromas.slice(0, 12),
    flavors: flavors.slice(0, 12),
    liveStock: record.live_stock ?? null,
    threshold: typeof record.threshold_min === 'number' ? record.threshold_min : 6,
    bottleSizeMl: typeof record.bottle_size_ml === 'number' ? record.bottle_size_ml : 750,
    provider: assignedProvider,
    isActive: true,
  }
}

// All 200 wines are included here, with synthetic providers assigned
export const wineLibrary: Wine[] = (rawWineData as WineOpsBasicV1Record[]).map((record, index) => toWine(record, index))

// Helper functions
export const getLowStockWines = (wines: Wine[]) => 
  wines.filter(w => w.liveStock !== null && w.liveStock <= w.threshold)

export const getWinesByType = (wines: Wine[], type: Wine['type']) =>
  wines.filter(w => w.type === type)

export const getWineTypeColor = (type: Wine['type']) => {
  switch (type) {
    case 'red': return { bg: 'bg-rose-100', text: 'text-rose-700', accent: '#be123c' }
    case 'white': return { bg: 'bg-amber-100', text: 'text-amber-700', accent: '#d97706' }
    case 'sparkling': return { bg: 'bg-yellow-100', text: 'text-yellow-700', accent: '#ca8a04' }
    case 'rose': return { bg: 'bg-pink-100', text: 'text-pink-700', accent: '#db2777' }
    case 'dessert': return { bg: 'bg-orange-100', text: 'text-orange-700', accent: '#ea580c' }
    default: return { bg: 'bg-gray-100', text: 'text-gray-700', accent: '#6b7280' }
  }
}

// Sales data for charts
export const salesByWineType = [
  { type: 'Red', sales: 8540, bottles: 156, color: '#be123c' },
  { type: 'White', sales: 4230, bottles: 98, color: '#d97706' },
  { type: 'Sparkling', sales: 6120, bottles: 72, color: '#ca8a04' },
  { type: 'Rosé', sales: 2890, bottles: 64, color: '#db2777' },
  { type: 'Dessert', sales: 1240, bottles: 18, color: '#ea580c' },
]

// Net sales by menu item (like in the image)
export const netSalesByItem = [
  { item: 'Menu 95', netSales: 5035.00 },
  { item: 'Menu 75', netSales: 1950.00 },
  { item: 'BTL PRODOM', netSales: 336.00 },
  { item: 'PRIX FIXE MENU', netSales: 319.60 },
  { item: 'BTG Premium', netSales: 287.50 },
  { item: 'BTG House', netSales: 245.00 },
]

// Time breakdown (like in the image)
export const timeBreakdown = [
  { time: '12 PM', netSales: 756, laborCost: 0, laborPercent: 0 },
  { time: '1 PM', netSales: 323, laborCost: 0, laborPercent: 0 },
  { time: '2 PM', netSales: 0, laborCost: 0, laborPercent: null },
  { time: '3 PM', netSales: 0, laborCost: 0, laborPercent: null },
  { time: '4 PM', netSales: 125, laborCost: 45, laborPercent: 36 },
  { time: '5 PM', netSales: 890, laborCost: 120, laborPercent: 13 },
  { time: '6 PM', netSales: 1456, laborCost: 180, laborPercent: 12 },
  { time: '7 PM', netSales: 2340, laborCost: 240, laborPercent: 10 },
  { time: '8 PM', netSales: 1890, laborCost: 210, laborPercent: 11 },
  { time: '9 PM', netSales: 1120, laborCost: 150, laborPercent: 13 },
]

export const topPerformingWines = [
  { wine: wineLibrary.find(w => w.id === 'WINE_011'), sales: 156, revenue: 27300, trend: 15 },
  { wine: wineLibrary.find(w => w.id === 'WINE_007'), sales: 134, revenue: 56950, trend: 8 },
  { wine: wineLibrary.find(w => w.id === 'WINE_006'), sales: 98, revenue: 2744, trend: 22 },
  { wine: wineLibrary.find(w => w.id === 'WINE_012'), sales: 87, revenue: 2088, trend: -3 },
  { wine: wineLibrary.find(w => w.id === 'WINE_013'), sales: 82, revenue: 3690, trend: 12 },
]

