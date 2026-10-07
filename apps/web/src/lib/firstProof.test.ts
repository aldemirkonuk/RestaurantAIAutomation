import { beforeEach, describe, expect, it } from 'vitest'
import type { MenuImportResult, MenuLine, MenuVersion } from '../services/api/menus'
import {
  FIRST_PROOF_KEY,
  lineNeedsPencil,
  lineSourceCrop,
  markProofLine,
  pencilledCount,
  pickHouseMenu,
  proofFromServer,
  readProof,
  writeProof,
} from './firstProof'

describe('lineNeedsPencil', () => {
  it('keeps the unmatched fallback', () => {
    expect(lineNeedsPencil({ matched: false, needsReview: false, category: 'beer' })).toBe(true)
  })

  it('uses the extractor category when it already said unknown or nothing', () => {
    expect(lineNeedsPencil({ matched: true, needsReview: false, category: null })).toBe(true)
    expect(lineNeedsPencil({ matched: true, needsReview: false, category: 'unknown' })).toBe(true)
  })

  it('does not fake certainty on a matched line with a known category', () => {
    expect(lineNeedsPencil({ matched: true, needsReview: false, category: 'beer' })).toBe(false)
  })

  it('pencils a line whose match nobody can tell by its section alone', () => {
    expect(lineNeedsPencil({ matched: null, needsReview: false, category: 'beer' })).toBe(false)
    expect(lineNeedsPencil({ matched: null, needsReview: false, category: 'unknown' })).toBe(true)
    expect(lineNeedsPencil({ matched: null, needsReview: false, category: null })).toBe(true)
  })
})

const reading: MenuImportResult = {
  menuId: 'menu-1',
  itemsExtracted: 1,
  submissionsCreated: 0,
  items: [
    {
      menuItemId: 'line-1',
      submissionId: 'sub-1',
      name: 'Read Name',
      producer: null,
      category: null,
      vintage: null,
      region: null,
      grapeVariety: null,
      byGlassPrice: 9,
      bottlePrice: null,
      rawText: 'Smoky No. 4 9',
      matched: false,
      needsReview: true,
      bbox: { x: 1, y: 2, width: 3, height: 4 },
    },
  ],
}

describe('the tab reading is a cache stamped with its house (MENU-07 b)', () => {
  beforeEach(() => sessionStorage.clear())

  it('writes the house it was read for and reads it back only for that house', () => {
    writeProof(reading, 'house-1')
    expect(JSON.parse(sessionStorage.getItem(FIRST_PROOF_KEY) ?? '{}').restaurantId).toBe('house-1')
    expect(readProof('house-1')?.menuId).toBe('menu-1')
    expect(readProof('house-2')).toBeNull()
    expect(readProof(null)).toBeNull()
  })

  it('ignores a reading with no stamp: it cannot be shown to be this house\'s', () => {
    sessionStorage.setItem(FIRST_PROOF_KEY, JSON.stringify(reading))
    expect(readProof('house-1')).toBeNull()
  })

  it('patches a placed line only in the same house\'s reading', () => {
    writeProof(reading, 'house-1')
    markProofLine('house-2', 'line-1', { category: 'beer' })
    expect(readProof('house-1')?.items[0].category).toBeNull()
    markProofLine('house-1', 'line-1', { category: 'beer', needsReview: false, matched: true })
    expect(readProof('house-1')?.items[0]).toMatchObject({ category: 'beer', needsReview: false, matched: true })
  })
})

function version(over: Partial<MenuVersion>): MenuVersion {
  return {
    menuId: 'm',
    name: null,
    status: 'draft',
    current: false,
    cadence: null,
    menuDate: null,
    menuDatePrecision: null,
    sourceMethod: 'scan',
    source: { kept: false, mime: null, bytes: null, failure: null },
    linesExtracted: 3,
    extractedAt: null,
    extractedBy: null,
    madeCurrentAt: null,
    madeCurrentBy: null,
    retiredAt: null,
    retiredBy: null,
    createdAt: null,
    ...over,
  }
}

describe('pickHouseMenu', () => {
  it('shows the current menu over a newer draft', () => {
    const current = version({ menuId: 'current', status: 'active', current: true, createdAt: '2026-10-01T00:00:00Z' })
    const draft = version({ menuId: 'draft', createdAt: '2026-10-07T00:00:00Z' })
    expect(pickHouseMenu([draft, current])?.menuId).toBe('current')
  })

  it('shows the newest draft that read lines when nothing is current', () => {
    const older = version({ menuId: 'older', extractedAt: '2026-10-01T00:00:00Z' })
    const newer = version({ menuId: 'newer', extractedAt: '2026-10-07T00:00:00Z' })
    const empty = version({ menuId: 'empty', linesExtracted: 0, extractedAt: '2026-10-08T00:00:00Z' })
    expect(pickHouseMenu([older, empty, newer])?.menuId).toBe('newer')
  })

  it('treats an unrecorded line count as unknown, not as zero', () => {
    const unrecorded = version({ menuId: 'unrecorded', linesExtracted: null, extractedAt: '2026-10-07T00:00:00Z' })
    const older = version({ menuId: 'older', extractedAt: '2026-10-01T00:00:00Z' })
    expect(pickHouseMenu([older, unrecorded])?.menuId).toBe('unrecorded')
  })

  it('falls back to the newest kept menu, and to nothing only when none is kept', () => {
    const empty = version({ menuId: 'empty', linesExtracted: 0, extractedAt: '2026-10-07T00:00:00Z' })
    expect(pickHouseMenu([empty])?.menuId).toBe('empty')
    expect(pickHouseMenu([])).toBeNull()
  })
})

describe('proofFromServer', () => {
  const stored: MenuLine = {
    id: 'line-1',
    name: 'Smoky No. 4',
    producer: null,
    category: 'whiskey',
    vintage: null,
    region: null,
    country: null,
    grape_variety: null,
    by_glass_price: 11,
    bottle_price: null,
    wine_library_id: null,
    inventory_item_id: null,
    source: 'scan',
    status: 'approved',
    created_at: '2026-10-07T00:00:00Z',
  }

  it('takes what the house keeps from the house, and only the rest from the reading', () => {
    const [line] = proofFromServer([stored], { ...reading, restaurantId: 'house-1' })
    expect(line).toMatchObject({
      menuItemId: 'line-1',
      name: 'Smoky No. 4',
      category: 'whiskey',
      byGlassPrice: 11,
      rawText: 'Smoky No. 4 9',
      matched: false,
      needsReview: true,
      submissionId: 'sub-1',
    })
    expect(line.bbox).toEqual({ x: 1, y: 2, width: 3, height: 4 })
  })

  it('says the match is unknown when no reading of this line is at hand', () => {
    const [line] = proofFromServer([stored], null)
    expect(line.matched).toBeNull()
    expect(line.needsReview).toBe(false)
    expect(line.rawText).toBeNull()
  })

  it('takes the raw line from the house, so a kitchen line counts the same in every tab', () => {
    const dish: MenuLine = { ...stored, id: 'line-2', name: 'Lamb', category: null, raw_extracted_text: 'Lamb shank (kitchen) 24' }
    const here = proofFromServer([dish], { ...reading, restaurantId: 'house-1' })
    const elsewhere = proofFromServer([dish], null)
    expect(elsewhere[0].rawText).toBe('Lamb shank (kitchen) 24')
    expect(here[0].rawText).toBe('Lamb shank (kitchen) 24')
    expect(pencilledCount(elsewhere)).toBe(0)
    expect(pencilledCount(elsewhere)).toBe(pencilledCount(here))
  })

  it("keeps the reading's raw line when the gateway does not send one", () => {
    const [line] = proofFromServer([{ ...stored, raw_extracted_text: undefined }], { ...reading, restaurantId: 'house-1' })
    expect(line.rawText).toBe('Smoky No. 4 9')
  })
})

describe('lineSourceCrop', () => {
  const image = 'data:image/png;base64,aaaa'
  const box = { x: 10, y: 20, width: 80, height: 24, page: 1 }

  it('stays empty when the extractor did not return a box', () => {
    expect(lineSourceCrop({}, image)).toBeNull()
    expect(lineSourceCrop({ bbox: null }, image)).toBeNull()
    expect(lineSourceCrop({ bbox: box }, null)).toBeNull()
  })

  it('uses a box only when the extractor already named one', () => {
    expect(lineSourceCrop({ bbox: box }, image)).toEqual({ image, box })
  })
})
