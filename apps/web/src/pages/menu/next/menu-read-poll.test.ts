import { describe, expect, it } from 'vitest'
import { versionsPollMs } from './menu-read-poll'

const NOW = Date.parse('2026-11-17T12:00:00Z')
const ago = (s: number) => new Date(NOW - s * 1000).toISOString()
const v = (readState: 'reading' | 'done' | 'failed' | undefined, createdAt: string | null) => ({ readState, createdAt })

describe('versionsPollMs: the Menus kept list looks again less often the longer a read goes on', () => {
  it('does not look again when no menu is being read, or there is no list yet', () => {
    expect(versionsPollMs(undefined, NOW)).toBe(false)
    expect(versionsPollMs([], NOW)).toBe(false)
    expect(versionsPollMs([v('done', ago(5)), v('failed', ago(5)), v(undefined, ago(5))], NOW)).toBe(false)
  })

  it('looks every 5 s in the first minute of a read', () => {
    expect(versionsPollMs([v('reading', ago(2))], NOW)).toBe(5000)
    expect(versionsPollMs([v('reading', ago(59))], NOW)).toBe(5000)
  })

  it('looks every 15 s from the first minute, and every 30 s from the fifth', () => {
    expect(versionsPollMs([v('reading', ago(60))], NOW)).toBe(15000)
    expect(versionsPollMs([v('reading', ago(299))], NOW)).toBe(15000)
    expect(versionsPollMs([v('reading', ago(300))], NOW)).toBe(30000)
    expect(versionsPollMs([v('reading', ago(25 * 60))], NOW)).toBe(30000)
  })

  it('goes by the newest read that is still going, so a fresh read is not left waiting behind an old stuck one', () => {
    expect(versionsPollMs([v('reading', ago(20 * 60)), v('reading', ago(3))], NOW)).toBe(5000)
  })

  it('does not hurry when a read has no start time or a start in the future', () => {
    expect(versionsPollMs([v('reading', null)], NOW)).toBe(30000)
    expect(versionsPollMs([v('reading', 'not a date')], NOW)).toBe(30000)
    expect(versionsPollMs([v('reading', ago(-30))], NOW)).toBe(5000)
  })
})
