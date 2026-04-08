import type { WineRecord } from '../stores/useStudioSessionStore'

/**
 * Maps a Studio WineRecord to the master_wine_library insert shape.
 * Used for preview/validation on the frontend; actual DB insert uses backend field mapping.
 */
export function mapWineRecordToMasterLibrary(record: WineRecord): Record<string, unknown> {
  return {
    name: record.wine_name,
    producer: record.producer,
    vintage: record.vintage ? (parseInt(record.vintage, 10) || null) : null,
    price: record.price_bottle ? (parseFloat(record.price_bottle) || 0) : 0,
    price_glass: record.price_glass ? (parseFloat(record.price_glass) || null) : null,
    region: record.region,
    country: record.country,
    grape_variety: record.grape_variety,
    primary_type: record.primary_type || record.color,
    color: record.color,
    sweetness_level: record.sweetness_level,
    tasting_notes: record.tasting_notes,
    description: record.description,
    bottle_size_ml: 750,
    source: 'studio_promotion',
  }
}

/**
 * Returns true if the record has the minimum data required for promotion (non-empty wine_name).
 */
export function canPromote(record: WineRecord): boolean {
  return record.wine_name != null && record.wine_name.trim().length > 0
}
