import { describe, expect, it } from 'vitest'
import { doorAgeSaid } from './door-age'

describe('doorAgeSaid', () => {
  it('says hours up to two days', () => {
    expect(doorAgeSaid(5, 'fresh')).toBe('5h ago')
    expect(doorAgeSaid(47.4, 'stale')).toBe('47h ago')
  })
  it('says whole days after two days, never thousands of hours', () => {
    expect(doorAgeSaid(60, 'stale')).toBe('2 days ago')
    expect(doorAgeSaid(7199, 'overdue')).toBe('299 days ago, overdue')
  })
  it('marks an overdue count even while it is young', () => {
    expect(doorAgeSaid(30, 'overdue')).toBe('30h ago, overdue')
  })
})
