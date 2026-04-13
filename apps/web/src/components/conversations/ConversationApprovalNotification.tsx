import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare,
  Check,
  X,
  Edit3,
  Clock,
  Wine,
  DollarSign,
  Package,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Send,
} from 'lucide-react'
import axios from 'axios'

const API_URL = import.meta.env?.VITE_API_GATEWAY_URL || 'http://localhost:4000'

interface ConversationMessage {
  from: string
  message: string
  timestamp: string
  requiresApproval?: boolean
}

interface AIConversationApprovalEvent {
  type: 'ai_conversation_approval'
  conversation_id: string
  order_id: string
  provider_name: string
  ai_message: string
  conversation_history: ConversationMessage[]
  wine_name: string
  target_price?: number
  current_offer?: number
  urgency?: string
  actions?: Array<{ id: string; label: string; url: string; style?: string }>
}

interface ConversationApprovalNotificationProps {
  event: AIConversationApprovalEvent
  onApproved?: (conversationId: string) => void
  onRejected?: (conversationId: string) => void
  onClose?: () => void
}

export function ConversationApprovalNotification({
  event,
  onApproved,
  onRejected,
  onClose,
}: ConversationApprovalNotificationProps) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editedMessage, setEditedMessage] = useState(event.ai_message)
  const [managerNotes, setManagerNotes] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')

  const handleApprove = async () => {
    setProcessing(true)
    setError('')

    try {
      const response = await axios.post(
        `${API_URL}/api/v1/conversations/${event.conversation_id}/approve`,
        {
          approved: true,
          modified_message: editing && editedMessage !== event.ai_message ? editedMessage : undefined,
          manager_notes: managerNotes || undefined,
          approval_channel: 'push_notification', // 80% primary channel
        }
      )

      if (response.data.success) {
        onApproved?.(event.conversation_id)
        onClose?.()
      } else {
        setError(response.data.error || 'Approval failed')
      }
    } catch (err: any) {
      console.error('Failed to approve conversation:', err)
      setError(err.response?.data?.error || err.message || 'Network error')
    } finally {
      setProcessing(false)
    }
  }

  const handleReject = async () => {
    if (!confirm('Are you sure you want to reject this AI message?')) {
      return
    }

    setProcessing(true)
    setError('')

    try {
      const response = await axios.post(
        `${API_URL}/api/v1/conversations/${event.conversation_id}/reject`,
        {
          reason: 'Manager declined',
          manager_notes: managerNotes || undefined,
        }
      )

      if (response.data.success) {
        onRejected?.(event.conversation_id)
        onClose?.()
      } else {
        setError(response.data.error || 'Rejection failed')
      }
    } catch (err: any) {
      console.error('Failed to reject conversation:', err)
      setError(err.response?.data?.error || err.message || 'Network error')
    } finally {
      setProcessing(false)
    }
  }

  const handleEdit = () => {
    setEditing(true)
    setExpanded(true)
  }

  const timeSinceCreation = () => {
    const lastMessage = event.conversation_history[event.conversation_history.length - 1]
    if (!lastMessage) return 'Just now'

    const messageTime = new Date(lastMessage.timestamp)
    const now = new Date()
    const diffMinutes = Math.floor((now.getTime() - messageTime.getTime()) / (1000 * 60))

    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className="bg-white rounded-2xl shadow-2xl border-2 border-wine-500 overflow-hidden max-w-2xl"
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-wine-600 to-rose-600 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white/20 rounded-lg">
            <MessageSquare className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">🤖 AI Needs Approval</h3>
            <p className="text-white/80 text-sm">Message to {event.provider_name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-white/20 rounded-full text-white text-xs font-medium flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {timeSinceCreation()}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-6 space-y-4">
        {/* Context Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-wine-50 p-3 rounded-xl border border-wine-200">
            <p className="text-xs text-wine-700 font-medium mb-1">Wine</p>
            <div className="flex items-center gap-2">
              <Wine className="w-4 h-4 text-wine-600" />
              <p className="text-sm font-bold text-wine-900 truncate">{event.wine_name}</p>
            </div>
          </div>

          {event.target_price && (
            <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
              <p className="text-xs text-emerald-700 font-medium mb-1">Target Price</p>
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-bold text-emerald-900">${event.target_price.toFixed(2)}</p>
              </div>
            </div>
          )}

          {event.current_offer && (
            <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
              <p className="text-xs text-amber-700 font-medium mb-1">Current Offer</p>
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-amber-600" />
                <p className="text-sm font-bold text-amber-900">${event.current_offer.toFixed(2)}</p>
              </div>
            </div>
          )}
        </div>

        {/* AI Message */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-gray-900">AI's Proposed Message</label>
            {!editing && (
              <button
                onClick={handleEdit}
                className="text-sm text-wine-600 hover:text-wine-700 font-medium flex items-center gap-1"
              >
                <Edit3 className="w-3 h-3" />
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <textarea
              value={editedMessage}
              onChange={(e) => setEditedMessage(e.target.value)}
              className="w-full px-4 py-3 border-2 border-wine-300 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-wine-500 text-sm resize-none"
              rows={6}
              placeholder="Edit the AI's message..."
            />
          ) : (
            <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{event.ai_message}</p>
            </div>
          )}
        </div>

        {/* Conversation History */}
        {event.conversation_history && event.conversation_history.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center justify-between w-full text-sm font-semibold text-gray-900 hover:text-wine-600 transition-colors"
            >
              <span>Conversation History ({event.conversation_history.length})</span>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="mt-3 space-y-2 max-h-64 overflow-y-auto"
                >
                  {event.conversation_history.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg ${
                        msg.from === 'ai' ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 border border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-600">
                          {msg.from === 'ai' ? '🤖 AI' : '👤 Provider'}
                        </span>
                        <span className="text-xs text-gray-500">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-sm text-gray-700">{msg.message}</p>
                      {msg.requiresApproval && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                          Waiting for approval
                        </span>
                      )}
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Manager Notes */}
        {(editing || managerNotes) && (
          <div>
            <label className="text-sm font-semibold text-gray-900 mb-2 block">Manager Notes (Optional)</label>
            <textarea
              value={managerNotes}
              onChange={(e) => setManagerNotes(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-wine-500 text-sm resize-none"
              rows={2}
              placeholder="Add notes for your team or future reference..."
            />
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-rose-900">Error</p>
              <p className="text-sm text-rose-700">{error}</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between gap-3">
        <button
          onClick={handleReject}
          disabled={processing}
          className="px-5 py-2.5 border-2 border-rose-500 text-rose-600 font-medium rounded-xl hover:bg-rose-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          <X className="w-4 h-4" />
          Reject
        </button>

        <button
          onClick={handleApprove}
          disabled={processing || (editing && editedMessage.trim().length === 0)}
          className="flex-1 px-6 py-2.5 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {processing ? (
            <>
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              >
                <Send className="w-5 h-5" />
              </motion.div>
              Sending...
            </>
          ) : (
            <>
              <Check className="w-5 h-5" />
              {editing ? 'Approve & Send Edited Message' : 'Approve & Send'}
            </>
          )}
        </button>
      </div>
    </motion.div>
  )
}

