import { useCallback, useEffect, useMemo, useState } from 'react'
import { matchVendorCatalogue, type VendorMatchCandidate } from '../services/api/vendors'
import {
  matchRestaurantProviders,
  type ProviderMatchCandidate,
} from '../services/api/providers'

/**
 * Duplicate detection shared by the add-provider and edit-provider forms.
 *
 * Two distinct ways a restaurant ends up with the same supplier twice, and
 * both are checked here because either alone leaves a real hole:
 *
 *   catalogue — the vendor is already a verified entry in the shared
 *               catalogue, so a hand-typed copy is a private, unverified
 *               duplicate of vetted data. (This is how Breakthru Beverage
 *               Group got added twice.)
 *   provider  — the restaurant already has this supplier in its OWN list,
 *               under a slightly different name. No catalogue row is
 *               involved, so the catalogue check never fires.
 *
 * Lives in one hook rather than being written twice because the add and edit
 * screens must agree on what counts as a duplicate. Two copies of this logic
 * would drift, and "the add screen warned but the edit screen didn't" is
 * worse than either screen missing a match.
 */

/**
 * Below this similarity a match is retrieval-quality — worth returning from
 * the API so nothing plausible is silently dropped — but not confident enough
 * to interrupt someone mid-form. The server's own threshold (0.35) is
 * deliberately looser for that reason.
 */
export const MATCH_CONFIDENCE_THRESHOLD = 0.45

export type DuplicateMatch =
  | { kind: 'catalogue'; id: string; confidence: number; vendor: VendorMatchCandidate }
  | { kind: 'provider'; id: string; confidence: number; provider: ProviderMatchCandidate }

export interface UseDuplicateVendorCheckOptions {
  /** Skip all work when the form is closed. */
  enabled: boolean
  name: string
  address?: string
  /**
   * The provider being edited. Excluded from the own-providers search (it
   * would match itself at 1.0) — omit entirely when adding.
   */
  excludeProviderId?: string
  /**
   * Set when the record already points at a catalogue entry. Such a provider
   * legitimately shares the catalogue vendor's exact name, so the catalogue
   * half of the check is skipped — otherwise merely opening and saving a
   * vendor added from the catalogue would report a 100% "duplicate" of the
   * row it is already linked to.
   */
  linkedCatalogueVendorId?: string | null
}

function confidenceOf(m: { name_similarity: number; address_similarity: number | null }) {
  return Math.max(m.name_similarity, m.address_similarity ?? 0)
}

export function useDuplicateVendorCheck({
  enabled,
  name,
  address,
  excludeProviderId,
  linkedCatalogueVendorId,
}: UseDuplicateVendorCheckOptions) {
  const [catalogueMatches, setCatalogueMatches] = useState<VendorMatchCandidate[]>([])
  const [providerMatches, setProviderMatches] = useState<ProviderMatchCandidate[]>([])
  /** Ids the user has explicitly said "not this one" to. */
  const [acknowledged, setAcknowledged] = useState<string[]>([])

  const trimmedName = name.trim()
  const trimmedAddress = (address ?? '').trim()

  useEffect(() => {
    if (!enabled) return
    // A few characters of a name (or any address) before asking, so this does
    // not fire on "B" and return noise.
    if (trimmedName.length < 4 && !trimmedAddress) {
      setCatalogueMatches([])
      setProviderMatches([])
      return
    }

    let cancelled = false
    const t = setTimeout(() => {
      const wantCatalogue = !linkedCatalogueVendorId
      Promise.all([
        wantCatalogue
          ? matchVendorCatalogue(trimmedName, trimmedAddress || undefined, 'US')
          : Promise.resolve([] as VendorMatchCandidate[]),
        matchRestaurantProviders(trimmedName, trimmedAddress || undefined, excludeProviderId),
      ]).then(([cat, prov]) => {
        if (cancelled) return
        setCatalogueMatches(cat)
        setProviderMatches(prov)
      })
    }, 450)

    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [enabled, trimmedName, trimmedAddress, excludeProviderId, linkedCatalogueVendorId])

  /**
   * The single match worth interrupting for.
   *
   * An existing own-provider outranks a catalogue entry when both clear the
   * bar: "you already have this supplier" is more actionable than "this
   * exists in our catalogue", because the former means a row is about to be
   * duplicated in the list the operator actually works from.
   */
  const match = useMemo<DuplicateMatch | null>(() => {
    const provider = providerMatches[0]
    if (provider && confidenceOf(provider) >= MATCH_CONFIDENCE_THRESHOLD) {
      return {
        kind: 'provider',
        id: provider.id,
        confidence: confidenceOf(provider),
        provider,
      }
    }
    const vendor = catalogueMatches[0]
    if (vendor && confidenceOf(vendor) >= MATCH_CONFIDENCE_THRESHOLD) {
      return { kind: 'catalogue', id: vendor.id, confidence: confidenceOf(vendor), vendor }
    }
    return null
  }, [catalogueMatches, providerMatches])

  /** The match, unless the user already dismissed this exact one. */
  const pendingMatch = match && !acknowledged.includes(match.id) ? match : null

  const acknowledge = useCallback((id: string) => {
    setAcknowledged((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [])

  const reset = useCallback(() => {
    setCatalogueMatches([])
    setProviderMatches([])
    setAcknowledged([])
  }, [])

  return { match, pendingMatch, acknowledge, reset }
}
