import { beforeEach, describe, expect, it } from 'vitest'
import {
  MENU_KINDS,
  absentFamilies,
  isKitchenLine,
  lineIsDrink,
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

describe('isKitchenLine — Turkish drink sections (F-1272)', () => {
  it('keeps a wine in a Turkish section a drink', () => {
    for (const category of ['Kırmızı', 'Beyaz', 'Roze', 'Pembe', 'Köpüklü', 'Tatlı şarap', 'Rakı', 'Bira', 'Viski', 'KIRMIZI']) {
      expect(isKitchenLine({ category, rawText: `X,${category},2020,450,meze ile` })).toBe(false)
    }
  })

  it("never reads 'tatlı' (sweet) in a row as food", () => {
    expect(isKitchenLine({ category: null, rawText: 'Moscato,yarı tatlı,2022,380' })).toBe(false)
    expect(isKitchenLine({ category: null, rawText: 'Late harvest,2019,pairs with desserts' })).toBe(false)
  })

  it('still sets a dessert section aside', () => {
    expect(isKitchenLine({ category: 'Tatlılar', rawText: 'Künefe,180' })).toBe(true)
    expect(isKitchenLine({ category: 'Desserts', rawText: null })).toBe(true)
  })
})

// F-1317: a drink word wins only when the section names no food.
describe('isKitchenLine — Turkish kitchen sections that say a colour (F-1317)', () => {
  it('keeps meat and dessert sections in the kitchen', () => {
    for (const category of ['Kırmızı Et', 'Beyaz Et', 'Kırmızı Et Yemekleri', 'Tatlı', 'TATLI', 'Beyaz Peynirli Salata']) {
      expect(isKitchenLine({ category, rawText: `X,${category},450` })).toBe(true)
    }
  })

  it('keeps wine and rakı sections drinks', () => {
    for (const category of ['Kırmızı Şarap', 'Tatlı Şarap', 'Rakı', 'Kırmızı']) {
      expect(isKitchenLine({ category, rawText: `X,${category},2020,450` })).toBe(false)
    }
  })
})

// F-1392: 'et' is also French "and", and a wine for fish is still a wine.
describe('isKitchenLine — a wine word beats a food noun (F-1392)', () => {
  it('keeps French and Turkish wine sections drinks', () => {
    for (const category of ['Rouges et Rosés', 'Champagne et Crémant', 'Vins Blancs', 'Balık Şarapları', 'Et yanına kırmızı şaraplar']) {
      expect(isKitchenLine({ category, rawText: 'Château Margaux 2015' })).toBe(false)
    }
  })

  it("reads 'et' as meat only as the heading", () => {
    for (const category of ['Kırmızı Et', 'Beyaz Et', 'Et', 'ET', 'Etler']) {
      expect(isKitchenLine({ category, rawText: `X,${category},450` })).toBe(true)
    }
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

describe('lineIsDrink — a line is a drink only when stored or proven (ADR 0340 rule 7)', () => {
  it('a stored kind decides, whatever the section says', () => {
    expect(lineIsDrink({ category: 'Starters', rawText: null, lineKind: 'drink' })).toBe(true)
    expect(lineIsDrink({ category: 'red', rawText: null, lineKind: 'dish' })).toBe(false)
    expect(lineIsDrink({ category: 'red', rawText: null, lineKind: 'dish' }, 'beverage')).toBe(false)
  })

  it('with no stored kind, a line on a Food or Desserts menu is not a drink', () => {
    expect(lineIsDrink({ category: 'red', rawText: 'Barolo 120' }, 'food')).toBe(false)
    expect(lineIsDrink({ category: null, rawText: 'Baklava 9' }, 'desserts')).toBe(false)
    expect(lineIsDrink({ category: 'dessert', rawText: 'Moscato 9', lineKind: 'drink' }, 'desserts')).toBe(true)
  })

  it('with no stored kind elsewhere, the legacy rule decides, exactly as isKitchenLine', () => {
    for (const menuKind of ['beverage', 'full', null, undefined]) {
      for (const item of [
        { category: 'red', rawText: 'Barolo 120' },
        { category: 'Starters', rawText: null },
        { category: null, rawText: 'Tiramisu dessert 9' },
        { category: null, rawText: 'House pour 9' },
      ]) {
        expect(lineIsDrink(item, menuKind)).toBe(!isKitchenLine(item))
      }
    }
  })
})
