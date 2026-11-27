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

describe('menuReadNoteText: a price the column cannot hold', () => {
  it('says a price too large was left blank, with the most a price can be', () => {
    expect(menuReadNoteText({ row: 3, reason: 'too_large', field: 'by_glass_price', raw: '100000000' })).toBe(
      'Line 3: the glass price "100000000" is more than a price can be (99,999,999.99), so it was left blank.',
    )
  })
  it('says a price with more than two decimals was left blank, not rounded', () => {
    expect(menuReadNoteText({ row: 4, reason: 'too_precise', field: 'bottle_price', raw: '45.5555' })).toBe(
      'Line 4: the bottle price "45.5555" has more than two decimal places, so it was left blank, not rounded.',
    )
  })
})

describe('menuReadNoteText: a workbook of several sheets', () => {
  it('names the sheet a line is on', () => {
    expect(
      menuReadNoteText({ row: 3, reason: 'two_readings', field: 'bottle_price', raw: '1.250', sheet: 'Cocktails' }),
    ).toBe('Sheet "Cocktails", line 3: the bottle price "1.250" reads two ways, so it was left blank. Write 1250, 1.250,00 or 1,250.00.')
  })

  it('names the sheet a column note is about, and a sheet with no name column', () => {
    expect(menuReadNoteText({ row: 1, reason: 'no_name_column', sheet: 'Read me' })).toBe(
      'Sheet "Read me": No column was read as the name (Name, Wine, Ad, Şarap), so no line was read.',
    )
  })

  it('says nothing of a sheet when the note has none', () => {
    expect(menuReadNoteText({ row: 2, reason: 'negative', field: 'bottle_price', raw: '-10' })).toBe(
      'Line 2: the bottle price "-10" is below zero, so it was left blank.',
    )
  })
})

describe('menuReadNoteText: the same file again', () => {
  it('says a copy of the current menu was kept, and the current menu stays', () => {
    expect(menuReadNoteText({ row: 0, reason: 'same_file', raw: 'active' })).toBe(
      'This file is the same one the current menu was read from. A second copy of that menu was kept; the house keeps its current menu until you choose another.',
    )
  })

  it('says a copy of a kept menu was kept', () => {
    expect(menuReadNoteText({ row: 0, reason: 'same_file', raw: 'draft' })).toBe(
      'This file is the same as a menu already kept. A second copy of that menu was kept.',
    )
  })

  it('says when whether it was read before could not be checked', () => {
    expect(menuReadNoteText({ row: 0, reason: 'same_file_unchecked', raw: 'timeout' })).toBe(
      'Whether this file was read before could not be checked, so it was read as new.',
    )
  })
})
