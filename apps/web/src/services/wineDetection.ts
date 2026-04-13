import { Wine as WineType } from '../data/wineData'
import { searchWines } from './api/wines'
import { mapApiWinesToUiWines } from '../lib/wine-library'

/**
 * Wine Detection Service
 * ======================
 * Handles the full scanning pipeline via the backend:
 *   YOLO (13-class) → OCR → Gemini field parser → library matching
 *
 * The backend does all heavy lifting. This service:
 * 1. Sends images/text to backend endpoints
 * 2. Receives 25 structured fields per wine
 * 3. Provides local fuzzy matching as a quick first-pass
 */

const ORCHESTRATOR_URL =
  import.meta.env?.VITE_AGENT_ORCHESTRATOR_URL ||
  import.meta.env?.VITE_API_GATEWAY_URL ||
  'http://localhost:8000'

// =============================================================================
// DETECTED WINE INTERFACE (25 fields + meta)
// =============================================================================

export interface DetectedWine {
  id: string

  // ── Layer 1: Identity (MUST HAVE) ──
  name: string
  producer?: string
  vintage?: number | null
  wineType?: 'red' | 'white' | 'sparkling' | 'rose' | 'dessert' | 'fortified' | 'orange'
  country?: string
  region?: string
  grapeVariety?: string
  /** @deprecated Use wineType instead */
  type?: 'red' | 'white' | 'sparkling' | 'rose' | 'dessert'
  /** @deprecated Use grapeVariety instead */
  grape?: string

  // ── Layer 2: Appellation + Structure ──
  subRegion?: string
  appellation?: string
  appellationClass?: string
  appellationTier?: string
  isBlend?: boolean
  body?: 'light' | 'medium' | 'medium-full' | 'full'
  sweetness?: 'bone-dry' | 'dry' | 'off-dry' | 'medium-sweet' | 'sweet'
  acidity?: string
  tannins?: string
  alcoholPct?: number
  texture?: string
  finish?: 'short' | 'medium' | 'long' | 'very-long'
  primaryAromas?: string[]
  secondaryAromas?: string[]
  tertiaryAromas?: string[]

  // ── Layer 3: Quality + Production ──
  qualityLevel?: string
  classificationName?: string
  classificationSystem?: string
  reserveStatus?: string
  vintageQuality?: string
  farming?: string
  agingVessel?: string
  agingDuration?: string
  servingTempCelsius?: number
  glassType?: string
  decantingRecommended?: boolean
  agingPotentialYears?: number
  foodPairings?: string[]
  tastingNotes?: string
  bottleVolume?: string
  bottleSizeMl?: number
  price?: number
  priceCurrency?: string
  servingType?: 'glass' | 'bottle' | 'carafe'
  ratingWs?: string
  ratingRp?: string
  ratingJr?: string
  /** @deprecated Use classificationName + classificationSystem instead */
  rating?: string
  /** @deprecated Use classificationName + classificationSystem instead */
  classification?: string

  // ── Metadata: Confidence + Governance ──
  confidence: number
  fieldConfidences?: Record<string, number>
  fieldSources?: Record<string, string>
  warnings?: string[]
  libraryTier?: number  // 0=Canonical, 1=AutoValidated, 2=WebEnriched, 3=Provisional, 4=Unresolved
  canonicalNameVerified?: boolean
  inMasterLibrary: boolean
  masterWineId?: string
  source:
    | 'yolov8'
    | 'ocr'
    | 'gemini'
    | 'openai'
    | 'vivino'
    | 'wine_searcher'
    | 'menu_scan'
    | 'label_scan'
    | 'invoice_scan'
    | 'gemini_research'
  fallbackUsed?: boolean
  externalData?: any
}

// =============================================================================
// BACKEND RESPONSE → DetectedWine MAPPER
// =============================================================================

function mapBackendWineToDetected(raw: any, index: number): DetectedWine {
  return {
    id: raw.master_wine_id || `detected_${Date.now()}_${index}`,

    // Layer 1: Identity
    name: raw.wine_name || raw.name || 'Unknown Wine',
    producer: raw.producer ?? undefined,
    vintage: raw.vintage ?? null,
    wineType: raw.wine_type ?? undefined,
    type: raw.wine_type ?? undefined,
    country: raw.country ?? undefined,
    region: raw.region ?? undefined,
    grapeVariety: raw.grape_variety ?? undefined,
    grape: raw.grape_variety ?? raw.grape ?? undefined,

    // Layer 2: Appellation + Structure
    subRegion: raw.sub_region ?? undefined,
    appellation: raw.appellation ?? undefined,
    appellationClass: raw.appellation_class ?? undefined,
    appellationTier: raw.appellation_tier ?? undefined,
    isBlend: raw.is_blend ?? undefined,
    body: raw.body ?? undefined,
    sweetness: raw.sweetness ?? undefined,
    acidity: raw.acidity ?? undefined,
    tannins: raw.tannins ?? undefined,
    alcoholPct: raw.alcohol_pct ?? undefined,
    texture: raw.texture ?? undefined,
    finish: raw.finish ?? undefined,
    primaryAromas: raw.primary_aromas ?? undefined,
    secondaryAromas: raw.secondary_aromas ?? undefined,
    tertiaryAromas: raw.tertiary_aromas ?? undefined,

    // Layer 3: Quality + Production
    qualityLevel: raw.quality_level ?? undefined,
    classificationName: raw.classification_name ?? undefined,
    classificationSystem: raw.classification_system ?? undefined,
    reserveStatus: raw.reserve_status ?? undefined,
    vintageQuality: raw.vintage_quality ?? undefined,
    farming: raw.farming ?? undefined,
    agingVessel: raw.aging_vessel ?? undefined,
    agingDuration: raw.aging_duration ?? undefined,
    servingTempCelsius: raw.serving_temp_celsius ?? undefined,
    glassType: raw.glass_type ?? undefined,
    decantingRecommended: raw.decanting_recommended ?? undefined,
    agingPotentialYears: raw.aging_potential_years ?? undefined,
    foodPairings: raw.food_pairings ?? undefined,
    tastingNotes: raw.tasting_notes ?? undefined,
    bottleVolume: raw.bottle_volume ?? undefined,
    bottleSizeMl: raw.bottle_size_ml ?? undefined,
    price: raw.price ?? undefined,
    priceCurrency: raw.price_currency ?? undefined,
    servingType: raw.serving_type ?? undefined,
    ratingWs: raw.rating_ws ?? undefined,
    ratingRp: raw.rating_rp ?? undefined,
    ratingJr: raw.rating_jr ?? undefined,
    rating: raw.rating ?? undefined,
    classification: raw.classification ?? undefined,

    // Metadata: Confidence + Governance
    confidence: raw.confidence ?? 0,
    fieldConfidences: raw.field_confidences ?? {},
    fieldSources: raw.field_sources ?? {},
    warnings: raw.warnings ?? [],
    libraryTier: raw.library_tier ?? undefined,
    canonicalNameVerified: raw.canonical_name_verified ?? false,
    inMasterLibrary: raw.in_master_library ?? false,
    masterWineId: raw.master_wine_id ?? undefined,
    source: raw.source ?? 'menu_scan',
    fallbackUsed: false,
  }
}

// =============================================================================
// FUZZY MATCHING UTILITIES (fast local pre-check)
// =============================================================================

function levenshteinDistance(s1: string, s2: string): number {
  if (s1.length < s2.length) return levenshteinDistance(s2, s1)
  if (s2.length === 0) return s1.length

  let previousRow = Array.from({ length: s2.length + 1 }, (_, i) => i)
  for (let i = 0; i < s1.length; i++) {
    const currentRow = [i + 1]
    for (let j = 0; j < s2.length; j++) {
      const insertions = previousRow[j + 1] + 1
      const deletions = currentRow[j] + 1
      const substitutions = previousRow[j] + (s1[i] !== s2[j] ? 1 : 0)
      currentRow.push(Math.min(insertions, deletions, substitutions))
    }
    previousRow = currentRow
  }
  return previousRow[previousRow.length - 1]
}

function jaroWinklerSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0
  if (!s1.length || !s2.length) return 0.0

  const matchDistance = Math.max(Math.floor(Math.max(s1.length, s2.length) / 2) - 1, 0)
  const s1Matches = new Array(s1.length).fill(false)
  const s2Matches = new Array(s2.length).fill(false)

  let matches = 0
  let transpositions = 0

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance)
    const end = Math.min(i + matchDistance + 1, s2.length)
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue
      s1Matches[i] = true
      s2Matches[j] = true
      matches++
      break
    }
  }

  if (matches === 0) return 0.0

  let k = 0
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue
    while (!s2Matches[k]) k++
    if (s1[i] !== s2[k]) transpositions++
    k++
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3
  let prefix = 0
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++
    else break
  }
  return jaro + prefix * 0.1 * (1 - jaro)
}

function tokenOverlapScore(s1: string, s2: string): number {
  const stopWords = new Set([
    'the', 'de', 'di', 'du', 'le', 'la', 'les', 'des', 'and',
    'wine', 'wines', 'estate', 'vineyard',
  ])
  const tokens1 = new Set(s1.toLowerCase().split(/\s+/).filter(t => !stopWords.has(t)))
  const tokens2 = new Set(s2.toLowerCase().split(/\s+/).filter(t => !stopWords.has(t)))

  if (!tokens1.size || !tokens2.size) return 0.5

  let intersection = 0
  tokens1.forEach(t => { if (tokens2.has(t)) intersection++ })
  const union = new Set([...tokens1, ...tokens2]).size

  return union > 0 ? intersection / union : 0.0
}

function normalizeWineName(name: string): string {
  let n = name.toLowerCase().trim()
  const replacements: Record<string, string> = {
    'ch.': 'chateau', 'dom.': 'domaine', 'rsv': 'reserve', 'rsv.': 'reserve',
    'cab.': 'cabernet', 'sauv.': 'sauvignon', 'chard.': 'chardonnay',
    'p. noir': 'pinot noir', 'p.noir': 'pinot noir',
    'sev.': 'sevilen', 'byz': 'beyaz', 'krm': 'kirmizi',
  }
  for (const [abbr, full] of Object.entries(replacements)) {
    n = n.replace(new RegExp(abbr.replace('.', '\\.'), 'gi'), full)
  }
  return n.replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim()
}

// =============================================================================
// MASTER LIBRARY LOCAL CHECK (fast first-pass)
// =============================================================================

export async function checkMasterLibrary(
  name: string,
  vintage?: number | null,
  producer?: string,
): Promise<{ found: boolean; wine?: WineType; confidence: number }> {
  const normalizedName = normalizeWineName(name)
  const normalizedProducer = producer ? normalizeWineName(producer) : undefined

  try {
    const apiWines = await searchWines({ search: name, limit: 20 })
    const wines = mapApiWinesToUiWines(apiWines)

    let bestMatch: WineType | undefined
    let bestScore = 0

    for (const w of wines) {
      const normalizedWine = normalizeWineName(w.name)

      if (normalizedWine === normalizedName) {
        if (vintage && w.vintage === vintage) return { found: true, wine: w, confidence: 1.0 }
        if (!vintage) return { found: true, wine: w, confidence: 0.98 }
      }

      const jwScore = jaroWinklerSimilarity(normalizedName, normalizedWine)
      const tokenScore = tokenOverlapScore(normalizedName, normalizedWine)
      const maxLen = Math.max(normalizedName.length, normalizedWine.length)
      const levDist = levenshteinDistance(normalizedName, normalizedWine)
      const levSim = maxLen > 0 ? 1 - levDist / maxLen : 0

      let combined = jwScore * 0.4 + tokenScore * 0.35 + levSim * 0.25

      if (normalizedProducer && w.producer) {
        const producerSim = jaroWinklerSimilarity(normalizedProducer, normalizeWineName(w.producer))
        combined = combined * 0.7 + producerSim * 0.3
      }

      if (vintage && w.vintage) {
        if (w.vintage === vintage) combined = Math.min(1.0, combined + 0.1)
        else if (Math.abs(w.vintage - vintage) <= 1) combined = Math.min(1.0, combined + 0.05)
      }

      if (combined > bestScore) {
        bestScore = combined
        bestMatch = w
      }
    }

    if (bestMatch && bestScore >= 0.75) {
      return { found: true, wine: bestMatch, confidence: bestScore }
    }
  } catch {
    // Ignore API errors
  }

  // Also try backend fuzzy match endpoint
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/scan/fuzzy-match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: name, producer, vintage, limit: 5 }),
    })
    if (res.ok) {
      const data = await res.json()
      if (data.matches?.length > 0 && data.matches[0].similarity_score >= 0.75) {
        const top = data.matches[0]
        return {
          found: true,
          wine: {
            id: top.wine_id,
            name: top.name,
            producer: top.producer || '',
            vintage: top.vintage,
          } as any,
          confidence: top.similarity_score,
        }
      }
    }
  } catch {
    // Backend unavailable
  }

  return { found: false, confidence: 0 }
}

// =============================================================================
// BACKEND-POWERED SCANNING
// =============================================================================

/**
 * Scan a single wine text through the backend 4-layer pipeline.
 * Returns 25 structured fields.
 */
export async function scanWineText(
  ocrText: string,
  sourceType: 'menu' | 'label' | 'invoice' = 'menu',
  restaurantId?: string,
): Promise<DetectedWine> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/scan/wine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ocr_text: ocrText,
        source_type: sourceType,
        restaurant_id: restaurantId,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      return mapBackendWineToDetected(data, 0)
    }
  } catch (error) {
    console.error('Wine text scan failed:', error)
  }

  // Fallback
  return {
    id: `detected_${Date.now()}_fallback`,
    name: ocrText.split('\n')[0]?.trim() || 'Unknown Wine',
    confidence: 0.2,
    inMasterLibrary: false,
    source: 'ocr',
    fallbackUsed: true,
  }
}

/**
 * Scan a full menu image through the backend.
 * Returns all detected wines with 25 fields each.
 */
export async function scanMenuImage(
  imageBase64: string,
  restaurantId?: string,
): Promise<{ wines: DetectedWine[]; regionsDetected: number; sectionHeaders: string[] }> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/scan/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_base64: imageBase64,
        source_type: 'menu',
        restaurant_id: restaurantId,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      return {
        wines: (data.wines || []).map((w: any, i: number) => mapBackendWineToDetected(w, i)),
        regionsDetected: data.regions_detected || 0,
        sectionHeaders: data.section_headers || [],
      }
    }
  } catch (error) {
    console.error('Menu image scan failed:', error)
  }

  return { wines: [], regionsDetected: 0, sectionHeaders: [] }
}

/**
 * Deep research an unknown wine via the backend.
 */
export async function researchWine(
  name: string,
  producer?: string,
  vintage?: number | null,
  restaurantId?: string,
): Promise<Partial<DetectedWine>> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/scan/wine-research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wine_name: name,
        producer,
        vintage,
        restaurant_id: restaurantId,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      if (data.found_in_library && data.match) {
        return {
          name: data.match.name,
          producer: data.match.producer,
          vintage: data.match.vintage,
          confidence: data.confidence || 0.9,
          inMasterLibrary: true,
          masterWineId: data.match.wine_id,
          source: 'gemini_research',
        }
      }
      if (data.enrichment) {
        return {
          name: data.enrichment.name || name,
          producer: data.enrichment.producer || producer,
          vintage: data.enrichment.vintage || vintage,
          wineType: data.enrichment.wine_type,
          country: data.enrichment.country,
          region: data.enrichment.region,
          grape: data.enrichment.grape_variety,
          tastingNotes: data.enrichment.tasting_notes,
          foodPairings: data.enrichment.food_pairings,
          confidence: data.confidence || 0.6,
          inMasterLibrary: false,
          source: 'gemini_research',
        }
      }
    }
  } catch (error) {
    console.error('Wine research failed:', error)
  }

  return {
    name,
    producer,
    vintage,
    confidence: 0.1,
    inMasterLibrary: false,
    source: 'gemini_research',
  }
}

// =============================================================================
// COMPREHENSIVE DETECTION PIPELINE (with local fallbacks)
// =============================================================================

/**
 * Detect a single wine with full fallback chain:
 *   1. Local master library check (fast)
 *   2. Backend field parser + matching (25 fields)
 *   3. Backend deep research (for unknown wines)
 */
export async function detectWineWithFallbacks(
  rawData: {
    name: string
    producer?: string
    vintage?: number | null
    ocrText?: string
    restaurantId?: string
  },
): Promise<DetectedWine> {
  const { name, producer, vintage, ocrText, restaurantId } = rawData

  // Step 1: Local quick check
  const localCheck = await checkMasterLibrary(name, vintage, producer)
  if (localCheck.found && localCheck.wine) {
    return {
      id: `detected_${Date.now()}_${Math.random()}`,
      name: localCheck.wine.name,
      producer: localCheck.wine.producer,
      vintage: localCheck.wine.vintage,
      type: localCheck.wine.type,
      wineType: localCheck.wine.type,
      region: localCheck.wine.region,
      country: localCheck.wine.country,
      grape: localCheck.wine.grape,
      price: localCheck.wine.price,
      confidence: localCheck.confidence,
      inMasterLibrary: true,
      masterWineId: localCheck.wine.id,
      source: 'menu_scan',
      fallbackUsed: false,
      fieldSources: { name: 'local_match' },
    }
  }

  // Step 2: Backend full pipeline
  try {
    const scanned = await scanWineText(ocrText || name, 'menu', restaurantId)
    if (scanned.confidence >= 0.5) {
      return scanned
    }
  } catch {
    console.warn('Backend scan unavailable')
  }

  // Step 3: Deep research
  try {
    const researched = await researchWine(name, producer, vintage, restaurantId)
    return {
      id: `detected_${Date.now()}_${Math.random()}`,
      name: researched.name || name,
      producer: researched.producer || producer,
      vintage: researched.vintage || vintage,
      wineType: researched.wineType,
      type: researched.wineType as any,
      country: researched.country,
      region: researched.region,
      grape: researched.grape,
      confidence: researched.confidence || 0.4,
      inMasterLibrary: researched.inMasterLibrary || false,
      masterWineId: researched.masterWineId,
      source: 'gemini_research',
      fallbackUsed: true,
      tastingNotes: researched.tastingNotes,
      foodPairings: researched.foodPairings,
    }
  } catch {
    console.warn('Deep research unavailable')
  }

  // Final fallback
  return {
    id: `detected_${Date.now()}_${Math.random()}`,
    name,
    producer,
    vintage,
    confidence: 0.2,
    inMasterLibrary: false,
    source: 'ocr',
    fallbackUsed: true,
  }
}

/**
 * Batch process multiple wines from menu scan.
 */
export async function batchDetectWines(
  rawDetections: Array<{
    name: string
    producer?: string
    vintage?: number | null
    ocrText?: string
    restaurantId?: string
  }>,
): Promise<DetectedWine[]> {
  console.log(`Processing ${rawDetections.length} wines...`)

  const results = await Promise.all(
    rawDetections.map(raw => detectWineWithFallbacks(raw)),
  )

  const inMaster = results.filter(r => r.inMasterLibrary).length
  const highConf = results.filter(r => r.confidence >= 0.8).length
  console.log(
    `Detection complete: ${inMaster} in Master Library, ${highConf} high confidence`,
  )

  return results
}

// Legacy exports for backward compatibility
export { normalizeWineName }
export const geminiWineInterpretation = scanWineText
export const geminiDeepResearch = researchWine
export const openaiWineInterpretation = scanWineText
export const searchVivino = async () => null
export const searchWineSearcher = async () => null
