import { describe, expect, it } from 'vitest'
import { menuReadNoteText } from './MenuReadNotes'

/** r110 menu-r110-5: a sheet's notes are in neutral words, never "wine" only, and a dropped column is said. */
describe('menuReadNoteText -- a kitchen sheet', () => {
  it('names a dish column among the name words', () => {
    const said = menuReadNoteText({ row: 1, reason: 'no_name_column' })
    expect(said).toMatch(/Dish/)
    expect(said).toMatch(/Yemek/)
  })
  it('says a column was not read, by its header', () => {
    expect(menuReadNoteText({ row: 1, reason: 'column_not_read', raw: 'Allergens' })).toBe(
      'The column "Allergens" was not read, so what it holds is not on this menu.',
    )
  })
})
