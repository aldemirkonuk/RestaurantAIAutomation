/**
 * The column headings a menu file is read by (F-017).
 *
 * The gateway reads a CSV or Excel menu by its header row
 * (apps/api-gateway/src/menus/parsers/csv-parser.service.ts, HEADER_MAP) and
 * ignores any column it does not know. Before, the preview showed every column
 * and said nothing, so a `glass` column was dropped with no word. This list is
 * that map's keys, and menuColumns.test.ts holds the two equal: a heading the
 * gateway learns and this file does not would be named as skipped when it is
 * read, and the reverse would hide a skip.
 */
export const MENU_COLUMN_NAMES: readonly string[] = [
  'name',
  'wine_name',
  'wine',
  'drink',
  'item',
  'ad',
  'adi',
  'isim',
  'urun',
  'urun_adi',
  'sarap',
  'sarap_adi',
  'producer',
  'winery',
  'vineyard',
  'chateau',
  'brand',
  'uretici',
  'marka',
  'vintage',
  'year',
  'yil',
  'rekolte',
  'region',
  'appellation',
  'bolge',
  'grape',
  'variety',
  'grape_variety',
  'uzum',
  'category',
  'type',
  'kategori',
  'tur',
  'by_glass',
  'by_the_glass',
  'glass',
  'pour',
  'glass_price',
  'by_glass_price',
  'kadeh',
  'kadeh_fiyati',
  'bottle',
  'bottle_price',
  'sise',
  'sise_fiyati',
]

/**
 * The gateway's header spelling: no byte-order mark, accents folded ("Şişe" →
 * sise, dotless ı → i), lowercase, trimmed, spaces/hyphens → `_`.
 */
export function normalizeMenuHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .trim()
    .replace(/[\s-]+/g, '_')
}

/** The headings in a file's header row that will not be read, as written. */
export function skippedMenuColumns(headers: readonly string[]): string[] {
  const known = new Set(MENU_COLUMN_NAMES)
  return headers
    .map((h) => h.replace(/^\uFEFF/, '').trim())
    .filter((h) => h.length > 0 && !known.has(normalizeMenuHeader(h)))
}
