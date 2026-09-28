/**
 * The name-only wine search on /vendors — founder, 2026-09-26, round 7, item 48
 * (ADR 0221): a search by a wine's NAME, with the menu rung not applied,
 * matches ANY vintage, and each vendor is labelled with the vintage(s) its
 * evidence names.
 *
 * Mirrors `apps/api-gateway/src/providers/vendor-wine-search.ts`, where the
 * rules live (the match, the evidence, the house scope, no silent cap).
 */

import { apiClient } from './client'

export interface WineQuery {
  text: string
  words: string[]
  vintages: number[]
}

/** One wine (one vintage) a house vendor has purchase evidence for. */
export interface WineSold {
  masterWineId: string
  producer: string | null
  name: string
  vintage: number | null
  priced: boolean
  ordered: boolean
  stocked: boolean
}

export interface OwnWineSeller {
  providerId: string
  wines: WineSold[]
}

export interface OwnWineSearch {
  query: WineQuery
  winesMatched: number
  sellers: OwnWineSeller[]
}

/** The strongest kind of price sighting: a sighting is not always a sale. */
export type SightingKind = 'invoiced' | 'quoted' | 'listed'

export interface WineListed {
  masterWineId: string | null
  producer: string | null
  name: string
  vintage: number | null
  vintageFromText: boolean
  kind: SightingKind
  lastSeen: string | null
}

export interface CatalogueWineLister {
  vendor: {
    id: string
    name: string
    type: string | null
    country: string | null
    state: string | null
    city: string | null
    wine_specialties: string | null
  }
  wines: WineListed[]
}

export interface CatalogueWineSearch {
  query: WineQuery
  country: string
  sightingsRead: number
  listers: CatalogueWineLister[]
}

export async function fetchOwnWineSellers(q: string): Promise<OwnWineSearch> {
  const params = new URLSearchParams({ q })
  const res = await apiClient.get<OwnWineSearch>(`/providers/wine-sellers?${params.toString()}`)
  return res.data
}

export async function fetchCatalogueWineListers(
  q: string,
  country: string,
): Promise<CatalogueWineSearch> {
  const params = new URLSearchParams({ q, country })
  const res = await apiClient.get<CatalogueWineSearch>(
    `/providers/catalogue-wine-listers?${params.toString()}`,
  )
  return res.data
}
