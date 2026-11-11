import { describe, expect, it } from 'vitest'
import { isKitchenLine, lineNeedsPencil, lineSourceCrop } from './firstProof'

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

describe('isKitchenLine (the same test as the gateway\'s menu-line-view.ts)', () => {
  it('a known drink section wins: a dessert wine stays a drink (QA M18)', () => {
    expect(isKitchenLine({ category: 'dessert', rawText: 'Sauternes, Ch. Suduiraut, 2015' })).toBe(false)
    expect(isKitchenLine({ category: 'red', rawText: 'Chianti, great with pasta' })).toBe(false)
    expect(isKitchenLine({ category: 'sparkling', rawText: 'Dish Imports, Cava' })).toBe(false)
  })

  it('with no known section, a hint decides as a whole word, plurals too', () => {
    expect(isKitchenLine({ category: null, rawText: 'Desserts: Tiramisu 12' })).toBe(true)
    expect(isKitchenLine({ category: 'Starters', rawText: null })).toBe(true)
    expect(isKitchenLine({ category: 'Entrées', rawText: null })).toBe(true)
    expect(isKitchenLine({ category: null, rawText: 'Pastaio Rosso, 2020' })).toBe(false)
    expect(isKitchenLine({ category: null, rawText: 'Dishwasher-safe carafe' })).toBe(false)
  })
})
