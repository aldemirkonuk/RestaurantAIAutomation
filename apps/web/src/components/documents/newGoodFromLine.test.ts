import { describe, expect, it } from 'vitest'
import { goodBody, goodSize, goodSizeSuffix, proposeGood, unitMisfit } from './newGoodFromLine'

/**
 * r21: a paper line becomes a good in the unit its cost can be read in. Each
 * row names what VERIFIED then posts (lot-unit-cost.ts on the gateway).
 */
describe('proposeGood', () => {
  it.each([
    // 3 kg @ 450 → kept in g → 0.45 a gram over 3,000 g.
    [{ description: 'Ezine peyniri', uom: 'kg', formatMl: null }, { kind: 'food', unit: 'g' }],
    // 5 liter @ 120 → kept in ml → 0.12 a ml over 5,000 ml (#1254).
    [{ description: 'Zeytinyağı', uom: 'liter', formatMl: null }, { kind: 'food', unit: 'ml' }],
    // 2 case @ 264 of 12 → kept by the bottle → 22.00 a bottle over 24.
    [{ description: 'Efes Pilsen 50 cl', uom: 'case', formatMl: 500 }, { kind: 'other', unit: 'bottle' }],
    [{ description: 'Fıçı bira 30 l', uom: 'keg', formatMl: 30000 }, { kind: 'beer', unit: 'keg' }],
    [{ description: 'Peçete', uom: 'each', formatMl: null }, { kind: 'food', unit: 'each' }],
  ])('%j proposes %j', (line, want) => {
    expect(proposeGood(line)).toMatchObject({ name: line.description, ...want })
  })

  it('takes the name as printed, trimmed to 120', () => {
    expect(proposeGood({ description: `  ${'x'.repeat(130)} `, uom: 'each', formatMl: null }).name).toHaveLength(120)
    expect(proposeGood({ description: null, uom: null, formatMl: null }).name).toBe('')
  })

  it('every proposal fits its own line', () => {
    for (const uom of ['kg', 'g', 'liter', 'keg', 'case', 'bottle', 'pack', 'each', null]) {
      const line = { description: 'x', uom, formatMl: null }
      expect(unitMisfit(line, proposeGood(line).unit)).toBeNull()
    }
  })
})

describe('unitMisfit: the gateway refusal, said before the good exists', () => {
  it('a bottle line kept in ml needs its size', () => {
    expect(unitMisfit({ description: 'Tonik', uom: 'bottle', formatMl: null }, 'ml')).toMatch(/does not say how much one holds/)
    expect(unitMisfit({ description: 'Tonik', uom: 'bottle', formatMl: 200 }, 'ml')).toBeNull()
  })
  it('a piece line kept in grams waits for a weight', () => {
    expect(unitMisfit({ description: 'Peynir', uom: 'each', formatMl: null }, 'g')).toMatch(/not a weight/)
    expect(unitMisfit({ description: 'Peynir', uom: 'each', formatMl: null }, 'g')).toMatch(/counts pieces,/)
    expect(unitMisfit({ description: 'Tonik', uom: 'each', formatMl: null }, 'ml')).toMatch(/counts pieces and/)
    expect(unitMisfit({ description: 'Kasa', uom: 'split_case', formatMl: null }, 'g')).toMatch(/counts split cases,/)
  })
  it('a weighed line kept by the piece or by volume is refused', () => {
    expect(unitMisfit({ description: 'Peynir', uom: 'kg', formatMl: null }, 'each')).toMatch(/Keep it by weight/)
    expect(unitMisfit({ description: 'Peynir', uom: 'kg', formatMl: null }, 'ml')).toMatch(/not a volume/)
  })
  it('a litre line kept by the bottle is refused', () => {
    expect(unitMisfit({ description: 'Süt', uom: 'liter', formatMl: null }, 'bottle')).toMatch(/Keep it by volume/)
  })
})

describe('goodBody', () => {
  it('sends kind, unit and the trimmed name', () => {
    expect(goodBody(' Ezine peyniri ', 'food', 'g')).toEqual({ ok: true, body: { kind: 'food', uom: 'g', displayName: 'Ezine peyniri' } })
  })
  it('a wine goes through the library, never as a house good', () => {
    const b = goodBody('Kavaklıdere Yakut', 'wine', 'bottle')
    expect(b.ok).toBe(false)
    if (!b.ok) expect(b.why).toMatch(/wine library/)
  })
  it('refuses an empty or long name', () => {
    expect(goodBody('  ', 'food', 'g').ok).toBe(false)
    expect(goodBody('x'.repeat(121), 'food', 'g').ok).toBe(false)
  })
})

describe('goodSizeSuffix: the label says a size only when one was set', () => {
  it('a food row the read filled with 750 says no size', () => {
    expect(goodSizeSuffix({ kind: 'food', bottleSizeMl: 750, bottle_size_ml: null })).toBe('')
    expect(goodSizeSuffix({ kind: 'other', bottleSizeMl: 750 })).toBe('')
  })
  it('a size the house set is said', () => {
    expect(goodSizeSuffix({ kind: 'other', bottleSizeMl: 200, bottle_size_ml: 200 })).toBe(' · 200 ml')
  })
  it('a wine says its library bottle', () => {
    expect(goodSizeSuffix({ kind: 'wine', bottleSizeMl: 750, bottle_size_ml: null })).toBe(' · 750 ml')
  })
})

/** r21 D2: the paper's size reaches the good, so it is never costed as a 750 ml bottle. */
describe('goodSize: the line size the good is carried with', () => {
  const tonik = { description: 'Tonik 200 ml', uom: 'bottle', formatMl: 200 }
  it('a 200 ml tonic kept by the bottle holds 200, and the body sends it', () => {
    expect(goodSize(tonik, 'bottle')).toEqual({ ml: 200, said: 'One bottle holds 200 ml, as the paper says.' })
    expect(goodBody('Tonik', 'other', 'bottle', 200)).toEqual({
      ok: true,
      body: { kind: 'other', uom: 'bottle', displayName: 'Tonik', bottleSizeMl: 200 },
    })
  })
  it('a 30 l keg holds 30000', () => {
    expect(goodSize({ description: 'Fıçı', uom: 'keg', formatMl: 30000 }, 'keg').ml).toBe(30000)
  })
  it('kept in ml, g or by the piece, a good has no container size and none is sent', () => {
    for (const unit of ['ml', 'g', 'each'] as const) {
      expect(goodSize(tonik, unit)).toEqual({ ml: null, said: null })
      expect(goodBody('Tonik', 'other', unit, 200)).toEqual({ ok: true, body: { kind: 'other', uom: unit, displayName: 'Tonik' } })
    }
  })
  it('no printed size is unknown, said in words, never 750', () => {
    const out = goodSize({ ...tonik, formatMl: null }, 'bottle')
    expect(out.ml).toBeNull()
    expect(out.said).toMatch(/does not say what one bottle holds/)
    expect(goodBody('Tonik', 'other', 'bottle', out.ml)).toEqual({ ok: true, body: { kind: 'other', uom: 'bottle', displayName: 'Tonik' } })
  })
  it('a size outside what the gateway takes is left unknown, and says the bounds', () => {
    expect(goodSize({ ...tonik, formatMl: 20 }, 'bottle')).toMatchObject({ ml: null, said: expect.stringMatching(/50 to 18000 ml/) })
    expect(goodSize({ ...tonik, formatMl: 187.5 }, 'bottle').ml).toBeNull()
    expect(goodSize({ ...tonik, formatMl: 500 }, 'keg').ml).toBeNull()
  })
})
