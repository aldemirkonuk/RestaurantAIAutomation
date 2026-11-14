import { describe, expect, it } from 'vitest'
import { menuKept, moneySetIn } from './menuKept'

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

// r41 onboarding gap 8: /house takes the money from the setup read only
// when it is a real yes or no.
describe('moneySetIn', () => {
  it('answers only a boolean money_set', () => {
    expect(moneySetIn({ next_steps: { money_set: true } })).toBe(true)
    expect(moneySetIn({ next_steps: { money_set: false } })).toBe(false)
  })
  it('anything else is not an answer', () => {
    for (const progress of [null, undefined, {}, { next_steps: null }, { next_steps: {} }, { next_steps: { money_set: null } }, { next_steps: { money_set: 'TRY' } }, { next_steps: { money_set: 0 } }]) {
      expect(moneySetIn(progress)).toBeNull()
    }
  })
})
