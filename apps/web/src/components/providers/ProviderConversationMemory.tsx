import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  fetchConversationMemory,
  searchConversationMemory,
  fetchProviderSessions,
  type ConversationMemoryEntry,
  type ConversationSession,
} from '../../services/api/provider-intelligence'

const ROLE_STYLES: Record<string, string> = {
  provider: 'bg-blue-50 border-blue-200',
  restaurant: 'bg-green-50 border-green-200',
  system: 'bg-gray-50 border-gray-200',
}

const CHANNEL_ICONS: Record<string, string> = {
  email: 'envelope',
  sms: 'chat-bubble',
  whatsapp: 'phone',
  voice: 'microphone',
}

const SESSION_STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  paused_for_approval: 'bg-amber-100 text-amber-700',
  waiting_response: 'bg-blue-100 text-blue-700',
  follow_up_scheduled: 'bg-purple-100 text-purple-700',
  completed: 'bg-gray-100 text-gray-500',
  abandoned: 'bg-red-100 text-red-500',
}

interface Props {
  providerId: string
}

export function ProviderConversationMemory({ providerId }: Props) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<ConversationMemoryEntry[] | null>(null)
  const [activeTab, setActiveTab] = useState<'memory' | 'sessions'>('memory')

  const { data: memory, isLoading: memoryLoading } = useQuery({
    queryKey: ['conversation-memory', providerId],
    queryFn: () => fetchConversationMemory(providerId, 50),
    enabled: !!providerId && activeTab === 'memory',
  })

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ['provider-sessions', providerId],
    queryFn: () => fetchProviderSessions(providerId, true),
    enabled: !!providerId && activeTab === 'sessions',
  })

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }
    setIsSearching(true)
    try {
      const results = await searchConversationMemory(providerId, searchQuery)
      setSearchResults(results)
    } finally {
      setIsSearching(false)
    }
  }

  const displayMessages = searchResults || memory || []

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => { setActiveTab('memory'); setSearchResults(null) }}
          className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'memory' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          Conversation Memory
        </button>
        <button
          onClick={() => setActiveTab('sessions')}
          className={`flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            activeTab === 'sessions' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          Sessions
        </button>
      </div>

      {activeTab === 'memory' && (
        <>
          {/* Search */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search conversations semantically..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              onClick={handleSearch}
              disabled={isSearching}
              className="px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>

          {searchResults && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {searchResults.length} results for "{searchQuery}"
              </p>
              <button
                onClick={() => { setSearchResults(null); setSearchQuery('') }}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Clear search
              </button>
            </div>
          )}

          {/* Messages */}
          {memoryLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-gray-300 border-t-gray-900 rounded-full" />
            </div>
          ) : displayMessages.length > 0 ? (
            <div className="space-y-2">
              {displayMessages.map((msg: ConversationMemoryEntry) => (
                <div
                  key={msg.id}
                  className={`border rounded-lg p-3 ${ROLE_STYLES[msg.role] || 'bg-gray-50 border-gray-200'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase text-gray-500">
                        {msg.role}
                      </span>
                      {msg.channel && (
                        <span className="text-xs text-gray-400">
                          via {msg.channel}
                        </span>
                      )}
                      {msg.importance_score > 0.7 && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                          High importance
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(msg.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-800">{msg.message_text}</p>
                  {msg.extracted_entities && Object.keys(msg.extracted_entities).length > 0 && (
                    <div className="mt-2 flex gap-2">
                      {Object.entries(msg.extracted_entities).map(([key, val]) => (
                        <span key={key} className="text-xs bg-white/60 px-2 py-0.5 rounded border border-current/10">
                          {key}: {String(val)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p>No conversation history yet.</p>
            </div>
          )}
        </>
      )}

      {activeTab === 'sessions' && (
        <>
          {sessionsLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin h-6 w-6 border-2 border-gray-300 border-t-gray-900 rounded-full" />
            </div>
          ) : sessions && sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.map((session: ConversationSession) => (
                <div key={session.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-gray-900 text-sm">
                          {session.session_type.replace(/_/g, ' ')}
                        </h4>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            SESSION_STATUS_COLORS[session.status] || 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {session.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        Started by {session.initiated_by} — {session.turn_count} turns
                      </p>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(session.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  {session.summary && (
                    <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">
                      {session.summary}
                    </p>
                  )}
                  {session.topic_stack && session.topic_stack.length > 0 && (
                    <div className="mt-2 flex gap-1">
                      {session.topic_stack.map((topic, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                          {topic}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              <p>No conversation sessions yet.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
