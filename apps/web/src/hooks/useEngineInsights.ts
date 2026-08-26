/**
 * Shared fetch for analytics engine insights (+ disposition merge).
 * Used by HeadlineInsightsBar; EngineInsightsPanel / ContextualInsights can migrate later.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { apiClient, getErrorMessage } from '../services/api/client'

export interface EngineInsight {
  ruleKey: string
  sentence: string
  category: string
  score: number
  effectPct: number | null
  zScore: number | null
  entityKey: string | null
  entityLabel: string | null
  pinned: boolean
}

export type InsightTone = 'up' | 'down' | 'warn' | 'flat'

export const CATEGORY_LABEL: Record<string, string> = {
  sales: 'Sales',
  purchasing: 'Buying',
  inventory: 'Stock',
  efficiency: 'Efficiency',
  tables: 'Tables',
  staff: 'Team',
  basket: 'Pairings',
  risk: 'Watch out',
  forecast: 'Coming up',
  goals: 'Goals',
}

export function toneOf(insight: EngineInsight): InsightTone {
  if (insight.category === 'risk') return 'warn'
  if (insight.effectPct != null) {
    if (insight.effectPct >= 0.05) return 'up'
    if (insight.effectPct <= -0.05) return 'down'
  }
  return 'flat'
}

export function toneWord(tone: InsightTone): string {
  switch (tone) {
    case 'up':
      return 'Up'
    case 'down':
      return 'Down'
    case 'warn':
      return 'Watch'
    default:
      return 'Steady'
  }
}

export function buildInsightRuleKey(candidateKey: string, entityKey?: string | null): string {
  return `insight:${candidateKey}${entityKey ? `:${entityKey}` : ''}`
}

interface CacheEntry {
  insights: EngineInsight[]
  hasData: boolean | null
  at: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 30_000

function mapRows(rows: any[], pinnedSet: Set<string>, hidden: Set<string>): EngineInsight[] {
  return rows
    .map((r) => {
      const candidateKey = r.candidate_key ?? r.candidateKey ?? ''
      const eKey = r.entity_key ?? r.entityKey ?? ''
      const ruleKey = buildInsightRuleKey(candidateKey, eKey || null)
      return {
        sentence: String(r.sentence ?? ''),
        category: String(r.category ?? 'sales'),
        score: Number(r.score ?? 0),
        ruleKey,
        effectPct: r.effect_pct ?? r.effectPct ?? null,
        zScore: r.z_score ?? r.z ?? null,
        entityKey: eKey || null,
        entityLabel: r.entity_label ?? r.entityLabel ?? null,
        pinned: pinnedSet.has(ruleKey),
      } satisfies EngineInsight
    })
    .filter((r) => r.sentence && !hidden.has(r.ruleKey))
    .sort((a, b) =>
      a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.score - a.score,
    )
}

export function useEngineInsights(opts?: { categories?: string[]; limit?: number }) {
  const { user } = useAuth()
  const restaurantId = user?.restaurantId
  const limit = opts?.limit ?? 12
  const categoriesKey = opts?.categories?.join(',') ?? ''

  const [insights, setInsights] = useState<EngineInsight[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasData, setHasData] = useState<boolean | null>(null)
  const mounted = useRef(true)

  const cacheKey = `${restaurantId ?? ''}|${categoriesKey}|${limit}`

  const refresh = useCallback(
    async (recompute = false) => {
      if (!restaurantId) {
        setLoading(false)
        setInsights([])
        setHasData(null)
        return
      }

      if (!recompute) {
        const hit = cache.get(cacheKey)
        if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
          setInsights(hit.insights)
          setHasData(hit.hasData)
          setLoading(false)
          setError(null)
          return
        }
      }

      setLoading(true)
      setError(null)
      try {
        const base = '/analytics'
        const qs = new URLSearchParams()
        if (recompute) qs.set('refresh', 'true')
        else qs.set('limit', String(limit))
        if (categoriesKey) qs.set('categories', categoriesKey)

        // allSettled, not all: the disposition call failing must not blank the
        // insight list (fetch never rejected on 4xx — axios does).
        const [insRes, dispRes] = await Promise.allSettled([
          apiClient.get<any>(`${base}/insights/${restaurantId}?${qs.toString()}`),
          apiClient.get<any>(
            `${base}/recommendations/${restaurantId}/actions?status=all`,
          ),
        ])

        const hidden = new Set<string>()
        const pinnedSet = new Set<string>()
        if (dispRes.status === 'fulfilled') {
          const now = Date.now()
          const items: any[] = dispRes.value.data?.items ?? []
          for (const it of items) {
            if (!String(it.ruleKey ?? '').startsWith('insight:')) continue
            if (it.pinned) pinnedSet.add(it.ruleKey)
            const snoozedActive =
              it.status === 'snoozed' &&
              it.snoozeUntil &&
              new Date(it.snoozeUntil).getTime() > now
            if (it.status === 'dismissed' || it.status === 'done' || snoozedActive) {
              hidden.add(it.ruleKey)
            }
          }
        }

        if (insRes.status === 'rejected') throw insRes.reason
        const body = insRes.value.data ?? {}
        const rows: any[] = body.insights ?? []
        const mapped = mapRows(rows, pinnedSet, hidden)
        const nextHasData = Array.isArray(body.availability)
          ? body.availability.length > 0
          : rows.length > 0 || body.source === 'stored'

        cache.set(cacheKey, { insights: mapped, hasData: nextHasData, at: Date.now() })
        if (!mounted.current) return
        setInsights(mapped)
        setHasData(nextHasData)
      } catch (e) {
        if (!mounted.current) return
        setError(getErrorMessage(e))
        setInsights([])
      } finally {
        if (mounted.current) setLoading(false)
      }
    },
    [restaurantId, cacheKey, categoriesKey, limit],
  )

  useEffect(() => {
    mounted.current = true
    void refresh(false)
    return () => {
      mounted.current = false
    }
  }, [refresh])

  return {
    insights,
    loading,
    error,
    hasData,
    refresh,
  }
}
