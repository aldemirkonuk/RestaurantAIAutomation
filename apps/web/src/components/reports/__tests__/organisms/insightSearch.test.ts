/**
 * Guards the ⌘K palette's core promise: it selects sentences the analytics
 * engine produced and never composes one of its own.
 *
 * The regression being locked out: the palette used to answer free-text
 * questions from a hand-written `generateMockAnswer` switch that returned
 * confident, specific figures ("Tuesday's revenue was ~18% below weekly
 * average") computed from nothing.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { rankInsights, queryTokens } from '../../organisms/insightSearch'
import type { EngineInsight } from '../../../../hooks/useEngineInsights'

const insight = (
  sentence: string,
  category: string,
  score: number,
  entityLabel: string | null = null,
): EngineInsight => ({
  sentence,
  category,
  score,
  entityLabel,
  ruleKey: `insight:${category}:${score}`,
  effectPct: null,
  zScore: null,
  entityKey: null,
  pinned: false,
})

const FEED: EngineInsight[] = [
  insight('Tuesday wine revenue is 18% below the weekly average.', 'sales', 9),
  insight('Barolo reaches its reorder point in 6 days.', 'inventory', 7, 'Barolo'),
  insight('Prosecco carries the highest margin of any by-the-glass pour.', 'sales', 5, 'Prosecco'),
]

describe('queryTokens', () => {
  it('drops question scaffolding so a typed question still matches', () => {
    expect(queryTokens('Why did Tuesday revenue dip?')).toEqual(['tuesday', 'revenue', 'dip'])
  })

  it('drops words shorter than three characters', () => {
    expect(queryTokens('a vs my')).toEqual([])
  })
})

describe('rankInsights', () => {
  it('returns every insight, best score first, when the query is empty', () => {
    const out = rankInsights(FEED, '')
    expect(out.map((r) => r.insight.score)).toEqual([9, 7, 5])
  })

  it('ranks by how many query terms an insight matched', () => {
    const out = rankInsights(FEED, 'Why did Tuesday revenue dip?')
    expect(out[0].insight.sentence).toContain('Tuesday')
    expect(out[0].matched).toBe(2) // tuesday + revenue
  })

  it('matches on the entity label and the category, not just the sentence', () => {
    expect(rankInsights(FEED, 'barolo')).toHaveLength(1)
    expect(rankInsights(FEED, 'inventory')).toHaveLength(1)
  })

  it('returns nothing rather than a fallback when no insight matches', () => {
    expect(rankInsights(FEED, 'sancerre')).toEqual([])
  })

  it('never emits a sentence that was not in the input feed', () => {
    const allowed = new Set(FEED.map((i) => i.sentence))
    for (const query of ['', 'tuesday', 'margin', 'why did revenue drop', 'reorder barolo']) {
      for (const { insight: got } of rankInsights(FEED, query)) {
        expect(allowed.has(got.sentence)).toBe(true)
      }
    }
  })

  it('invents nothing when the feed is empty', () => {
    expect(rankInsights([], 'why did tuesday revenue dip')).toEqual([])
  })
})

describe('AICommandPalette source', () => {
  // `import.meta.url` is not a file: URL under the vite/jsdom runner, so resolve
  // from cwd instead — which is apps/web whether vitest is invoked there or via
  // the workspace script.
  const REL = 'src/components/reports/organisms/AICommandPalette.tsx'
  const path = [REL, `apps/web/${REL}`]
    .map((p) => resolve(process.cwd(), p))
    .find(existsSync)
  const source = path ? readFileSync(path, 'utf8') : ''

  it('found the component to inspect', () => {
    expect(source).not.toBe('')
  })

  it('has no mock answer generator', () => {
    expect(source).not.toMatch(/function generateMockAnswer/)
  })

  it('reaches the gateway through the shared hook, never raw fetch', () => {
    // A raw `fetch` sends no bearer token, and every /analytics route is behind
    // JwtAuthGuard — it 401s into a silently empty panel.
    expect(source).toMatch(/useEngineInsights/)
    expect(source).not.toMatch(/\bfetch\(/)
  })
})
