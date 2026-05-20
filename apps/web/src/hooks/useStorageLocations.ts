/**
 * useStorageLocations Hook
 *
 * API-primary storage locations and wine-to-location mappings.
 * Uses React Query for caching. Falls back to defaults if API is unavailable.
 * Same public interface as the previous localStorage-based version.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../services/api/client'
import { useAuth } from '../contexts/AuthContext'

export interface StorageLocation {
  id: string
  name: string
  description?: string
  capacity: number
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

const DEFAULT_LOCATIONS: StorageLocation[] = [
  { id: 'loc-1', name: 'Main Cellar', description: 'Primary wine storage', capacity: 500, currentCount: 0, temperature: '55°F', humidity: '70%', color: '#be123c' },
  { id: 'loc-2', name: 'Bar Stock', description: 'Ready-to-serve wines', capacity: 100, currentCount: 0, temperature: '58°F', color: '#f59e0b' },
  { id: 'loc-3', name: 'Overflow Storage', description: 'Secondary storage area', capacity: 200, currentCount: 0, color: '#10b981' },
  { id: 'loc-4', name: 'VIP Reserve', description: 'Premium wines for special occasions', capacity: 50, currentCount: 0, temperature: '53°F', humidity: '75%', color: '#8b5cf6' },
]

function mapServerLocation(loc: any): StorageLocation {
  return {
    id: loc.id,
    name: loc.name,
    description: loc.description || '',
    capacity: loc.capacity ?? 100,
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
      if (Array.isArray(data) && data.length > 0) {
        return data.map(mapServerLocation)
      }
      return DEFAULT_LOCATIONS
    },
    enabled: !!restaurantId && isAuthenticated,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: DEFAULT_LOCATIONS,
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
    placeholderData: [],
    retry: 1,
  })

  const locations = locationsQuery.data ?? DEFAULT_LOCATIONS
  const mappings = mappingsQuery.data ?? []

  // Seed default locations to DB on first load when server has none.
  // Without this, assignments to default loc-1..4 are never persisted (UUID guard blocks them)
  // and a hard refresh wipes all mappings because the server has no record of them.
  const didSeedRef = useRef(false)
  useEffect(() => {
    if (!restaurantId || !isAuthenticated) return
    if (didSeedRef.current) return
    if (!locationsQuery.isFetched || locationsQuery.isFetching) return
    if (!locationsQuery.isSuccess) return

    // All IDs match the hard-coded defaults → server returned empty, fallback was used
    const allAreDefaults =
      locations.length === DEFAULT_LOCATIONS.length &&
      locations.every(l => DEFAULT_LOCATIONS.some(d => d.id === l.id))
    if (!allAreDefaults) return

    didSeedRef.current = true
    Promise.all(
      DEFAULT_LOCATIONS.map(loc =>
        apiClient.post(`/storage-locations/${restaurantId}`, {
          name: loc.name,
          description: loc.description,
          capacity: loc.capacity,
          temperature: loc.temperature,
          humidity: loc.humidity,
          color: loc.color,
          location_type: 'cellar',
        }),
      ),
    )
      .then(() => {
        queryClient.invalidateQueries({ queryKey: [LOCATIONS_KEY, restaurantId] })
      })
      .catch(() => {
        didSeedRef.current = false
      })
  }, [locationsQuery.isFetched, locationsQuery.isFetching, locationsQuery.isSuccess, restaurantId, isAuthenticated, locations, queryClient])

  const setLocations = useCallback(
    (updater: StorageLocation[] | ((prev: StorageLocation[]) => StorageLocation[])) => {
      queryClient.setQueryData<StorageLocation[]>(
        [LOCATIONS_KEY, restaurantId],
        (old) => {
          const prev = old ?? DEFAULT_LOCATIONS
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
      setMappings((prev) => {
        const existing = prev.find((m) => m.wineId === wineId)
        const oldLocationId = existing?.locationId

        let updated: WineLocationMapping[]

        if (existing) {
          updated = prev.map((m) =>
            m.wineId === wineId
              ? { ...m, locationId, quantity, assignedAt: new Date().toISOString() }
              : m,
          )
        } else {
          updated = [
            ...prev,
            { wineId, locationId, quantity, assignedAt: new Date().toISOString() },
          ]
        }

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

        return updated
      })

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
    [setMappings, setLocations, persistToServer, restaurantId],
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
      setMappings((prev) => {
        const existing = prev.find((m) => m.wineId === wineId)
        if (!existing) return prev

        const diff = newQuantity - existing.quantity

        setLocations((locs) =>
          locs.map((loc) =>
            loc.id === existing.locationId
              ? { ...loc, currentCount: Math.max(0, loc.currentCount + diff) }
              : loc,
          ),
        )

        return prev.map((m) =>
          m.wineId === wineId ? { ...m, quantity: newQuantity } : m,
        )
      })
    },
    [setMappings, setLocations],
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
    const totalCapacity = locations.reduce((sum, loc) => sum + loc.capacity, 0)
    const totalUsed = locations.reduce(
      (sum, loc) => sum + loc.currentCount,
      0,
    )
    const utilizationRate =
      totalCapacity > 0 ? (totalUsed / totalCapacity) * 100 : 0

    return {
      totalLocations: locations.length,
      totalCapacity,
      totalUsed,
      availableSpace: totalCapacity - totalUsed,
      utilizationRate: Math.round(utilizationRate * 10) / 10,
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
    locationsLoading: locationsQuery.isLoading,
    getWineLocation,
    getWinesInLocation,
    assignWineToLocation,
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
export { DEFAULT_LOCATIONS }

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
