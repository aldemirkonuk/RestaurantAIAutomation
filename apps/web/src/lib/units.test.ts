import { describe, it, expect } from 'vitest'
import { COUNT_UOMS, INTAKE_STEP, isMeasuredUnit, MEASURED_UOMS, UOMS } from './units'

describe('the client unit vocabulary (ADR 0071)', () => {
  it('can express a mass, which is the defect it was added for', () => {
    // Before ADR 0071 the vocabulary was beverage-only, so a 25 kg sack of
    // flour had no unit any screen could offer.
    expect(UOMS).toContain('kg')
    expect(UOMS).toContain('g')
  })

  it('splits every unit into exactly one of counted or measured', () => {
    const overlap = COUNT_UOMS.filter((u) => (MEASURED_UOMS as readonly string[]).includes(u))
    expect(overlap).toEqual([])
    expect(UOMS.length).toBe(COUNT_UOMS.length + MEASURED_UOMS.length)
  })

  it('admits fractions only for units that measure', () => {
    for (const u of MEASURED_UOMS) expect(isMeasuredUnit(u)).toBe(true)
    for (const u of COUNT_UOMS) expect(isMeasuredUnit(u)).toBe(false)
  })

  it('treats absent, empty and unknown units as NOT measured', () => {
    // The conservative direction: keep the stricter whole-number rule until a
    // unit is actually chosen, rather than opening the field up on a typo.
    expect(isMeasuredUnit(undefined)).toBe(false)
    expect(isMeasuredUnit(null)).toBe(false)
    expect(isMeasuredUnit('')).toBe(false)
    expect(isMeasuredUnit('bxs')).toBe(false)
  })

  it('is forgiving about spacing and case, which is how a unit arrives from a select', () => {
    expect(isMeasuredUnit(' KG ')).toBe(true)
    expect(isMeasuredUnit('Kg')).toBe(true)
  })

  it('steps at the quantity column’s real precision, not at 1', () => {
    // The bug: with no `step`, HTML defaults to 1 and the browser reports a
    // stepMismatch on 2.5 -- the value never leaves the page, below every
    // validator, with only a generic tooltip to explain it.
    expect(INTAKE_STEP).toBe(0.001)
    // 4.5 must be an exact multiple of the step, or the browser refuses it.
    expect(Math.round(4.5 / INTAKE_STEP) * INTAKE_STEP).toBeCloseTo(4.5, 10)
  })
})
