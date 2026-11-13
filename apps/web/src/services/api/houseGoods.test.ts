import { describe, expect, it, vi } from 'vitest'
import { carryThenPair, existingGoodId } from './houseGoods'

const body = { kind: 'food', uom: 'g', displayName: 'Ezine peyniri' }
const why = (e: unknown) => String((e as Error).message ?? e)

describe('carryThenPair (r21)', () => {
  it('carries the good and pairs the line with the new id', async () => {
    const add = vi.fn().mockResolvedValue({ id: 'new-1', kind: 'food', uom: 'g', displayName: 'Ezine peyniri' })
    const pair = vi.fn().mockResolvedValue(undefined)
    expect(await carryThenPair(body, add, pair, why)).toEqual({ refused: null, note: null })
    expect(add).toHaveBeenCalledWith(body)
    expect(pair).toHaveBeenCalledWith('new-1')
  })

  it('a 409 pairs with the good the house already carries, and says so', async () => {
    const add = vi.fn().mockRejectedValue({ response: { status: 409, data: { existingId: 'old-7' } } })
    const pair = vi.fn().mockResolvedValue(undefined)
    const out = await carryThenPair(body, add, pair, why)
    expect(pair).toHaveBeenCalledWith('old-7')
    expect(out).toEqual({ refused: null, note: 'This house already carries Ezine peyniri, so the line is paired with it.' })
  })

  it('any other refusal pairs nothing and says why', async () => {
    const add = vi.fn().mockRejectedValue(new Error('Stock is kept in whole small units'))
    const pair = vi.fn()
    const out = await carryThenPair(body, add, pair, why)
    expect(pair).not.toHaveBeenCalled()
    expect(out.refused).toBe('Ezine peyniri was not added, and the line is not paired: Stock is kept in whole small units')
  })

  it('a 409 with no id is a refusal, never a guess', () => {
    expect(existingGoodId({ response: { status: 409, data: {} } })).toBeNull()
    expect(existingGoodId({ response: { status: 400, data: { existingId: 'x' } } })).toBeNull()
  })
})
