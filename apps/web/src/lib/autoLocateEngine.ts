import type { StorageLocation, WineLocationMapping } from '../hooks/useStorageLocations'
import type { InventoryItem } from '../pages/inventory/useInventoryPage'

export interface WineInput extends InventoryItem {
  salesVelocity?: number // FUTURE: wire to real sales data
}

export interface WineLocationScore {
  wineId: string
  wineName: string
  wineType: string
  locationId: string
  locationName: string
  locationColor: string
  score: number
  reasons: string[]
  quantity: number
}

export interface AutoLocateOptions {
  skipAssigned?: boolean // true = skip wines with existing mapping (default true)
}

export interface AutoLocateResult {
  assignments: WineLocationScore[]
  skipped: WineInput[] // wines that could not be matched to any location
}

function parseTempF(s: string | undefined): number | null {
  if (!s) return null
  const celsius = s.match(/(\d+(?:\.\d+)?)\s*°C/)
  if (celsius) return parseFloat(celsius[1]) * 9 / 5 + 32
  const fahrenheit = s.match(/(\d+(?:\.\d+)?)\s*°F/)
  if (fahrenheit) return parseFloat(fahrenheit[1])
  return null
}

const TEMP_RANGES: Record<string, [number, number]> = {
  red:       [60, 65],
  white:     [45, 55],
  sparkling: [45, 55],
  rose:      [50, 60],
  dessert:   [55, 60],
}

export function computeAutoLocatePlan(
  wines: WineInput[],
  locations: StorageLocation[],
  mappings: WineLocationMapping[],
  options: AutoLocateOptions = {},
): AutoLocateResult {
  const { skipAssigned = true } = options

  const assignedWineIds = new Set(mappings.map(m => m.wineId))
  const candidates = skipAssigned
    ? wines.filter(w => !assignedWineIds.has(w.id))
    : wines

  const runningCount: Record<string, number> = {}
  for (const loc of locations) {
    runningCount[loc.id] = loc.currentCount
  }

  // Build type distribution per location for wine type grouping signal
  const locationTypeMap: Record<string, Record<string, number>> = {}
  for (const mapping of mappings) {
    const wine = wines.find(w => w.id === mapping.wineId)
    if (!wine) continue
    if (!locationTypeMap[mapping.locationId]) locationTypeMap[mapping.locationId] = {}
    locationTypeMap[mapping.locationId][wine.type] =
      (locationTypeMap[mapping.locationId][wine.type] || 0) + 1
  }

  const assignments: WineLocationScore[] = []
  const skipped: WineInput[] = []

  for (const wine of candidates) {
    const wineQty = (wine.liveStock || 0) + (wine.shadowStock || 0) || 1

    let bestScore = -1
    let bestLocation: StorageLocation | null = null
    let bestReasons: string[] = []

    for (const loc of locations) {
      const available = loc.capacity - runningCount[loc.id]
      if (available <= 0) continue

      const reasons: string[] = []
      let score = 0

      // Signal 1: Temperature match (+40)
      const tempF = parseTempF(loc.temperature)
      const range = TEMP_RANGES[wine.type]
      if (tempF !== null && range && tempF >= range[0] && tempF <= range[1]) {
        score += 40
        reasons.push('Temperature match')
      }

      // Signal 2: Wine type grouping (+30 or +15)
      const typeMap = locationTypeMap[loc.id] || {}
      const totalInLoc = Object.values(typeMap).reduce((a, b) => a + b, 0)
      const sameTypeCount = typeMap[wine.type] || 0
      if (totalInLoc > 0 && sameTypeCount > totalInLoc / 2) {
        score += 30
        reasons.push('Wine type grouping')
      } else if (loc.name.toLowerCase().includes(wine.type)) {
        score += 15
        reasons.push('Location name suggests wine type')
      }

      // Signal 3: Capacity availability (+0–20 proportional)
      const capScore = Math.round((available / loc.capacity) * 20)
      score += capScore
      if (capScore >= 15) reasons.push('High capacity available')
      else if (capScore >= 8) reasons.push('Moderate capacity available')

      // Signal 4: Accessibility (+10)
      const accessKeywords = ['bar', 'floor', 'service', 'rack']
      const isAccessible = accessKeywords.some(k => loc.name.toLowerCase().includes(k))
      const isByGlass = wine.saleType === 'glass' || wine.saleType === 'both'
      if (isAccessible && isByGlass) {
        score += 10
        reasons.push('Accessible location for by-glass wine')
      }

      // FUTURE: sales velocity signal (wire to real sales data in later phase)
      // if (wine.salesVelocity && wine.salesVelocity > 20) {
      //   score += Math.min(10, wine.salesVelocity / 5)
      //   reasons.push('High sales velocity → accessible location preferred')
      // }

      if (score > bestScore) {
        bestScore = score
        bestLocation = loc
        bestReasons = reasons
      }
    }

    if (bestLocation && bestScore >= 0) {
      runningCount[bestLocation.id] += wineQty
      assignments.push({
        wineId: wine.id,
        wineName: wine.name,
        wineType: wine.type,
        locationId: bestLocation.id,
        locationName: bestLocation.name,
        locationColor: bestLocation.color,
        score: bestScore,
        reasons: bestReasons,
        quantity: wineQty,
      })
    } else {
      skipped.push(wine)
    }
  }

  assignments.sort((a, b) => b.score - a.score)

  return { assignments, skipped }
}
