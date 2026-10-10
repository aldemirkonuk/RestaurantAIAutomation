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

// Wine colours only. A beer or a gin has no entry, so it earns no
// temperature points rather than being filed at a red-wine zone (F-741).
const TEMP_RANGES: Record<string, [number, number]> = {
  red:       [60, 65],
  white:     [45, 55],
  sparkling: [45, 55],
  rose:      [50, 60],
  dessert:   [55, 60],
}

/**
 * The group a row is placed with: its kind for anything that is not a wine
 * (beer with beer), its colour for a wine. A wine of unknown colour has no
 * group, so it is neither grouped nor matched by name.
 */
function groupOf(wine: WineInput): string | null {
  if (wine.kind && wine.kind !== 'wine' && wine.kind !== 'unknown') return wine.kind
  return wine.type && wine.type !== 'unknown' ? wine.type : null
}

/** The words a zone name may use for a group, matched as whole words. */
const GROUP_WORDS: Record<string, string[]> = {
  rose: ['rose', 'rosé'],
  non_alcoholic: ['alcohol-free', 'non-alcoholic'],
}

function nameSuggestsGroup(locationName: string, group: string): boolean {
  const words = locationName.toLowerCase().split(/[^\p{L}\p{N}-]+/u)
  return (GROUP_WORDS[group] ?? [group]).some(
    (w) => words.includes(w) || words.includes(`${w}s`),
  )
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
    const group = groupOf(wine)
    if (!group) continue
    if (!locationTypeMap[mapping.locationId]) locationTypeMap[mapping.locationId] = {}
    locationTypeMap[mapping.locationId][group] =
      (locationTypeMap[mapping.locationId][group] || 0) + 1
  }

  const assignments: WineLocationScore[] = []
  const skipped: WineInput[] = []

  for (const wine of candidates) {
    const wineQty = (wine.liveStock || 0) + (wine.shadowStock || 0) || 1
    const group = groupOf(wine)
    const isWine = !wine.kind || wine.kind === 'wine' || wine.kind === 'unknown'

    let bestScore = -1
    let bestLocation: StorageLocation | null = null
    let bestReasons: string[] = []

    for (const loc of locations) {
      // A zone whose capacity nobody recorded is not full and not empty — it is
      // unknown. Skipping it would silently drop a real zone from the plan;
      // treating the unknown as a number would score it against a fiction. So
      // it stays a candidate and simply earns no capacity points (Signal 3).
      const available = loc.capacity == null ? null : loc.capacity - runningCount[loc.id]
      if (available !== null && available <= 0) continue

      const reasons: string[] = []
      let score = 0

      // Signal 1: Temperature match (+40)
      const tempF = parseTempF(loc.temperature)
      const range = isWine ? TEMP_RANGES[wine.type] : undefined
      if (tempF !== null && range && tempF >= range[0] && tempF <= range[1]) {
        score += 40
        reasons.push('Temperature match')
      }

      // Signal 2: Wine type grouping (+30 or +15)
      const typeMap = locationTypeMap[loc.id] || {}
      const totalInLoc = Object.values(typeMap).reduce((a, b) => a + b, 0)
      const sameTypeCount = group ? typeMap[group] || 0 : 0
      if (totalInLoc > 0 && sameTypeCount > totalInLoc / 2) {
        score += 30
        reasons.push(isWine ? 'Wine type grouping' : 'Kept with the same drinks')
      } else if (group && nameSuggestsGroup(loc.name, group)) {
        // Whole words only: "Covered terrace" is not a red-wine zone.
        score += 15
        reasons.push(isWine ? 'Location name suggests wine type' : 'Location name suggests this drink')
      }

      // Signal 3: Capacity availability (+0–20 proportional; 0 when unrecorded)
      const capScore =
        available == null || loc.capacity == null
          ? 0
          : Math.round((available / loc.capacity) * 20)
      score += capScore
      if (loc.capacity == null) reasons.push('Capacity not recorded')
      else if (capScore >= 15) reasons.push('High capacity available')
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
        wineType: isWine ? wine.type : wine.kind!.replace(/_/g, ' '),
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
