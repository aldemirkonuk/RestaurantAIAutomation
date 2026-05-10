import type { Wine as ApiWine } from '../services/api/types'
import type { Wine as UiWine } from '../data/wineData'

type WineType = UiWine['type']

function coerceWineType(type: string | undefined): WineType {
  const t = (type || '').toLowerCase().trim()
  if (t === 'red') return 'red'
  if (t === 'white') return 'white'
  if (t === 'sparkling') return 'sparkling'
  if (t === 'rose' || t === 'rosé') return 'rose'
  if (t === 'dessert') return 'dessert'
  return 'red'
}

export function mapApiWineToUiWine(wine: ApiWine): UiWine {
  return {
    id: wine.id,
    name: wine.name || 'Unknown Wine',
    producer: wine.producer || 'Unknown Producer',
    vintage: wine.vintage ?? null,
    price: Number.isFinite(wine.price) ? wine.price : 0,
    type: coerceWineType(wine.category),
    grape: wine.grapeVariety || 'Unknown',
    country: wine.country || 'Unknown',
    region: wine.region || 'Unknown',
    appellation: wine.appellation || 'Unknown',
    body: 'medium',
    sweetness: 'dry',
    acidity: 'medium',
    alcohol: 0,
    aromas: [],
    flavors: [],
    liveStock: null,
    threshold: 6,
    bottleSizeMl: wine.bottleSizeMl ?? 750,
    saleType: (wine as unknown as Record<string, unknown>).saleType as UiWine['saleType'] | undefined,
    pourSizeMl: (wine as unknown as Record<string, unknown>).pourSizeMl as number | undefined,
    menuPriceGlass: (wine as unknown as Record<string, unknown>).menuPriceGlass as number | undefined,
    menuPrice: (wine as unknown as Record<string, unknown>).menuPrice as number | undefined,
    provider: {
      name: 'Unknown Provider',
      contact: 'Contact Provider',
      phone: 'N/A',
      email: 'N/A',
      address: 'N/A',
    },
    isActive: true,
  }
}

export function mapApiWinesToUiWines(wines: ApiWine[]): UiWine[] {
  return wines.map(mapApiWineToUiWine)
}
