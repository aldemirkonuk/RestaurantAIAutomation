import { describe, expect, it } from 'vitest'
import { menuKept } from './menuKept'

describe('menuKept: where the house menu stands, never guessed', () => {
  it('reads current, draft, read (no current fact) and none', () => {
    expect(menuKept({ menu_uploaded: true, menu_current: true })).toBe('current')
    expect(menuKept({ menu_uploaded: true, menu_current: false })).toBe('draft')
    expect(menuKept({ menu_uploaded: true })).toBe('read')
    expect(menuKept({ menu_uploaded: true, menu_current: null })).toBe('read')
    expect(menuKept({ menu_uploaded: false, menu_current: false })).toBe('none')
    expect(menuKept(null)).toBe('none')
    expect(menuKept(undefined)).toBe('none')
  })

  it('a current menu is current even where the read flag lags', () => {
    expect(menuKept({ menu_uploaded: false, menu_current: true })).toBe('current')
  })
})
