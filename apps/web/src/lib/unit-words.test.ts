import { describe, expect, it } from 'vitest'
import { UNIT_WORDS, unitMany, unitOne, unitWord } from './unit-words'
import { unitWord as documentsUnitWord } from '@/components/documents/canonical-format'
import { fmtUnits } from '@/pages/receiving/next/rc-format'
import { describeOrderedQuantity } from '@/pages/orders/next/responses'
import { PRICE_UOMS, PRICE_UOM_LABEL, uomCountWord, uomMany, uomOne } from '@/pages/orders/next/price-unit'

/**
 * One table of unit words for the web app (2026-11-13). Before it, the same
 * order was "2 each" / "liters" on its invoice, "2 items" / "litres" on
 * /orders and "2 units" at the receiving door.
 */

describe('the one table', () => {
  it('says each of the seven stored codes in words', () => {
    expect(UNIT_WORDS).toEqual({
      bottle: ['bottle', 'bottles'],
      case: ['case', 'cases'],
      keg: ['keg', 'kegs'],
      pack: ['pack', 'packs'],
      split_case: ['split case', 'split cases'],
      each: ['item', 'items'],
      liter: ['litre', 'litres'],
    })
  })

  it('covers exactly the codes the order and price pickers offer', () => {
    expect(Object.keys(UNIT_WORDS).sort()).toEqual([...PRICE_UOMS].sort())
  })

  it('says exactly 1 in the singular and anything else in the plural', () => {
    expect(unitWord('bottle', 1)).toBe('bottle')
    for (const q of [0, 2, 0.5, null, undefined, '1']) expect(unitWord('bottle', q)).toBe('bottles')
  })

  it('prints a code outside the seven as it came, including object-key names', () => {
    for (const code of ['kg', 'KGM', '__proto__', 'constructor', 'toString']) {
      expect(unitOne(code)).toBe(code)
      expect(unitMany(code)).toBe(code)
      expect(unitWord(code, 2)).toBe(code)
    }
  })
})

describe('every page reads the one table', () => {
  it('documents: an invoice line says items and litres', () => {
    expect(documentsUnitWord('each', 2)).toBe('items')
    expect(documentsUnitWord('liter', 1)).toBe('litre')
    expect(documentsUnitWord('liter', 3)).toBe('litres')
  })

  it('receiving door: items, not units', () => {
    expect(fmtUnits(2, 'each')).toBe('2 items')
    expect(fmtUnits(1, ' LITER ')).toBe('1 litre')
    expect(fmtUnits(4, 'kg')).toBe('4 kg')
    expect(fmtUnits(4, '')).toBe('4 (unit unknown)')
  })

  it('vendor answers: one case is "1 case", and an each order is items', () => {
    expect(describeOrderedQuantity({ quantity: 1, unitType: 'case', bottlesTotal: 12 })).toBe(
      '1 case of 12 — 12 bottles',
    )
    expect(describeOrderedQuantity({ quantity: 3, unitType: 'each', bottlesTotal: 3 })).toBe('3 items')
  })

  it('/orders: the picker, the counts and the per-unit words', () => {
    for (const u of PRICE_UOMS) {
      expect(PRICE_UOM_LABEL[u]).toBe(`per ${unitOne(u)}`)
      expect(uomOne(u)).toBe(unitOne(u))
      expect(uomMany(u)).toBe(unitMany(u))
      expect(uomCountWord(1, u)).toBe(unitOne(u))
      expect(uomCountWord(2, u)).toBe(unitMany(u))
    }
    expect(PRICE_UOM_LABEL.each).toBe('per item')
    expect(PRICE_UOM_LABEL.liter).toBe('per litre')
  })
})
