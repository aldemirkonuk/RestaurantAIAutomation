import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, Save, RefreshCw, Send } from 'lucide-react'
import { apiClient } from '../../services/api/client'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'

interface TemplateRow { id: string; name: string; subject?: string; body: string; type: string; is_active?: boolean }

/**
 * Self-contained card: sets the name every outbound vendor email is signed with.
 * Stored as a `sender_identity` row in communication_templates (reused by the
 * gateway's send-time finalizer, which replaces "[Manager Name]" with this).
 */
export function EmailSenderSettings() {
  const { user, activeRestaurantId } = useAuth()
  const restaurantId = activeRestaurantId ?? user?.restaurantId ?? ''
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data: identity } = useQuery({
    queryKey: ['sender-identity', restaurantId],
    queryFn: () =>
      apiClient.get(`/restaurants/${restaurantId}/templates`).then((r) => {
        const rows = (r.data ?? []) as TemplateRow[]
        return rows.find((t) => t.type === 'sender_identity') ?? null
      }),
    enabled: !!restaurantId,
  })

  const [name, setName] = useState('')
  useEffect(() => { setName(identity?.body ?? '') }, [identity?.id])

  const save = useMutation({
    mutationFn: async () => {
      const body = name.trim()
      if (identity?.id) {
        return apiClient.patch(`/restaurants/${restaurantId}/templates/${identity.id}`, { body })
      }
      return apiClient.post(`/restaurants/${restaurantId}/templates`, {
        name: 'Sender identity', body, type: 'sender_identity',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sender-identity', restaurantId] })
      toast.success('Email sign-off name saved.')
    },
    onError: () => toast.error('Could not save. Try again.'),
  })

  /**
   * NEW-495: verify the email pipeline without composing a real vendor mail.
   * POST /communications/test/email existed with no caller. It sends to the
   * gateway's configured manager recipients (not this form's sign-off name), so
   * the copy says that rather than implying it emails the person typing.
   */
  const sendTest = useMutation({
    mutationFn: () => apiClient.post('/communications/test/email'),
    onSuccess: (r: any) => {
      const to = r?.data?.recipients ?? r?.data?.to
      toast.success('Test email sent', {
        description: Array.isArray(to) && to.length ? `Delivered to ${to.join(', ')}` : 'Check the configured manager inbox.',
      })
    },
    onError: () => toast.error('Test email failed — check the Gmail integration in Admin.'),
  })

  const dirty = (identity?.body ?? '') !== name.trim()

  return (
    <div id="email" className="scroll-mt-32 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-6 py-4 flex items-center gap-2 border-b border-gray-50">
        <Mail className="w-4 h-4 text-wine-500" />
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Email sign-off</h2>
          <p className="text-xs text-gray-400 mt-0.5">The name every vendor email is signed with</p>
        </div>
      </div>
      <div className="px-6 py-5">
        <label htmlFor="sender-name" className="block text-xs font-medium text-gray-600 mb-1.5">Your name / sign-off</label>
        <div className="flex items-center gap-2">
          <input
            id="sender-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Aldemir Konuk"
            className="flex-1 text-sm text-gray-800 border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wine-200 focus:border-wine-300"
          />
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-wine-600 hover:bg-wine-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {save.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
          Replaces the old “[Manager Name]” placeholder. Emails end with “Best regards, {name.trim() || 'your name'}”.
        </p>
        <div className="mt-4 pt-4 border-t border-gray-50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Send a test to confirm the Gmail connection works. It goes to the configured
            manager recipients, not to this sign-off name.
          </p>
          <button
            type="button"
            onClick={() => sendTest.mutate()}
            disabled={sendTest.isPending}
            className="shrink-0 px-3 py-1.5 text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {sendTest.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send test email
          </button>
        </div>
      </div>
    </div>
  )
}
