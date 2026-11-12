import { describe, expect, it } from 'vitest'
import { lineNeedsPencil, lineSourceCrop } from './firstProof'

describe('lineNeedsPencil', () => {
  it('keeps the unmatched fallback', () => {
    expect(lineNeedsPencil({ matched: false, needsReview: false, category: 'beer' })).toBe(true)
  })

  it('uses the extractor category when it already said unknown or nothing', () => {
    expect(lineNeedsPencil({ matched: true, needsReview: false, category: null })).toBe(true)
    expect(lineNeedsPencil({ matched: true, needsReview: false, category: 'unknown' })).toBe(true)
  })

  it('does not fake certainty on a matched line with a known category', () => {
    expect(lineNeedsPencil({ matched: true, needsReview: false, category: 'beer' })).toBe(false)
  })
})

describe('lineSourceCrop', () => {
  const image = 'data:image/png;base64,aaaa'
  const box = { x: 10, y: 20, width: 80, height: 24, page: 1 }

  it('stays empty when the extractor did not return a box', () => {
    expect(lineSourceCrop({}, image)).toBeNull()
    expect(lineSourceCrop({ bbox: null }, image)).toBeNull()
    expect(lineSourceCrop({ bbox: box }, null)).toBeNull()
  })

  it('uses a box only when the extractor already named one', () => {
    expect(lineSourceCrop({ bbox: box }, image)).toEqual({ image, box })
  })
})

describe('saveProofItems', () => {
  it('rewrites the stored items and leaves the page image alone', async () => {
    const { FIRST_PROOF_KEY, FIRST_PROOF_SOURCE_KEY, readProof, saveProofItems, writeProof } =
      await import('./firstProof')
    sessionStorage.clear()
    writeProof(
      { menuId: 'm1', itemsExtracted: 1, submissionsCreated: 0, items: [] },
      'data:image/png;base64,aaaa',
    )
    saveProofItems([{ menuItemId: 'a', name: 'Rioja', category: 'red' } as never])
    expect(JSON.parse(sessionStorage.getItem(FIRST_PROOF_KEY)!).items).toHaveLength(1)
    expect(sessionStorage.getItem(FIRST_PROOF_SOURCE_KEY)).toBe('data:image/png;base64,aaaa')
    expect(readProof()?.menuId).toBe('m1')
  })

  it('writes nothing when there is no proof', async () => {
    const { FIRST_PROOF_KEY, saveProofItems } = await import('./firstProof')
    sessionStorage.clear()
    saveProofItems([])
    expect(sessionStorage.getItem(FIRST_PROOF_KEY)).toBeNull()
  })
})
