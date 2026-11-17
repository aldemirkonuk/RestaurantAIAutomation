import { describe, expect, it } from 'vitest'
import { menuReadNoteText } from './MenuReadNotes'

// r28 G8: a bare Price / Fiyat column is read as each line's one price, and the
// read says so once, with how to read it as glass prices instead.
describe('menuReadNoteText: a bare price column', () => {
  it('says the column was read as each line\'s price, and how to read it as glass prices', () => {
    expect(menuReadNoteText({ row: 1, reason: 'price_column_read_as_bottle', raw: 'Fiyat (TL)' })).toBe(
      'The column "Fiyat (TL)" was read as each line\'s price: a drink\'s bottle price, a dish\'s price. If it holds glass prices, name it Glass price / Kadeh fiyatı and read the file again.',
    )
  })

  it('still says a bare column that was not read', () => {
    expect(menuReadNoteText({ row: 1, reason: 'price_column_not_read', raw: 'Price' })).toBe(
      'The column "Price" was not read: name it Bottle price / Şişe fiyatı or Glass price / Kadeh fiyatı.',
    )
  })
})

describe('menuReadNoteText: a price below zero', () => {
  it('says the price was below zero and left blank, not "could not be read"', () => {
    expect(menuReadNoteText({ row: 2, reason: 'negative', field: 'bottle_price', raw: '-10' })).toBe(
      'Line 2: the bottle price "-10" is below zero, so it was left blank.',
    )
  })
})
