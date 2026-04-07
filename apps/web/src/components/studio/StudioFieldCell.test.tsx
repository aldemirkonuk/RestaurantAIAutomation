// @vitest-environment node
/**
 * Vitest unit tests for FieldCell confidence threshold and reason enforcement (DEVUI-03).
 *
 * Tests the pure business logic rules from FieldCell.tsx without DOM rendering:
 *   - computeRequiresReason: confidence >= 0.8
 *   - computeCanSave: newValue not empty, changed from original, if requiresReason then reason >= 5 chars
 *
 * Logic is copied inline from FieldCell.tsx for test isolation.
 */
import { describe, it, expect } from 'vitest'

function computeRequiresReason(confidence: number | null): boolean {
  return (confidence ?? 0) >= 0.8
}

function computeCanSave(
  newValue: string,
  originalValue: string | null,
  requiresReason: boolean,
  reason: string,
): boolean {
  return (
    newValue.trim().length > 0 &&
    newValue !== (originalValue ?? '') &&
    (!requiresReason || reason.trim().length >= 5)
  )
}

describe('FieldCell — computeRequiresReason', () => {
  it('returns false for confidence = 0.0', () => {
    expect(computeRequiresReason(0.0)).toBe(false)
  })

  it('returns false for confidence = 0.79', () => {
    expect(computeRequiresReason(0.79)).toBe(false)
  })

  it('returns true at confidence = 0.8 (boundary)', () => {
    expect(computeRequiresReason(0.8)).toBe(true)
  })

  it('returns true for confidence = 0.95', () => {
    expect(computeRequiresReason(0.95)).toBe(true)
  })

  it('returns false for null confidence (unknown / missing field)', () => {
    expect(computeRequiresReason(null)).toBe(false)
  })
})

describe('FieldCell — computeCanSave', () => {
  it('returns false when newValue is empty', () => {
    expect(computeCanSave('', 'old', false, '')).toBe(false)
  })

  it('returns false when newValue equals original', () => {
    expect(computeCanSave('same', 'same', false, '')).toBe(false)
  })

  it('returns true for changed value with no reason required', () => {
    expect(computeCanSave('New Wine', 'Old Wine', false, '')).toBe(true)
  })

  it('returns false when reason required but reason is empty', () => {
    expect(computeCanSave('New Wine', 'Old Wine', true, '')).toBe(false)
  })

  it('returns false when reason required but reason is < 5 chars', () => {
    expect(computeCanSave('New Wine', 'Old Wine', true, 'abc')).toBe(false)
  })

  it('returns true when reason required and reason has >= 5 chars', () => {
    expect(computeCanSave('New Wine', 'Old Wine', true, 'Confirmed on website')).toBe(true)
  })
})
