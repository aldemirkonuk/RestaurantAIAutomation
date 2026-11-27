/**
 * r28 onboarding gaps 6 and 8: the first proof says what it holds, and a
 * browser that refuses storage never turns a kept menu into a failed read.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuImportResult, MenuImportReviewItem } from '../services/api/menus'
import { FIRST_PROOF_KEY, FIRST_PROOF_SOURCE_KEY, proofStanding, readProof, writeProof } from './firstProof'

const line = (over: Partial<MenuImportReviewItem>) =>
  ({ menuItemId: 'x', name: 'x', category: 'red', matched: true, needsReview: false, ...over }) as MenuImportReviewItem
const result = (items: MenuImportReviewItem[], menuId = 'm-new') =>
  ({ menuId, itemsExtracted: items.length, submissionsCreated: 0, items }) as MenuImportResult

describe('proofStanding (gap 6)', () => {
  it('a proof of only dishes is dishes, never "in ink"', () => {
    expect(
      proofStanding([line({ name: 'Tiramisu', category: 'food' }), line({ name: 'Mezze', category: 'food', matched: false })]),
    ).toEqual({ kind: 'dishes-only', dishes: 2 })
  })

  it('a proof with no lines is empty', () => {
    expect(proofStanding([])).toEqual({ kind: 'empty' })
  })

  it('a proof whose drinks are all certain is in ink, whatever dishes sit beside them', () => {
    expect(proofStanding([line({ name: 'Rioja' }), line({ name: 'Tiramisu', category: 'food', matched: false })])).toEqual({
      kind: 'ink',
    })
  })

  it('counts only the drinks in pencil', () => {
    expect(
      proofStanding([
        line({ name: 'Rioja' }),
        line({ name: 'Yakut', category: null, matched: false, needsReview: true }),
        line({ name: 'Baklava', category: 'food', matched: false }),
      ]),
    ).toEqual({ kind: 'pencil', lines: 1 })
  })
})

describe('writeProof (gap 8)', () => {
  beforeEach(() => sessionStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('keeps the proof and says so', () => {
    expect(writeProof(result([line({ name: 'Rioja' })]), 'data:image/png;base64,aa')).toBe(true)
    expect(readProof()?.menuId).toBe('m-new')
    expect(sessionStorage.getItem(FIRST_PROOF_SOURCE_KEY)).toBe('data:image/png;base64,aa')
  })

  it('never throws when the browser refuses storage, and leaves no earlier menu’s proof behind', () => {
    writeProof(result([line({ name: 'Old' })], 'm-old'), 'data:image/png;base64,old')
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === FIRST_PROOF_KEY) throw new DOMException('quota', 'QuotaExceededError')
      return real.call(this, key, value)
    })
    let kept: boolean | undefined
    expect(() => {
      kept = writeProof(result([line({ name: 'New' })]), 'data:image/png;base64,new')
    }).not.toThrow()
    expect(kept).toBe(false)
    expect(readProof()).toBeNull()
    expect(sessionStorage.getItem(FIRST_PROOF_SOURCE_KEY)).toBeNull()
  })

  it('never throws when storage cannot be reached at all', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(writeProof(result([line({ name: 'New' })]))).toBe(false)
  })

  it('keeps the proof when only the page image is refused', () => {
    const real = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === FIRST_PROOF_SOURCE_KEY) throw new DOMException('quota', 'QuotaExceededError')
      return real.call(this, key, value)
    })
    expect(writeProof(result([line({ name: 'Rioja' })]), 'data:image/png;base64,big')).toBe(true)
    expect(readProof()?.menuId).toBe('m-new')
  })
})
