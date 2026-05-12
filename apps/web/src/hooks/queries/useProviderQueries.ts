import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import type { ProviderFilters } from '../../lib/query-keys'
import {
  fetchProviders,
  fetchProviderById,
  createProvider,
  updateProvider,
  deleteProvider,
  fetchProviderContacts,
  addProviderContact,
  updateProviderContact,
  deleteProviderContact,
  fetchProviderOrders,
  searchProvidersByWineType,
  getRecommendedProviders,
  updateLastContactDate,
  bulkImportProviders,
  type Provider,
  type CreateProviderInput,
  type UpdateProviderInput,
  type ProviderContact,
} from '../../services/api/providers'
import { useNotificationStore } from '../../stores'
import { offlineStorage } from '../../lib/offline-storage'
import { syncManager } from '../../lib/sync-manager'

/**
 * Hook to fetch all providers for a restaurant
 * With offline support: caches data and falls back to cached data when offline
 */
export function useProviders(restaurantId: string, filters?: ProviderFilters) {
  const cacheKey = `providers_${restaurantId}_${JSON.stringify(filters || {})}`
  
  return useQuery({
    queryKey: queryKeys.providers.list(restaurantId, filters),
    queryFn: async () => {
      try {
        const providers = await fetchProviders(restaurantId, filters)
        
        // Fire-and-forget — do NOT await IDB writes; they must not block the render
        offlineStorage.cacheEntity(cacheKey, providers, 5 * 60 * 1000).catch(() => {})
        offlineStorage.markSynced('providers').catch(() => {})
        
        return providers
      } catch (error) {
        // Try to get cached data (IDB read is acceptable on error path — no spinner is shown)
        const cached = await offlineStorage.getCachedEntity<Provider[]>(cacheKey)
        if (cached) {
          console.warn('[Providers] Using cached data due to API error')
          return cached
        }
        
        // In development, return empty array instead of throwing
        if (import.meta.env.DEV) {
          console.warn('API not available, returning empty providers array')
          return []
        }
        throw error
      }
    },
    enabled: !!restaurantId,
    staleTime: 30000,
    gcTime: 10 * 60 * 1000,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    // Keep previous data visible while re-fetching so navigation back never shows a full spinner
    placeholderData: keepPreviousData,
  })
}

/**
 * Hook to fetch a single provider by ID
 */
export function useProvider(id: string) {
  return useQuery({
    queryKey: queryKeys.providers.detail(id),
    queryFn: () => fetchProviderById(id),
    enabled: !!id,
  })
}

/**
 * Hook to fetch provider contacts
 */
export function useProviderContacts(providerId: string) {
  return useQuery({
    queryKey: queryKeys.providers.contacts(providerId),
    queryFn: () => fetchProviderContacts(providerId),
    enabled: !!providerId,
  })
}

/**
 * Hook to fetch provider orders
 */
export function useProviderOrders(providerId: string) {
  return useQuery({
    queryKey: queryKeys.providers.orders(providerId),
    queryFn: () => fetchProviderOrders(providerId),
    enabled: !!providerId,
  })
}

/**
 * Hook to search providers by wine type
 */
export function useProvidersByWineType(restaurantId: string, wineType: string) {
  return useQuery({
    queryKey: [...queryKeys.providers.all, 'wine-type', restaurantId, wineType],
    queryFn: () => searchProvidersByWineType(restaurantId, wineType),
    enabled: !!restaurantId && !!wineType,
  })
}

/**
 * Hook to get recommended providers for a wine
 */
export function useRecommendedProviders(restaurantId: string, wineId: string) {
  return useQuery({
    queryKey: [...queryKeys.providers.all, 'recommendations', restaurantId, wineId],
    queryFn: () => getRecommendedProviders(restaurantId, wineId),
    enabled: !!restaurantId && !!wineId,
  })
}

/**
 * Hook to create a new provider
 * With offline support: queues mutation when offline
 */
export function useCreateProvider() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: async (data: CreateProviderInput) => {
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      try {
        return await createProvider(data)
      } catch (error) {
        // Queue for offline sync
        await syncManager.queueMutation({
          type: 'provider.create',
          data,
          tempId,
        })
        
        // Return optimistic result
        return {
          id: tempId,
          ...data,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          _pending: true,
        } as Provider & { _pending: boolean }
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.providers.lists() })
      const previousProviders = queryClient.getQueryData(queryKeys.providers.lists())
      return { previousProviders }
    },
    onSuccess: (newProvider, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.lists() })
      
      const isPending = (newProvider as any)._pending
      
      if (isPending) {
        toast.info('Provider saved offline', {
          description: `${variables.name} will sync when you're back online.`,
        })
      } else {
        toast.success('Provider created', {
          description: `${newProvider.name} has been added to your providers.`,
        })
      }
    },
    onError: (error: any, _, context) => {
      if (context?.previousProviders) {
        queryClient.setQueryData(queryKeys.providers.lists(), context.previousProviders)
      }
      
      toast.error('Failed to create provider', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to update a provider
 * With offline support: queues mutation when offline
 */
export function useUpdateProvider() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: async (data: UpdateProviderInput) => {
      try {
        return await updateProvider(data)
      } catch (error) {
        // Queue for offline sync
        await syncManager.queueMutation({
          type: 'provider.update',
          data,
        })
        
        return { ...data, _pending: true } as UpdateProviderInput & { _pending: boolean }
      }
    },
    onMutate: async (updatedProvider) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.providers.lists() })
      await queryClient.cancelQueries({ queryKey: queryKeys.providers.detail(updatedProvider.id) })
      
      const previousProviders = queryClient.getQueryData(queryKeys.providers.lists())
      const previousProvider = queryClient.getQueryData(queryKeys.providers.detail(updatedProvider.id))
      
      return { previousProviders, previousProvider }
    },
    onSuccess: (updatedProvider, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.lists() })
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.detail(variables.id) })
      
      const isPending = (updatedProvider as any)._pending
      
      if (isPending) {
        toast.info('Changes saved offline', {
          description: 'Will sync when you\'re back online.',
        })
      } else {
        toast.success('Provider updated', {
          description: `${updatedProvider.name} has been updated.`,
        })
      }
    },
    onError: (error: any, variables, context) => {
      if (context?.previousProviders) {
        queryClient.setQueryData(queryKeys.providers.lists(), context.previousProviders)
      }
      if (context?.previousProvider) {
        queryClient.setQueryData(queryKeys.providers.detail(variables.id), context.previousProvider)
      }
      
      toast.error('Failed to update provider', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to delete a provider
 * With offline support: queues deletion when offline
 */
export function useDeleteProvider() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        return await deleteProvider(id)
      } catch (error) {
        // Queue for offline sync
        await syncManager.queueMutation({
          type: 'provider.delete',
          data: { id },
        })
        
        return { deleted: true, _pending: true }
      }
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.providers.lists() })
      const previousProviders = queryClient.getQueryData(queryKeys.providers.lists())
      return { previousProviders, deletedId: id }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.lists() })
      
      const isPending = (result as any)?._pending
      
      if (isPending) {
        toast.info('Deletion saved offline', {
          description: 'Will sync when you\'re back online.',
        })
      } else {
        toast.success('Provider deleted', {
          description: 'The provider has been removed from your list.',
        })
      }
    },
    onError: (error: any, _, context) => {
      if (context?.previousProviders) {
        queryClient.setQueryData(queryKeys.providers.lists(), context.previousProviders)
      }
      
      toast.error('Failed to delete provider', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to add a contact to a provider
 */
export function useAddProviderContact() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ providerId, contact }: { providerId: string; contact: Omit<ProviderContact, 'id' | 'providerId'> }) =>
      addProviderContact(providerId, contact),
    onSuccess: (_, variables) => {
      // Invalidate provider contacts
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.contacts(variables.providerId) })
      
      toast.success('Contact added', {
        description: 'The contact has been added to this provider.',
      })
    },
    onError: (error: any) => {
      toast.error('Failed to add contact', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to update a provider contact
 */
export function useUpdateProviderContact() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ providerId, contactId, data }: { providerId: string; contactId: string; data: Partial<Omit<ProviderContact, 'id' | 'providerId'>> }) =>
      updateProviderContact(providerId, contactId, data),
    onSuccess: (_, variables) => {
      // Invalidate provider contacts
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.contacts(variables.providerId) })
      
      toast.success('Contact updated')
    },
    onError: (error: any) => {
      toast.error('Failed to update contact', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to delete a provider contact
 */
export function useDeleteProviderContact() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ providerId, contactId }: { providerId: string; contactId: string }) =>
      deleteProviderContact(providerId, contactId),
    onSuccess: (_, variables) => {
      // Invalidate provider contacts
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.contacts(variables.providerId) })
      
      toast.success('Contact deleted')
    },
    onError: (error: any) => {
      toast.error('Failed to delete contact', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}

/**
 * Hook to update last contact date
 */
export function useUpdateLastContactDate() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: ({ providerId, date }: { providerId: string; date: string }) =>
      updateLastContactDate(providerId, date),
    onSuccess: (updatedProvider) => {
      // Update provider detail cache
      queryClient.setQueryData(
        queryKeys.providers.detail(updatedProvider.id),
        updatedProvider
      )
      
      // Invalidate provider lists
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.lists() })
    },
  })
}

/**
 * Hook to bulk import providers
 */
export function useBulkImportProviders() {
  const queryClient = useQueryClient()
  const toast = useNotificationStore()
  
  return useMutation({
    mutationFn: ({ restaurantId, providers }: { restaurantId: string; providers: CreateProviderInput[] }) =>
      bulkImportProviders(restaurantId, providers),
    onSuccess: (result) => {
      // Invalidate provider lists
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.lists() })
      
      if (result.failed > 0) {
        toast.warning('Import completed with errors', {
          description: `${result.imported} imported, ${result.failed} failed.`,
        })
      } else {
        toast.success('Import successful', {
          description: `${result.imported} providers imported.`,
        })
      }
    },
    onError: (error: any) => {
      toast.error('Import failed', {
        description: error.response?.data?.message || error.message,
      })
    },
  })
}
