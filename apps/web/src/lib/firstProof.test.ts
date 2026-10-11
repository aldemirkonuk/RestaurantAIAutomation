import { beforeEach, describe, expect, it } from 'vitest'
import {
  MENU_KINDS,
  absentFamilies,
  isKitchenLine,
  lineNeedsPencil,
  lineSourceCrop,
  pencilReason,
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

// F-273: a proof is kept with the house it was read for.
describe('readProof', () => {
  const result = { menuId: 'm', itemsExtracted: 0, submissionsCreated: 0, items: [] }
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('returns the proof to the house it was read for', () => {
    writeProof(result, null, 'house-1')
    expect(readProof('house-1')?.menuId).toBe('m')
  })

  it('returns nothing to another house', () => {
    writeProof(result, null, 'house-1')
    expect(readProof('house-2')).toBeNull()
  })

  it('returns nothing to a house when the proof never recorded one', () => {
    writeProof(result, null)
    expect(readProof('house-1')).toBeNull()
  })
})

describe('isKitchenLine — a known drink section wins (F-022)', () => {
  it('keeps a dessert wine a wine', () => {
    expect(
      isKitchenLine({ category: 'dessert', rawText: 'Domaine de Durban Muscat de Beaumes-de-Venise 14' }),
    ).toBe(false)
  })

  it('keeps a wine whose line names a kitchen word', () => {
    expect(isKitchenLine({ category: 'white', rawText: 'Assyrtiko — with the starter platter 12' })).toBe(false)
  })

  it('still sets a kitchen line aside', () => {
    expect(isKitchenLine({ category: 'food', rawText: 'Grilled octopus starter 24' })).toBe(true)
    expect(isKitchenLine({ category: null, rawText: 'Tiramisu dessert 9' })).toBe(true)
  })
})

// F-1173: the same test as the gateway's (menu-line-view.ts), on whole words.
describe('isKitchenLine — whole words, English and Turkish (F-1173)', () => {
  it('never matches inside a word', () => {
    expect(isKitchenLine({ category: null, rawText: 'Radish Imports Rosé 2022' })).toBe(false)
    expect(isKitchenLine({ category: null, rawText: 'Saladin Reserve 2018' })).toBe(false)
  })

  it('keeps a section that names wine a drink', () => {
    expect(isKitchenLine({ category: 'Dessert wines', rawText: 'Tokaji Aszú 5 puttonyos' })).toBe(false)
    expect(isKitchenLine({ category: 'Kırmızı şaraplar', rawText: 'Yakut 2019' })).toBe(false)
  })

  it('knows the sections a menu prints', () => {
    for (const category of ['Small plates', 'Mains', 'Appetizers', 'Desserts', 'Mezeler', 'Ara Sıcaklar', 'Ana Yemekler', 'TATLILAR', 'IZGARA']) {
      expect(isKitchenLine({ category, rawText: null })).toBe(true)
    }
  })
})

describe('absentFamilies — coverage from the kinds the import writes (F-024)', () => {
  it('counts red, white and non-alcoholic lines as wine and soft drinks', () => {
    const keys = absentFamilies([
      { category: 'red' },
      { category: 'white' },
      { category: 'non-alcoholic' },
      { category: 'beer' },
    ]).map((family) => family.key)
    expect(keys).not.toContain('wine')
    expect(keys).not.toContain('soft drink')
    expect(keys).toEqual(['cider', 'spirit', 'cocktail', 'sake'])
  })

  it('counts a whiskey line as spirits', () => {
    expect(absentFamilies([{ category: 'whiskey' }]).map((f) => f.key)).not.toContain('spirit')
  })

  it('offers only the sections the import writes when a line is placed', () => {
    expect(MENU_KINDS).not.toContain('wine')
    for (const kind of ['orange', 'dessert', 'fortified', 'non-alcoholic']) {
      expect(MENU_KINDS).toContain(kind)
    }
  })
})

describe('pencilReason — every pencil says why (F-021)', () => {
  it('says an unmatched line is not in the library yet', () => {
    expect(pencilReason({ matched: false, needsReview: false, category: 'red' })).toMatch(/Not in the library yet/)
  })

  it('says a line with no section could not be placed', () => {
    expect(pencilReason({ matched: true, needsReview: false, category: null })).toMatch(/which section/)
  })

  it('names an off-list section', () => {
    expect(pencilReason({ matched: true, needsReview: false, category: 'digestif' })).toMatch(/"digestif"/)
  })

  it('has nothing to say about an inked line', () => {
    expect(pencilReason({ matched: true, needsReview: false, category: 'beer' })).toBeNull()
  })
})
