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

import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
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

/**
 * How long the in-zone bottle stepper waits after the last click before it
 * saves (sweep 2026-09-28 #6). Three quick clicks are one POST, not three.
 */
export const QUANTITY_SAVE_DEBOUNCE_MS = 500

/** What the gateway said, in words a toast can carry. */
function reasonOf(err: unknown): string {
  const data = (err as { response?: { data?: { message?: unknown } } })?.response?.data
  const msg = data?.message
  if (Array.isArray(msg) && msg.length) return msg.join('; ')
  if (typeof msg === 'string' && msg) return msg
  return err instanceof Error && err.message ? err.message : 'the server did not answer'
}

/**
 * The PATCH body UpdateStorageLocationDto accepts, built from the web's
 * camelCase zone. main.ts runs the pipe with forbidNonWhitelisted, so a key
 * the DTO does not declare (the old `parentId`) turns the whole edit into a
 * 400 (sweep 2026-09-28 #4). A `parentId` key that is present but undefined
 * means "no parent" and is sent as `parent_id: null`, which is how it clears.
 */
function toUpdateBody(updates: Partial<StorageLocation>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  const pass = ['name', 'description', 'capacity', 'temperature', 'humidity', 'notes', 'color'] as const
  for (const k of pass) {
    if (updates[k] !== undefined) body[k] = updates[k]
  }
  if (updates.currentCount !== undefined) body.current_count = updates.currentCount
  if ('parentId' in updates) body.parent_id = updates.parentId ?? null
  return body
}

export interface ZoneAssignment {
  wineId: string
  locationId: string
  quantity: number
}

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

  /**
   * One zone write. Resolves true only when the gateway accepted it. On any
   * failure it runs `rollback` (so the screen goes back to what the server
   * holds), shows an error toast, and resolves false. Until 2026-09-28 this
   * helper caught and discarded every error, so a refused write stood on
   * screen as saved (sweep #5).
   */
  const persistToServer = useCallback(
    async (
      method: string,
      path: string,
      body: unknown,
      what: string,
      rollback: () => void,
    ): Promise<boolean> => {
      if (!restaurantId) {
        rollback()
        toast.error(`Could not ${what}: no house is selected.`)
        return false
      }
      try {
        await apiClient.request({ method, url: path, data: body })
        return true
      } catch (err) {
        rollback()
        toast.error(`Could not ${what}: ${reasonOf(err)}`)
        return false
      }
    },
    [restaurantId],
  )

  /** Adds `delta` bottles to a zone's count in the cache (negative removes). */
  const shiftCount = useCallback(
    (locationId: string, delta: number) => {
      if (!delta) return
      setLocations((locs) =>
        locs.map((loc) =>
          loc.id === locationId
            ? { ...loc, currentCount: Math.max(0, loc.currentCount + delta) }
            : loc,
        ),
      )
    },
    [setLocations],
  )

  // Stepper debounce state, per wine: the pending timer, the arguments it
  // will save with (so an unmount can flush it), and the quantity the server
  // held before the burst began (what a refusal rolls back to).
  const quantityTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const quantityPending = useRef(new Map<string, { locationId: string; quantity: number }>())
  const quantityBaseline = useRef(new Map<string, number>())

  const cancelPendingQuantity = useCallback((wineId: string) => {
    const t = quantityTimers.current.get(wineId)
    if (t) clearTimeout(t)
    quantityTimers.current.delete(wineId)
    quantityPending.current.delete(wineId)
    quantityBaseline.current.delete(wineId)
  }, [])

  const saveQuantity = useCallback(
    async (wineId: string, locationId: string, quantity: number): Promise<boolean> => {
      quantityTimers.current.delete(wineId)
      quantityPending.current.delete(wineId)
      const baseline = quantityBaseline.current.get(wineId)
      quantityBaseline.current.delete(wineId)
      return persistToServer(
        'POST',
        `/storage-locations/${restaurantId}/mappings`,
        { wineId, locationId, quantity },
        'save the bottle count',
        () => {
          if (baseline === undefined) return
          const now = queryClient
            .getQueryData<WineLocationMapping[]>([MAPPINGS_KEY, restaurantId])
            ?.find((m) => m.wineId === wineId)
          setMappings((prev) =>
            prev.map((m) => (m.wineId === wineId ? { ...m, quantity: baseline } : m)),
          )
          if (now) shiftCount(now.locationId, baseline - now.quantity)
        },
      )
    },
    [persistToServer, restaurantId, queryClient, setMappings, shiftCount],
  )

  // A stepper click made just before the zone sheet closes is still a click:
  // on unmount, save what is pending instead of dropping it with the timer.
  const saveQuantityRef = useRef(saveQuantity)
  saveQuantityRef.current = saveQuantity
  useEffect(() => {
    const timers = quantityTimers.current
    const pending = quantityPending.current
    return () => {
      for (const [wineId, t] of timers) {
        clearTimeout(t)
        const args = pending.get(wineId)
        if (args) void saveQuantityRef.current(wineId, args.locationId, args.quantity)
      }
      timers.clear()
    }
  }, [])

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
    async (wineId: string, locationId: string, quantity: number = 1): Promise<boolean> => {
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

      cancelPendingQuantity(wineId)
      const rollback = () => {
        setMappings((prev) => {
          const rest = prev.filter((m) => m.wineId !== wineId)
          return existing ? [...rest, existing] : rest
        })
        // Mirrors the optimistic count update above, branch for branch.
        shiftCount(locationId, -quantity)
        if (existing && existing.locationId !== locationId) {
          shiftCount(existing.locationId, existing.quantity)
        }
      }

      // A zone still carrying its temp id has not been created on the server
      // yet, so there is nothing to attach the wine to. Counting it as
      // assigned would report a write that never happened.
      if (!UUID_RE.test(locationId)) {
        rollback()
        toast.error('Could not assign the wine: that zone is still being created. Try again in a moment.')
        return false
      }

      const ok = await persistToServer(
        'POST',
        `/storage-locations/${restaurantId}/mappings`,
        { wineId, locationId, quantity },
        'assign the wine to that zone',
        rollback,
      )
      queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })
      return ok
    },
    [mappings, setMappings, setLocations, shiftCount, cancelPendingQuantity, persistToServer, restaurantId, queryClient],
  )

  /**
   * Auto-locate's bulk write. Counts what the server accepted, not what was
   * asked for: "N wines assigned" used to be the length of the request list
   * (sweep #5). Sequential, so each rollback lands on a settled cache.
   */
  const assignMany = useCallback(
    async (list: ZoneAssignment[]): Promise<{ assigned: number; failed: number }> => {
      let assigned = 0
      for (const a of list) {
        if (await assignWineToLocation(a.wineId, a.locationId, a.quantity)) assigned += 1
      }
      return { assigned, failed: list.length - assigned }
    },
    [assignWineToLocation],
  )

  const removeWineFromLocation = useCallback(
    async (wineId: string): Promise<boolean> => {
      const mapping = mappings.find((m) => m.wineId === wineId)
      if (!mapping) return false
      cancelPendingQuantity(wineId)

      setMappings((prev) => prev.filter((m) => m.wineId !== wineId))
      setLocations((locs) =>
        locs.map((loc) =>
          loc.id === mapping.locationId
            ? { ...loc, currentCount: Math.max(0, loc.currentCount - mapping.quantity) }
            : loc,
        ),
      )

      const ok = await persistToServer(
        'DELETE',
        `/storage-locations/${restaurantId}/mappings/${wineId}`,
        undefined,
        'remove the wine from its zone',
        () => {
          setMappings((prev) => [...prev.filter((m) => m.wineId !== wineId), mapping])
          shiftCount(mapping.locationId, mapping.quantity)
        },
      )
      queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })
      return ok
    },
    [mappings, setMappings, setLocations, shiftCount, cancelPendingQuantity, persistToServer, restaurantId, queryClient],
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

      // Until 2026-09-28 the stepper stopped here: the cache moved and the
      // server never heard, so the count went back on the next refresh
      // (sweep #6). Now the last value of a burst of clicks is POSTed to the
      // existing mappings upsert, and a refusal puts the count back to what
      // the server held before the burst began.
      if (!quantityBaseline.current.has(wineId)) {
        quantityBaseline.current.set(wineId, existing.quantity)
      }
      const pending = quantityTimers.current.get(wineId)
      if (pending) clearTimeout(pending)
      const args = { locationId: existing.locationId, quantity: newQuantity }
      quantityPending.current.set(wineId, args)
      quantityTimers.current.set(
        wineId,
        setTimeout(() => {
          void saveQuantity(wineId, args.locationId, args.quantity)
        }, QUANTITY_SAVE_DEBOUNCE_MS),
      )
    },
    [mappings, setMappings, setLocations, saveQuantity],
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
          .catch((err) => {
            // Remove the optimistic entry if the server rejected it, and say
            // so: a zone that vanishes without a word reads as a UI glitch.
            setLocations((prev) => prev.filter((l) => l.id !== tempId))
            toast.error(`Could not create the zone: ${reasonOf(err)}`)
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
    async (id: string, updates: Partial<StorageLocation>): Promise<boolean> => {
      const before = locations.find((loc) => loc.id === id)
      setLocations((prev) =>
        prev.map((loc) => (loc.id === id ? { ...loc, ...updates } : loc)),
      )

      return persistToServer(
        'PATCH',
        `/storage-locations/${restaurantId}/${id}`,
        toUpdateBody(updates),
        'save the zone',
        () => {
          if (!before) return
          setLocations((prev) => prev.map((loc) => (loc.id === id ? before : loc)))
        },
      )
    },
    [restaurantId, locations, persistToServer, setLocations],
  )

  const deleteLocation = useCallback(
    async (id: string): Promise<boolean> => {
      const index = locations.findIndex((loc) => loc.id === id)
      const removedZone = index >= 0 ? locations[index] : undefined
      const removedMappings = mappings.filter((m) => m.locationId === id)
      removedMappings.forEach((m) => cancelPendingQuantity(m.wineId))
      setMappings((prev) => prev.filter((m) => m.locationId !== id))
      setLocations((prev) => prev.filter((loc) => loc.id !== id))

      return persistToServer(
        'DELETE',
        `/storage-locations/${restaurantId}/${id}`,
        undefined,
        'delete the zone',
        () => {
          if (removedZone) {
            setLocations((prev) => {
              if (prev.some((loc) => loc.id === id)) return prev
              const next = [...prev]
              next.splice(Math.min(index, next.length), 0, removedZone)
              return next
            })
          }
          setMappings((prev) => [
            ...prev.filter((m) => !removedMappings.some((r) => r.wineId === m.wineId)),
            ...removedMappings,
          ])
        },
      )
    },
    [restaurantId, locations, mappings, cancelPendingQuantity, persistToServer, setMappings, setLocations],
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
    assignMany,
    removeWineFromLocation,
    updateWineQuantityAtLocation,
    addLocation,
    updateLocation,
    deleteLocation,
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
