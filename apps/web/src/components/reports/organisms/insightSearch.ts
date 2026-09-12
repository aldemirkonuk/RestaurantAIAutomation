/**
 * Ranking for the ⌘K insight palette.
 *
 * Deliberately dumb: it *selects* among sentences the analytics engine already
 * produced and never composes one. Keeping it here (pure, no React) makes that
 * property testable — see insightSearch.test.ts.
 */

import type { EngineInsight } from '../../../hooks/useEngineInsights'

/**
 * Question scaffolding carries no signal. Dropping it is what lets a typed
 * question like "why did tuesday revenue dip?" match on `tuesday` + `revenue`
 * instead of failing on `why`/`did`.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at',
  'for', 'from', 'with', 'about', 'into', 'over', 'than', 'then', 'that',
  'this', 'these', 'those', 'it', 'its', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'do', 'does', 'did', 'doing', 'have', 'has', 'had', 'can',
  'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must',
  'what', 'why', 'how', 'when', 'where', 'which', 'who', 'whom', 'whose',
  'my', 'me', 'i', 'we', 'us', 'our', 'you', 'your', 'they', 'them', 'their',
  'show', 'tell', 'give', 'get', 'find', 'see', 'look', 'want', 'need',
  'any', 'all', 'some', 'much', 'many', 'more', 'most', 'less', 'least',
  'vs', 'versus', 'compare', 'comparison', 'please',
])

/** Words worth matching on: 3+ chars, not scaffolding. */
export function queryTokens(query: string): string[] {
  const seen = new Set<string>()
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue
    seen.add(raw)
  }
  return Array.from(seen)
}

export interface RankedInsight {
  insight: EngineInsight
  /** How many distinct query tokens this insight matched. 0 when browsing. */
  matched: number
}

function haystack(insight: EngineInsight): string {
  return `${insight.sentence} ${insight.category} ${insight.entityLabel ?? ''}`.toLowerCase()
}

/**
 * With no usable tokens this is a browse (everything, best-scoring first).
 * With tokens it is a filter: insights matching at least one token, ordered by
 * how many they matched and then by the engine's own score.
 */
export function rankInsights(
  insights: EngineInsight[],
  query: string,
): RankedInsight[] {
  const tokens = queryTokens(query)

  if (tokens.length === 0) {
    return [...insights]
      .sort((a, b) => b.score - a.score)
      .map((insight) => ({ insight, matched: 0 }))
  }

  return insights
    .map((insight) => {
      const hay = haystack(insight)
      const matched = tokens.filter((t) => hay.includes(t)).length
      return { insight, matched }
    })
    .filter((r) => r.matched > 0)
    .sort((a, b) =>
      b.matched !== a.matched
        ? b.matched - a.matched
        : b.insight.score - a.insight.score,
    )
}
