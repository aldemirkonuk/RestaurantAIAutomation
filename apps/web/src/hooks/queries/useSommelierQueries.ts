import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../lib/query-keys'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../stores'

export interface SommelierMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface SommelierConversation {
  id: string
  user_id: string
  title: string
  messages: SommelierMessage[]
  created_at: string
  updated_at: string
}

const TABLE = 'sommelier_conversations'

async function fetchConversations(userId: string): Promise<SommelierConversation[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    console.warn('sommelier_conversations table may not exist yet:', error.message)
    return []
  }
  return data ?? []
}

async function upsertConversation(
  conv: Omit<SommelierConversation, 'created_at' | 'updated_at'>,
): Promise<SommelierConversation> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(
      { ...conv, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    )
    .select()
    .single()

  if (error) throw error
  return data
}

async function deleteConversation(id: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw error
}

export function useSommelierConversations() {
  const userId = useAuthStore(s => s.user?.userId) ?? ''

  return useQuery<SommelierConversation[]>({
    queryKey: queryKeys.sommelier.conversations(userId),
    queryFn: () => fetchConversations(userId),
    enabled: !!userId,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    placeholderData: [],
    retry: 1,
  })
}

export function useUpsertSommelierConversation() {
  const userId = useAuthStore(s => s.user?.userId) ?? ''
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: upsertConversation,
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sommelier.conversations(userId),
      })
    },
  })
}

export function useDeleteSommelierConversation() {
  const userId = useAuthStore(s => s.user?.userId) ?? ''
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteConversation,
    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.sommelier.conversations(userId),
      })
      const previous = queryClient.getQueryData<SommelierConversation[]>(
        queryKeys.sommelier.conversations(userId),
      )
      queryClient.setQueryData<SommelierConversation[]>(
        queryKeys.sommelier.conversations(userId),
        (old) => (old ?? []).filter((c) => c.id !== id),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          queryKeys.sommelier.conversations(userId),
          context.previous,
        )
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sommelier.conversations(userId),
      })
    },
  })
}
