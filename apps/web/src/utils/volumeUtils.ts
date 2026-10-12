import { parseDecimal, type GroupMark } from '../lib/parseDecimal'

export type MeasurementUnit = 'ml' | 'oz'

const ML_PER_OZ = 29.5735

// ==================== Validation ====================

export const BOTTLE_SIZE_MIN_ML = 50
// A US half-barrel keg is 58,674 ml; the gateway takes up to 60,000 (F-1383).
export const BOTTLE_SIZE_MAX_ML = 60000
export const POUR_SIZE_MIN_ML = 30
export const POUR_SIZE_MAX_ML = 500

export function isValidBottleSize(ml: number): boolean {
  return Number.isFinite(ml) && ml >= BOTTLE_SIZE_MIN_ML && ml <= BOTTLE_SIZE_MAX_ML
}

export function isValidPourSize(ml: number): boolean {
  return Number.isFinite(ml) && ml >= POUR_SIZE_MIN_ML && ml <= POUR_SIZE_MAX_ML
}

// ==================== Converters ====================

export function mlToOz(ml: number): number {
  return Math.round((ml / ML_PER_OZ) * 10) / 10
}

export function ozToMl(oz: number): number {
  return Math.round(oz * ML_PER_OZ)
}

// ==================== Display Formatters ====================

export function formatVolume(ml: number, unit: MeasurementUnit = 'ml'): string {
  if (unit === 'oz') {
    const oz = mlToOz(ml)
    return `${oz}oz`
  }
  if (ml >= 1000 && ml % 100 === 0) {
    const liters = ml / 1000
    return `${liters}L`
  }
  return `${ml}ml`
}

export function formatPourSize(ml: number, unit: MeasurementUnit = 'ml'): string {
  if (unit === 'oz') {
    const oz = mlToOz(ml)
    return `${oz}oz`
  }
  return `${ml}ml`
}

export function formatVolumeWithBothUnits(ml: number): string {
  const oz = mlToOz(ml)
  const mlDisplay = ml >= 1000 && ml % 100 === 0 ? `${ml / 1000}L` : `${ml}ml`
  return `${mlDisplay} / ${oz}oz`
}

// ==================== Calculations ====================

export function getGlassesPerBottle(
  bottleMl: number,
  pourMl: number,
  override?: number | null
): number {
  if (override && override > 0) return override
  if (!pourMl || pourMl <= 0) return 0
  return Math.floor(bottleMl / pourMl)
}

export function volumeToBottles(totalMl: number, bottleSizeMl: number): number {
  if (!bottleSizeMl || bottleSizeMl <= 0) return 0
  return Math.round((totalMl / bottleSizeMl) * 100) / 100
}

export function bottlesToVolume(count: number, bottleSizeMl: number): number {
  return count * bottleSizeMl
}

export function getEffectiveBottleSize(
  inventoryBottleSizeMl: number | null | undefined,
  libraryBottleSizeMl: number | null | undefined
): number {
  return inventoryBottleSizeMl ?? libraryBottleSizeMl ?? 750
}

export function costPerGlass(bottleCost: number, glassesPerBottle: number): number {
  if (!glassesPerBottle || glassesPerBottle <= 0) return 0
  return Math.round((bottleCost / glassesPerBottle) * 100) / 100
}

export function glassMarginPercent(glassCost: number, glassMenuPrice: number): number {
  if (!glassMenuPrice || glassMenuPrice <= 0) return 0
  return Math.round(((glassMenuPrice - glassCost) / glassMenuPrice) * 10000) / 100
}

// ==================== Smart Volume Parser ====================

// The number in a size, as typed: "750", "1.5", "1,5" (F-834). A lone comma
// is a decimal mark ("37,5 cl", "1,5 L") unless the house's numbers group
// thousands with it and three digits follow: "1,750 ml" is a handle in a US
// house, not 1.75 ml (F-1484). With no house mark, parseDecimal's rule 4 holds.
const NUM = String.raw`(\d[\d.,]*)`
const VOLUME_PATTERNS = [
  { regex: new RegExp(String.raw`^${NUM}\s*L$`, 'i'), toMl: (v: number) => v * 1000 },
  { regex: new RegExp(String.raw`^${NUM}\s*cl$`, 'i'), toMl: (v: number) => v * 10 },
  { regex: new RegExp(String.raw`^${NUM}\s*ml$`, 'i'), toMl: (v: number) => v },
  { regex: new RegExp(String.raw`^${NUM}\s*oz$`, 'i'), toMl: (v: number) => Math.round(v * ML_PER_OZ) },
  { regex: new RegExp(String.raw`^${NUM}\s*fl\.?\s*oz$`, 'i'), toMl: (v: number) => Math.round(v * ML_PER_OZ) },
  { regex: new RegExp(String.raw`^${NUM}$`), toMl: (v: number) => v },
]

export function parseVolumeInput(
  input: string,
  group: GroupMark | null = null,
): { ml: number; oz: number } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  for (const { regex, toMl } of VOLUME_PATTERNS) {
    const match = trimmed.match(regex)
    if (match) {
      const value = parseDecimal(match[1], group)
      if (value === null || !Number.isFinite(value) || value <= 0) return null
      const ml = Math.round(toMl(value))
      return { ml, oz: mlToOz(ml) }
    }
  }
  return null
}

// ==================== Presets ====================

/**
 * A pour or a serve as a person typed it (F-1381). A bare number is millilitres,
 * as these fields have always read it; "5 oz", "5 fl oz", "15 cl" and "150 ml"
 * are read in their own unit. Null when it is not a volume.
 */
export function readServeMl(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  return /[a-z]/i.test(t) ? (parseVolumeInput(t)?.ml ?? null) : parseDecimal(t)
}

/** A house that pours in US fluid ounces, so a pour is shown in oz beside ml. */
export function poursInOunces(countryCode: string | null | undefined): boolean {
  return countryCode === 'US'
}

/** "148 ml", or "148 ml (5 oz)" in a house that pours in ounces. */
export function serveLabel(ml: number, ounces: boolean): string {
  return ounces ? `${ml} ml (${mlToOz(ml)} oz)` : `${ml} ml`
}

export type SaleType = 'bottle' | 'glass' | 'both'

export interface BottleSizePreset {
  label: string
  ml: number
  oz: number
}

export interface PourSizePreset {
  label: string
  ml: number
  oz: number
}

export const COMMON_BOTTLE_SIZES: BottleSizePreset[] = [
  { label: 'Piccolo', ml: 187, oz: 6.3 },
  { label: 'Half Bottle', ml: 375, oz: 12.7 },
  { label: '500ml', ml: 500, oz: 16.9 },
  { label: 'Standard', ml: 750, oz: 25.4 },
  { label: '1 Liter', ml: 1000, oz: 33.8 },
  { label: 'Magnum', ml: 1500, oz: 50.7 },
  { label: 'Jeroboam', ml: 3000, oz: 101.4 },
  { label: 'Rehoboam', ml: 4500, oz: 152.2 },
  { label: 'Imperial', ml: 6000, oz: 202.8 },
]

export const COMMON_POUR_SIZES: PourSizePreset[] = [
  { label: '4oz / 118ml', ml: 118, oz: 4 },
  { label: '5oz / 148ml', ml: 148, oz: 5 },
  { label: '6oz / 177ml', ml: 177, oz: 6 },
  { label: '8oz / 237ml', ml: 237, oz: 8 },
  { label: '150ml / 5.1oz', ml: 150, oz: 5.1 },
  { label: '175ml / 5.9oz', ml: 175, oz: 5.9 },
  { label: '250ml / 8.5oz', ml: 250, oz: 8.5 },
]

export function getBottleSizeLabel(ml: number, unit: MeasurementUnit = 'ml'): string {
  const preset = COMMON_BOTTLE_SIZES.find(s => s.ml === ml)
  if (preset) {
    return unit === 'oz'
      ? `${preset.label} (${preset.oz}oz)`
      : `${preset.label} (${formatVolume(ml, 'ml')})`
  }
  return formatVolume(ml, unit)
}

export function getPourSizeLabel(ml: number, unit: MeasurementUnit = 'ml'): string {
  const preset = COMMON_POUR_SIZES.find(s => s.ml === ml)
  if (preset) return preset.label
  return formatPourSize(ml, unit)
}
