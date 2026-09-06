/**
 * useStorageLocations Hook
 *
 * API-primary storage locations and wine-to-location mappings.
 *
 * ADR 0051 — a rebuilt surface shows live data or says it does not know.
 * There are THREE distinct answers to "what zones does this tenant have?" and
 * this hook keeps them apart:
 *
 *   loading      the query has not answered yet          → `locationsLoading`
 *   ready, empty the tenant has created no zones          → `locations === []`
 *   unavailable  the fetch failed; we do not know          → `locationsUnavailable`
 *
 * Until 2026-09-02 all three rendered as the same four confident zones
 * (Main Cellar / Bar Stock / Overflow Storage / VIP Reserve) with invented
 * capacities and temperatures — and because the queryFn *returned* them, a
 * companion effect POSTed them into the tenant's own `storage_locations`
 * table. 84 such rows across 6 tenants were measured in production. The fiction
 * is gone; so is the effect that wrote it down.
 */

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../services/api/client'
import { useAuth } from '../contexts/AuthContext'

export interface StorageLocation {
  id: string
  name: string
  description?: string
  /**
   * Bottles this zone holds, as recorded by whoever created it.
   * `null` means nobody entered one — NOT 100, and not zero. It is the
   * denominator of the cellar map's fill bar, so a default here is a
   * fabricated percentage. Render `—` and draw no bar.
   */
  capacity: number | null
  currentCount: number
  temperature?: string
  humidity?: string
  notes?: string
  parentId?: string
  color: string
}

interface WineLocationMapping {
  wineId: string
  locationId: string
  quantity: number
  assignedAt: string
}

/** A capacity is a number the tenant recorded, or it is unknown. */
function capacityOf(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function mapServerLocation(loc: any): StorageLocation {
  return {
    id: loc.id,
    name: loc.name,
    description: loc.description || '',
    capacity: capacityOf(loc.capacity),
    currentCount: loc.current_count ?? loc.currentCount ?? 0,
    temperature: loc.temperature || '',
    humidity: loc.humidity || '',
    notes: loc.notes || '',
    parentId: loc.parent_id || loc.parentId || undefined,
    color: loc.color || '#6b7280',
  }
}

const LOCATIONS_KEY = 'storageLocations'
const MAPPINGS_KEY = 'storageLocationMappings'
const WINES_AT_LOCATION_KEY = 'winesAtLocation'

// Module-level constants so an unanswered query does not hand callers a fresh
// array identity on every render.
const EMPTY_LOCATIONS: StorageLocation[] = []
const EMPTY_MAPPINGS: WineLocationMapping[] = []

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function useStorageLocations() {
  const { activeRestaurantId, isAuthenticated } = useAuth()
  const queryClient = useQueryClient()
  const restaurantId = activeRestaurantId ?? ''

  const locationsQuery = useQuery<StorageLocation[]>({
    queryKey: [LOCATIONS_KEY, restaurantId],
    queryFn: async () => {
      const { data } = await apiClient.get(
        `/storage-locations/${restaurantId}`,
      )
      // An empty array is an ANSWER: this tenant has created no zones. It is
      // not an invitation to supply four.
      if (!Array.isArray(data)) {
        throw new Error('storage-locations did not return a list')
      }
      return data.map(mapServerLocation)
    },
    enabled: !!restaurantId && isAuthenticated,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    // No placeholderData, deliberately. Placeholder rows enter the tree in the
    // same shape as measured rows and nothing downstream can tell them apart —
    // the same defect as the seed, with a shorter life. The honest placeholder
    // for "not answered yet" is react-query's own pending state, which the
    // renderers below read as `locationsLoading`.
    retry: 1,
  })

  const mappingsQuery = useQuery<WineLocationMapping[]>({
    queryKey: [MAPPINGS_KEY, restaurantId],
    queryFn: async () => {
      const { data } = await apiClient.get(
        `/storage-locations/${restaurantId}/mappings`,
      )
      return Array.isArray(data) ? data : []
    },
    enabled: !!restaurantId && isAuthenticated,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  })

  // Unknown is not empty. `locations` is [] while loading and [] on failure so
  // callers keep a stable array type, and the two flags below are how a caller
  // tells those apart from a tenant that genuinely has no zones. Any surface
  // that renders `locations` MUST branch on them first.
  const locations = locationsQuery.data ?? EMPTY_LOCATIONS
  const mappings = mappingsQuery.data ?? EMPTY_MAPPINGS
  const locationsUnavailable = locationsQuery.isError && locationsQuery.data === undefined
  const mappingsUnavailable = mappingsQuery.isError && mappingsQuery.data === undefined

  const setLocations = useCallback(
    (updater: StorageLocation[] | ((prev: StorageLocation[]) => StorageLocation[])) => {
      queryClient.setQueryData<StorageLocation[]>(
        [LOCATIONS_KEY, restaurantId],
        (old) => {
          const prev = old ?? EMPTY_LOCATIONS
          return typeof updater === 'function' ? updater(prev) : updater
        },
      )
    },
    [queryClient, restaurantId],
  )

  const setMappings = useCallback(
    (updater: WineLocationMapping[] | ((prev: WineLocationMapping[]) => WineLocationMapping[])) => {
      queryClient.setQueryData<WineLocationMapping[]>(
        [MAPPINGS_KEY, restaurantId],
        (old) => {
          const prev = old ?? []
          return typeof updater === 'function' ? updater(prev) : updater
        },
      )
    },
    [queryClient, restaurantId],
  )

  const persistToServer = useCallback(
    async (method: string, path: string, body?: any) => {
      if (!restaurantId) return
      try {
        await apiClient.request({
          method,
          url: path,
          data: body,
        })
      } catch {
        // Server unavailable - optimistic state is already in React Query cache
      }
    },
    [restaurantId],
  )

  const getWineLocation = useCallback(
    (wineId: string): StorageLocation | null => {
      const mapping = mappings.find((m) => m.wineId === wineId)
      if (!mapping) return null
      return locations.find((l) => l.id === mapping.locationId) || null
    },
    [mappings, locations],
  )

  const getWinesInLocation = useCallback(
    (locationId: string): WineLocationMapping[] => {
      return mappings.filter((m) => m.locationId === locationId)
    },
    [mappings],
  )

  const assignWineToLocation = useCallback(
    (wineId: string, locationId: string, quantity: number = 1) => {
      // Read the current mapping from cache BEFORE mutating, so the location-count
      // adjustment is a separate top-level update instead of a side effect nested
      // inside the setMappings updater — that nesting made counts lag by one
      // interaction (the "click twice to see it update" bug).
      const existing = mappings.find((m) => m.wineId === wineId)
      const oldLocationId = existing?.locationId

      setMappings((prev) => {
        const found = prev.find((m) => m.wineId === wineId)
        if (found) {
          return prev.map((m) =>
            m.wineId === wineId
              ? { ...m, locationId, quantity, assignedAt: new Date().toISOString() }
              : m,
          )
        }
        return [
          ...prev,
          { wineId, locationId, quantity, assignedAt: new Date().toISOString() },
        ]
      })

      setLocations((locs) =>
        locs.map((loc) => {
          if (loc.id === locationId) {
            return { ...loc, currentCount: loc.currentCount + quantity }
          }
          if (oldLocationId && loc.id === oldLocationId && existing) {
            return {
              ...loc,
              currentCount: Math.max(0, loc.currentCount - existing.quantity),
            }
          }
          return loc
        }),
      )

      // Only hit the server when locationId is a real UUID (not a temp/default ID)
      if (UUID_RE.test(locationId)) {
        persistToServer('POST', `/storage-locations/${restaurantId}/mappings`, {
          wineId,
          locationId,
          quantity,
        })
      }
      queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })
    },
    [mappings, setMappings, setLocations, persistToServer, restaurantId, queryClient],
  )

  /**
   * Assign many wines, and report what actually landed.
   *
   * `assignWineToLocation` above is fire-and-forget by design: it updates the
   * cache and hands the POST to `persistToServer`, which swallows every failure
   * ("optimistic state is already in React Query cache"). That is defensible
   * for a single drag in the zone manager, where the operator is looking at the
   * thing they moved. It is NOT defensible for a batch: the auto-locate preview
   * fired fourteen of them, awaited none, and then said "14 wines assigned to
   * locations" — a sentence that was true about the cache and possibly false
   * about the database. An absence reported as health, on a write path.
   *
   * This is the awaited form. It writes the same rows through the same route,
   * one at a time so a single rejection cannot hide behind a `Promise.all`, and
   * returns the failures with the server's own words. The optimistic cache
   * update still happens first, so the list moves under the operator's hand;
   * the difference is that the caller can now say which ones did not land.
   *
   * A zone id that is not a UUID never reaches the server (the same guard
   * `assignWineToLocation` applies), so it is reported as NOT WRITTEN rather
   * than counted as a success.
   */
  const assignWinesToLocations = useCallback(
    async (
      picks: { wineId: string; locationId: string; quantity?: number; label?: string }[],
    ): Promise<{
      written: string[]
      failed: { wineId: string; label: string; message: string }[]
      denied: boolean
    }> => {
      const written: string[] = []
      const failed: { wineId: string; label: string; message: string }[] = []
      let denied = false

      for (const pick of picks) {
        const label = pick.label ?? pick.wineId
        assignWineToLocation(pick.wineId, pick.locationId, pick.quantity ?? 1)
        if (!restaurantId) {
          failed.push({
            wineId: pick.wineId,
            label,
            message: 'no restaurant is active, so nothing was sent',
          })
          continue
        }
        if (!UUID_RE.test(pick.locationId)) {
          failed.push({
            wineId: pick.wineId,
            label,
            message: 'that zone has no server record yet, so nothing was written for it',
          })
          continue
        }
        try {
          await apiClient.post(`/storage-locations/${restaurantId}/mappings`, {
            wineId: pick.wineId,
            locationId: pick.locationId,
            quantity: pick.quantity ?? 1,
          })
          written.push(pick.wineId)
        } catch (err) {
          const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string }
          if (e?.response?.status === 403 || e?.response?.status === 401) denied = true
          failed.push({
            wineId: pick.wineId,
            label,
            message: e?.response?.data?.message || e?.message || 'the request did not complete',
          })
        }
      }

      queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })
      return { written, failed, denied }
    },
    [assignWineToLocation, restaurantId, queryClient],
  )

  /**
   * The awaited forms of create / edit / delete, for a surface that has to say
   * what actually landed.
   *
   * `addLocation`, `updateLocation` and `deleteLocation` above are optimistic
   * and silent by design, and two of the three are worse than that:
   * `updateLocation` and `deleteLocation` hand their write to `persistToServer`
   * whose catch block is empty, so a zone the server REFUSED to delete still
   * disappears from the list and takes its wine→zone mappings out of the cache
   * with it. The operator is then looking at a cellar map that disagrees with
   * the database and has no way to know. `addLocation` at least rolls its
   * optimistic row back — silently, so a zone appears and then vanishes with no
   * sentence attached.
   *
   * These three await the server and report. Nothing is written to the cache
   * until the server has accepted it, so the list cannot show a zone the
   * database refused, and a 401/403 is separated from a fault because they ask
   * different things of the reader.
   *
   * The optimistic three are untouched: the legacy manager renders them and its
   * behaviour must not change.
   */
  const createLocationChecked = useCallback(
    async (
      location: Omit<StorageLocation, 'id'>,
    ): Promise<{ ok: boolean; message?: string; denied?: boolean; created?: StorageLocation }> => {
      if (!restaurantId)
        return { ok: false, message: 'no restaurant is active, so nothing was sent' }
      try {
        const { data } = await apiClient.post(`/storage-locations/${restaurantId}`, {
          name: location.name,
          description: location.description,
          capacity: location.capacity,
          temperature: location.temperature,
          humidity: location.humidity,
          notes: location.notes,
          parent_id: location.parentId,
          color: location.color,
          location_type: 'cellar',
        })
        if (!data?.id)
          return { ok: false, message: 'the server accepted the request but returned no zone' }
        const created = mapServerLocation(data)
        setLocations((prev) => [...prev, created])
        queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY, restaurantId] })
        return { ok: true, created }
      } catch (err) {
        const e = err as {
          response?: { status?: number; data?: { message?: string } }
          message?: string
        }
        return {
          ok: false,
          denied: e?.response?.status === 403 || e?.response?.status === 401,
          message: e?.response?.data?.message || e?.message || 'the request did not complete',
        }
      }
    },
    [restaurantId, setLocations, queryClient],
  )

  const updateLocationChecked = useCallback(
    async (
      id: string,
      updates: Partial<StorageLocation>,
    ): Promise<{ ok: boolean; message?: string; denied?: boolean }> => {
      if (!restaurantId)
        return { ok: false, message: 'no restaurant is active, so nothing was sent' }
      if (!UUID_RE.test(id))
        return { ok: false, message: 'this zone has no server record yet, so nothing was written' }
      try {
        await apiClient.patch(`/storage-locations/${restaurantId}/${id}`, updates)
        setLocations((prev) => prev.map((loc) => (loc.id === id ? { ...loc, ...updates } : loc)))
        queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY, restaurantId] })
        return { ok: true }
      } catch (err) {
        const e = err as {
          response?: { status?: number; data?: { message?: string } }
          message?: string
        }
        return {
          ok: false,
          denied: e?.response?.status === 403 || e?.response?.status === 401,
          message: e?.response?.data?.message || e?.message || 'the request did not complete',
        }
      }
    },
    [restaurantId, setLocations, queryClient],
  )

  const deleteLocationChecked = useCallback(
    async (id: string): Promise<{ ok: boolean; message?: string; denied?: boolean }> => {
      if (!restaurantId)
        return { ok: false, message: 'no restaurant is active, so nothing was sent' }
      if (!UUID_RE.test(id))
        return { ok: false, message: 'this zone has no server record yet, so nothing was deleted' }
      try {
        await apiClient.delete(`/storage-locations/${restaurantId}/${id}`)
        setMappings((prev) => prev.filter((m) => m.locationId !== id))
        setLocations((prev) => prev.filter((loc) => loc.id !== id))
        queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY, restaurantId] })
        return { ok: true }
      } catch (err) {
        const e = err as {
          response?: { status?: number; data?: { message?: string } }
          message?: string
        }
        return {
          ok: false,
          denied: e?.response?.status === 403 || e?.response?.status === 401,
          message: e?.response?.data?.message || e?.message || 'the request did not complete',
        }
      }
    },
    [restaurantId, setLocations, setMappings, queryClient],
  )

  const removeWineFromLocation = useCallback(
    (wineId: string) => {
      const mapping = mappings.find((m) => m.wineId === wineId)
      if (!mapping) return

      setMappings((prev) => prev.filter((m) => m.wineId !== wineId))
      setLocations((locs) =>
        locs.map((loc) =>
          loc.id === mapping.locationId
            ? { ...loc, currentCount: Math.max(0, loc.currentCount - mapping.quantity) }
            : loc,
        ),
      )

      persistToServer('DELETE', `/storage-locations/${restaurantId}/mappings/${wineId}`)
      queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })
    },
    [mappings, setMappings, setLocations, persistToServer, restaurantId],
  )

  const updateWineQuantityAtLocation = useCallback(
    (wineId: string, newQuantity: number) => {
      // Same fix as assignWineToLocation: hoist the location-count update out of
      // the setMappings updater so it commits in the same pass, not one behind.
      const existing = mappings.find((m) => m.wineId === wineId)
      if (!existing) return
      const diff = newQuantity - existing.quantity

      setMappings((prev) =>
        prev.map((m) => (m.wineId === wineId ? { ...m, quantity: newQuantity } : m)),
      )
      setLocations((locs) =>
        locs.map((loc) =>
          loc.id === existing.locationId
            ? { ...loc, currentCount: Math.max(0, loc.currentCount + diff) }
            : loc,
        ),
      )
    },
    [mappings, setMappings, setLocations],
  )

  const addLocation = useCallback(
    (location: Omit<StorageLocation, 'id'>): StorageLocation => {
      const tempId = `loc-${Date.now()}`
      const optimistic: StorageLocation = { ...location, id: tempId }
      setLocations((prev) => [...prev, optimistic])

      if (restaurantId) {
        apiClient
          .post(`/storage-locations/${restaurantId}`, {
            name: location.name,
            description: location.description,
            capacity: location.capacity,
            temperature: location.temperature,
            humidity: location.humidity,
            notes: location.notes,
            parent_id: location.parentId,
            color: location.color,
            location_type: 'cellar',
          })
          .then(({ data }) => {
            if (data?.id) {
              // Replace the temp ID with the real server UUID in both locations and any mappings
              setLocations((prev) =>
                prev.map((l) => (l.id === tempId ? mapServerLocation(data) : l)),
              )
              setMappings((prev) =>
                prev.map((m) =>
                  m.locationId === tempId ? { ...m, locationId: data.id as string } : m,
                ),
              )
            }
          })
          .catch(() => {
            // Remove the optimistic entry if the server rejected it
            setLocations((prev) => prev.filter((l) => l.id !== tempId))
          })
          .finally(() => {
            queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY, restaurantId] })
          })
      }

      return optimistic
    },
    [restaurantId, setLocations, setMappings, queryClient],
  )

  const updateLocation = useCallback(
    (id: string, updates: Partial<StorageLocation>) => {
      setLocations((prev) =>
        prev.map((loc) => (loc.id === id ? { ...loc, ...updates } : loc)),
      )

      if (restaurantId) {
        persistToServer(
          'PATCH',
          `/storage-locations/${restaurantId}/${id}`,
          updates,
        )
      }
    },
    [restaurantId, persistToServer, setLocations],
  )

  const deleteLocation = useCallback(
    (id: string) => {
      setMappings((prev) => prev.filter((m) => m.locationId !== id))
      setLocations((prev) => prev.filter((loc) => loc.id !== id))

      if (restaurantId) {
        persistToServer(
          'DELETE',
          `/storage-locations/${restaurantId}/${id}`,
        )
      }
    },
    [restaurantId, persistToServer, setMappings, setLocations],
  )

  const getLocationStats = useCallback(() => {
    // Capacity totals cover only the zones whose capacity someone recorded.
    // Summing `?? 0` over the rest would understate the denominator and make
    // utilisation read high; summing `?? 100` would invent one. Both are
    // measurements the data does not support, so the count of zones we could
    // not include travels with the figure.
    const withCapacity = locations.filter((loc) => loc.capacity != null)
    const capacityUnknownCount = locations.length - withCapacity.length
    const totalCapacity = withCapacity.length
      ? withCapacity.reduce((sum, loc) => sum + (loc.capacity as number), 0)
      : null
    const totalUsed = locations.reduce(
      (sum, loc) => sum + loc.currentCount,
      0,
    )
    const usedInMeasured = withCapacity.reduce(
      (sum, loc) => sum + loc.currentCount,
      0,
    )
    const utilizationRate =
      totalCapacity && totalCapacity > 0
        ? Math.round((usedInMeasured / totalCapacity) * 1000) / 10
        : null

    return {
      totalLocations: locations.length,
      totalCapacity,
      capacityUnknownCount,
      totalUsed,
      availableSpace: totalCapacity == null ? null : totalCapacity - usedInMeasured,
      utilizationRate,
    }
  }, [locations])

  const recalculateLocationCounts = useCallback(() => {
    setLocations((locs) =>
      locs.map((loc) => {
        const winesInLocation = mappings.filter(
          (m) => m.locationId === loc.id,
        )
        const actualCount = winesInLocation.reduce(
          (sum, m) => sum + m.quantity,
          0,
        )
        return { ...loc, currentCount: actualCount }
      }),
    )
  }, [mappings, setLocations])

  const getLocationsWithActualCounts = useCallback((): StorageLocation[] => {
    return locations.map((loc) => {
      const winesInLocation = mappings.filter((m) => m.locationId === loc.id)
      const actualCount = winesInLocation.reduce(
        (sum, m) => sum + m.quantity,
        0,
      )
      return { ...loc, currentCount: actualCount }
    })
  }, [locations, mappings])

  return {
    locations,
    mappings,
    locationsLoading: locationsQuery.isPending,
    /** The zones fetch failed and we hold no answer. Say so in words. */
    locationsUnavailable,
    /** The wine→zone mappings fetch failed. "Nothing assigned" would be a lie. */
    mappingsUnavailable,
    getWineLocation,
    getWinesInLocation,
    assignWineToLocation,
    assignWinesToLocations,
    removeWineFromLocation,
    updateWineQuantityAtLocation,
    addLocation,
    updateLocation,
    deleteLocation,
    createLocationChecked,
    updateLocationChecked,
    deleteLocationChecked,
    getLocationStats,
    recalculateLocationCounts,
    getLocationsWithActualCounts,
    setLocations,
  }
}

export type { WineLocationMapping }

export interface EnrichedWineAtLocation {
  wineId: string
  wineName: string
  producer: string
  vintage: string | null
  quantity: number
  assignedAt: string
}

export function useWinesAtLocation(locationId: string | null) {
  const { activeRestaurantId, isAuthenticated } = useAuth()
  const restaurantId = activeRestaurantId ?? ''

  const query = useQuery<EnrichedWineAtLocation[]>({
    queryKey: [WINES_AT_LOCATION_KEY, restaurantId, locationId],
    queryFn: async () => {
      const { data } = await apiClient.get(
        `/storage-locations/${restaurantId}/locations/${locationId}/wines`,
      )
      return Array.isArray(data) ? data : []
    },
    enabled: !!restaurantId && !!locationId && isAuthenticated && UUID_RE.test(locationId ?? ''),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })

  return {
    wines: query.data ?? [],
    isLoading: query.isLoading,
  }
}
