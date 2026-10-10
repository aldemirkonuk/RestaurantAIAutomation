import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENU_COLUMN_NAMES, skippedMenuColumns } from './menuColumns'

describe('menu columns (F-017)', () => {
  it('names the same headings the gateway reads', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../api-gateway/src/menus/parsers/csv-parser.service.ts'),
      'utf8',
    )
    const block = source.match(/export const HEADER_MAP[^{]*\{([\s\S]*?)\n\};/)
    expect(block).not.toBeNull()
    const keys = [...block![1].matchAll(/^\s*"?([^\s":]+)"?\s*:/gm)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(10)
    expect([...MENU_COLUMN_NAMES].sort()).toEqual([...keys].sort())
  })

  it('names a column it will not read, as the file wrote it', () => {
    expect(skippedMenuColumns(['name', 'Glass', 'bottle', 'price', 'Notes', ''])).toEqual(['price', 'Notes'])
  })

  it('reads a heading whatever its case, spacing or byte-order mark', () => {
    expect(skippedMenuColumns(['﻿Name', 'Glass Price', 'BOTTLE-PRICE'])).toEqual([])
  })
})
