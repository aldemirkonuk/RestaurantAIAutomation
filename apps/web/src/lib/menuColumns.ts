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
  'item',
  'producer',
  'winery',
  'vineyard',
  'chateau',
  'château',
  'brand',
  'vintage',
  'year',
  'region',
  'appellation',
  'grape',
  'variety',
  'grape_variety',
  'category',
  'type',
  'by_glass',
  'by_the_glass',
  'glass',
  'pour',
  'glass_price',
  'by_glass_price',
  'bottle',
  'bottle_price',
]

/** The gateway's header spelling: lowercase, trimmed, spaces/hyphens → `_`, no BOM. */
export function normalizeMenuHeader(header: string): string {
  return header.replace(/^﻿/, '').toLowerCase().trim().replace(/[\s-]+/g, '_')
}

/** The headings in a file's header row that will not be read, as written. */
export function skippedMenuColumns(headers: readonly string[]): string[] {
  const known = new Set(MENU_COLUMN_NAMES)
  return headers
    .map((h) => h.replace(/^﻿/, '').trim())
    .filter((h) => h.length > 0 && !known.has(normalizeMenuHeader(h)))
}
