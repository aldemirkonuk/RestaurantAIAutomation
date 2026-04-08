/**
 * useStorageLocations Hook
 *
 * API-primary storage locations and wine-to-location mappings.
 * Uses React Query for caching. Falls back to defaults if API is unavailable.
 * Same public interface as the previous localStorage-based version.
 */

import { useCallback } from 'react'
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
  { id: 'loc-1', name: 'Main Cellar', description: 'Primary wine storage', capacity: 500, currentCount: 324, temperature: '55°F', humidity: '70%', color: '#be123c' },
  { id: 'loc-2', name: 'Bar Stock', description: 'Ready-to-serve wines', capacity: 100, currentCount: 78, temperature: '58°F', color: '#f59e0b' },
  { id: 'loc-3', name: 'Overflow Storage', description: 'Secondary storage area', capacity: 200, currentCount: 45, color: '#10b981' },
  { id: 'loc-4', name: 'VIP Reserve', description: 'Premium wines for special occasions', capacity: 50, currentCount: 32, temperature: '53°F', humidity: '75%', color: '#8b5cf6' },
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

      persistToServer('POST', `/storage-locations/${restaurantId}/mappings`, {
        wineId,
        locationId,
        quantity,
      })
      queryClient.invalidateQueries({ queryKey: [WINES_AT_LOCATION_KEY, restaurantId] })
      queryClient.invalidateQueries({ queryKey: [MAPPINGS_KEY, restaurantId] })
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
      queryClient.invalidateQueries({ queryKey: [MAPPINGS_KEY, restaurantId] })
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
    (location: Omit<StorageLocation, 'id'>) => {
      const newLocation: StorageLocation = {
        ...location,
        id: `loc-${Date.now()}`,
      }
      setLocations((prev) => [...prev, newLocation])

      if (restaurantId) {
        persistToServer('POST', `/storage-locations/${restaurantId}`, {
          name: newLocation.name,
          description: newLocation.description,
          capacity: newLocation.capacity,
          temperature: newLocation.temperature,
          humidity: newLocation.humidity,
          notes: newLocation.notes,
          parent_id: newLocation.parentId,
          color: newLocation.color,
          location_type: 'cellar',
        })
      }

      return newLocation
    },
    [restaurantId, persistToServer, setLocations],
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
    enabled: !!restaurantId && !!locationId && isAuthenticated,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  })

  return {
    wines: query.data ?? [],
    isLoading: query.isLoading,
  }
}
