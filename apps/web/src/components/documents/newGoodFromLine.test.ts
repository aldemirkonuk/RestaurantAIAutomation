import { describe, expect, it } from 'vitest'
import { goodBody, proposeGood, unitMisfit } from './newGoodFromLine'

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
