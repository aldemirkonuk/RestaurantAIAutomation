/**
 * React Query Hooks
 * 
 * Custom hooks that wrap API services with React Query for caching,
 * loading states, error handling, and optimistic updates.
 * 
 * Usage:
 * ```tsx
 * import { useProviders, useCreateProvider } from '@/hooks/queries'
 * 
 * function MyComponent() {
 *   const { data: providers, isLoading } = useProviders(restaurantId)
 *   const createProvider = useCreateProvider()
 *   
 *   const handleCreate = async () => {
 *     await createProvider.mutateAsync({ ... })
 *   }
 * }
 * ```
 */

// Provider hooks
export * from './useProviderQueries'
export * from './useWineQueries'

// Calendar hooks
export * from './useCalendarQueries'

// Notification hooks
export * from './useNotificationQueries'

// Order hooks
export * from './useOrderQueries'

// Inventory hooks
export * from './useInventoryQueries'

// Conversation hooks
export * from './useConversationQueries'

// Report hooks
export * from './useReportQueries'

// Sommelier hooks
export * from './useSommelierQueries'

// Distributor discovery hooks
export * from './useDistributorQueries'
