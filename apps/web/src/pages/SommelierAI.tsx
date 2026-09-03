import { useState, useRef, useEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { renderAssistantMarkdown } from '../lib/assistantMarkdown'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send,
  Plus,
  Wine,
  Sparkles,
  RotateCcw,
  Copy,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  Menu,
  X,
  MessageSquare,
  TrendingUp,
  Users,
  Clock,
  Search,
  MoreVertical,
  Pencil,
  Trash2,
  Check,
} from 'lucide-react'
import { useWines } from '../hooks/queries'
import {
  useSommelierConversations,
  useUpsertSommelierConversation,
  useDeleteSommelierConversation,
} from '../hooks/queries/useSommelierQueries'
import { useToast } from '../contexts/ToastContext'
import { mapApiWinesToUiWines } from '../lib/wine-library'
import { formatVolume } from '../utils/volumeUtils'
import { useRestaurantSettingsStore } from '../stores/restaurantSettingsStore'
import { useAuthStore } from '../stores'
import axios from 'axios'
import { getActiveRestaurantId } from '../services/api/client'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
}

const suggestedPrompts = [
  {
    icon: Wine,
    title: 'Wine Pairing',
    prompt: 'What wine pairs best with tonight\'s ribeye steak special?',
  },
  {
    icon: TrendingUp,
    title: 'Sales Analysis',
    prompt: 'Which wines should I push this weekend based on margins?',
  },
  {
    icon: Users,
    title: 'Customer Insights',
    prompt: 'What are the trending preferences among our guests?',
  },
  {
    icon: Clock,
    title: 'Inventory Check',
    prompt: 'Which wines are running low and need reordering?',
  },
]

const MODELS = [
  { id: 'sommelier', label: 'Sommelier', hint: 'Balanced pairing + service' },
  { id: 'buyer', label: 'Buyer', hint: 'Procurement & margins' },
  { id: 'floor', label: 'Floor training', hint: 'Coaching for staff' },
]
const MODEL_KEY = 'wineops.sommelier.model'

export function SommelierAI() {
  const location = useLocation()
  const navigate = useNavigate()
  const { measurementUnit } = useRestaurantSettingsStore()
  const userId = useAuthStore(s => s.user?.userId) ?? ''
  const toast = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const { data: savedConversations = [] } = useSommelierConversations()
  const upsertConversation = useUpsertSommelierConversation()
  const deleteConversation = useDeleteSommelierConversation()

  // Model / persona selector (NEW-254), persisted.
  const [model, setModel] = useState<string>(() => localStorage.getItem(MODEL_KEY) || 'sommelier')
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const chooseModel = (id: string) => {
    setModel(id)
    localStorage.setItem(MODEL_KEY, id)
    setModelMenuOpen(false)
  }
  const activeModel = MODELS.find((m) => m.id === model) ?? MODELS[0]

  // Per-message feedback (NEW-256) + conversation management (NEW-260/261/263).
  const [feedback, setFeedback] = useState<Record<string, 'up' | 'down'>>({})
  const [convSearch, setConvSearch] = useState('')
  const [convMenuId, setConvMenuId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const conversations: Conversation[] = useMemo(
    () =>
      savedConversations.map((c) => ({
        id: c.id,
        title: c.title,
        messages: (c.messages || []).map((m) => ({ ...m, timestamp: new Date(m.timestamp) })),
        createdAt: new Date(c.created_at),
      })),
    [savedConversations],
  )

  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const activeConvIdRef = useRef<string | null>(null)
  const { data: apiWines = [] } = useWines({ limit: 500 })
  const libraryWines = useMemo(() => mapApiWinesToUiWines(apiWines), [apiWines])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Ask-AI re-entry from other pages: `navigate('/sommelier', { state: { prompt } })`
  // prefills (but does not auto-send) so the user can review before asking.
  useEffect(() => {
    const preset = (location.state as { prompt?: string } | null)?.prompt
    if (!preset) return
    setInput(preset)
    inputRef.current?.focus()
    // Clear the router state so back/forward or a refresh doesn't re-prefill.
    navigate(location.pathname, { replace: true, state: null })
    // Only ever meant to run once for the state that arrived with this visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generateResponse = async (userMessage: string): Promise<string> => {
    try {
      const agentOrchestratorUrl = import.meta.env.VITE_AGENT_ORCHESTRATOR_URL || 'http://localhost:8000'
      const restaurantId = getActiveRestaurantId()
      
      // Prepare wine context
      const wineContext = libraryWines.slice(0, 50).map(w => ({
        id: w.id,
        name: w.name,
        type: w.type,
        liveStock: w.liveStock,
        threshold: w.threshold,
        menuPrice: w.menuPrice,
        menuPriceGlass: w.menuPriceGlass,
        price: w.price,
      }))

      // Try calling the sommelier agent via API
      // Note: This endpoint may not exist yet, so we'll handle gracefully
      const response = await axios.post(
        `${agentOrchestratorUrl}/api/v1/sommelier/chat`,
        {
          query: userMessage,
          restaurant_id: restaurantId,
          wine_context: wineContext,
          persona: localStorage.getItem(MODEL_KEY) || 'sommelier',
        },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )

      return response.data?.response || response.data?.message || 'I received your message but could not generate a response.'
    } catch (error: any) {
      // If API call fails (endpoint doesn't exist or service unavailable), show graceful error
      console.error('AI sommelier API error:', error)
      
      // For low stock queries, still provide basic functionality using local data
      const lowerMsg = userMessage.toLowerCase()
      if (lowerMsg.includes('low') || lowerMsg.includes('stock') || lowerMsg.includes('reorder')) {
        const lowStock = libraryWines.filter(w => w.liveStock !== null && w.liveStock <= w.threshold)
        const formatWineName = (w: typeof libraryWines[0]) => {
          const vol = w.bottleSizeMl ? formatVolume(w.bottleSizeMl, measurementUnit) : ''
          return vol ? `${w.name} (${vol})` : w.name
        }
        const formatPrice = (w: typeof libraryWines[0]) => {
          const btl = w.menuPrice ?? (w.price ? Math.round(w.price * 3) : 0)
          if (w.menuPriceGlass) return `$${btl}/btl · $${w.menuPriceGlass}/glass`
          return btl ? `$${btl}` : ''
        }
        
        if (lowStock.length > 0) {
          return `## Low Stock Alert

### 🚨 Critical (Order Immediately)

${lowStock.filter(w => (w.liveStock || 0) <= w.threshold * 0.5).map(w => 
`- **${formatWineName(w)}** - Only ${w.liveStock} left (min: ${w.threshold})
  - Provider: ${w.provider.name}
  - Suggested order: ${w.threshold * 2} bottles${formatPrice(w) ? `\n  - ${formatPrice(w)}` : ''}`
).join('\n')}

### ⚠️ Low Stock (Order This Week)

${lowStock.filter(w => (w.liveStock || 0) > w.threshold * 0.5).map(w =>
`- **${formatWineName(w)}** - ${w.liveStock} left (min: ${w.threshold})`
).join('\n')}

### 📋 Quick Actions
I can help you:
1. Generate purchase orders for all low-stock items
2. Contact suppliers for availability
3. Find alternative wines if items are unavailable

What would you like me to do?`
        }
      }
      
      // Default error message
      return `I'm sorry, but the AI sommelier is currently unavailable. Please try again later.

If you need immediate assistance, you can:
- Check your inventory in the Inventory page
- View reports in the Reports page
- Contact support if the issue persists`
    }
  }

  const persistConversation = (allMessages: Message[], convId: string, title: string) => {
    if (!userId) return
    upsertConversation.mutate({
      id: convId,
      user_id: userId,
      title,
      messages: allMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp.toISOString(),
      })),
    })
  }

  const handleSend = async () => {
    if (!input.trim() || isTyping) return
    
    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    let convId = activeConvIdRef.current
    if (!convId) {
      convId = crypto.randomUUID()
      activeConvIdRef.current = convId
    }
    
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsTyping(true)
    
    try {
      const response = await generateResponse(userMessage.content)
      
      const assistantMessage: Message = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      }
      
      setMessages(prev => {
        const updated = [...prev, assistantMessage]
        const title = userMessage.content.slice(0, 60) || 'New Chat'
        persistConversation(updated, convId!, title)
        return updated
      })
    } catch (error) {
      console.error('Error generating response:', error)
    } finally {
      setIsTyping(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const startNewChat = () => {
    setMessages([])
    setActiveConversation(null)
    activeConvIdRef.current = null
  }

  const loadConversation = (conv: Conversation) => {
    setActiveConversation(conv)
    setMessages(conv.messages)
    activeConvIdRef.current = conv.id
  }

  const handlePromptClick = (prompt: string) => {
    setInput(prompt)
    inputRef.current?.focus()
  }

  // ── Message actions (NEW-255/256/257) ────────────────────────────────────
  const copyMessage = (content: string) => {
    navigator.clipboard?.writeText(content)
    toast.success('Copied to clipboard')
  }
  const setMsgFeedback = (id: string, value: 'up' | 'down') => {
    setFeedback((prev) => ({ ...prev, [id]: prev[id] === value ? (undefined as any) : value }))
  }
  const regenerateMessage = async (assistantId: string) => {
    if (isTyping) return
    const idx = messages.findIndex((m) => m.id === assistantId)
    if (idx < 1) return
    const userMsg = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user')
    if (!userMsg) return
    setMessages(messages.slice(0, idx))
    setIsTyping(true)
    try {
      const response = await generateResponse(userMsg.content)
      setMessages((prev) => {
        const updated = [...prev, { id: `msg-${Date.now()}`, role: 'assistant' as const, content: response, timestamp: new Date() }]
        const convId = activeConvIdRef.current
        if (convId) persistConversation(updated, convId, updated.find((m) => m.role === 'user')?.content.slice(0, 60) || 'New Chat')
        return updated
      })
    } finally {
      setIsTyping(false)
    }
  }

  // ── Conversation management (NEW-260/261/263) ────────────────────────────
  const filteredConversations = useMemo(() => {
    const q = convSearch.trim().toLowerCase()
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations
  }, [conversations, convSearch])

  const startRename = (conv: Conversation) => {
    setRenamingId(conv.id)
    setRenameValue(conv.title)
    setConvMenuId(null)
  }
  const commitRename = (conv: Conversation) => {
    const title = renameValue.trim() || conv.title
    upsertConversation.mutate({
      id: conv.id,
      user_id: userId,
      title,
      messages: conv.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp.toISOString() })),
    })
    if (activeConversation?.id === conv.id) setActiveConversation({ ...activeConversation, title })
    setRenamingId(null)
  }
  const handleDeleteConv = (conv: Conversation) => {
    setConvMenuId(null)
    if (!window.confirm(`Delete "${conv.title}"? This can't be undone.`)) return
    deleteConversation.mutate(conv.id, {
      onSuccess: () => toast.success('Conversation deleted'),
    })
    if (activeConvIdRef.current === conv.id) startNewChat()
  }

  // Close popovers on outside click.
  useEffect(() => {
    if (!convMenuId && !modelMenuOpen) return
    const close = () => { setConvMenuId(null); setModelMenuOpen(false) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [convMenuId, modelMenuOpen])

  return (
    <div className="h-screen flex bg-[#212121] overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-[#171717] flex flex-col h-full border-r border-white/10"
            data-tour="sommelier-history"
          >
            {/* New Chat Button */}
            <div className="p-3">
              <button
                onClick={startNewChat}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg border border-white/20 hover:bg-white/5 transition-colors text-white"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm">New chat</span>
              </button>
            </div>

            {/* Search (NEW-263) */}
            <div className="px-3 pb-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
                <input
                  value={convSearch}
                  onChange={(e) => setConvSearch(e.target.value)}
                  placeholder="Search chats"
                  className="w-full h-8 pl-8 pr-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 outline-none focus:border-white/20"
                />
              </div>
            </div>

            {/* Conversation History */}
            <div className="flex-1 overflow-y-auto px-2">
              <div className="px-2 py-1">
                <p className="text-xs text-gray-500 font-medium">Recent</p>
              </div>
              {filteredConversations.length === 0 && (
                <p className="px-3 py-2 text-xs text-gray-600">
                  {convSearch ? 'No matching chats' : 'No conversations yet'}
                </p>
              )}
              {filteredConversations.map((conv) => (
                <div key={conv.id} className="relative group mb-1">
                  {renamingId === conv.id ? (
                    <div className="flex items-center gap-1 px-2 py-1.5">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(conv)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        className="flex-1 h-7 px-2 bg-white/10 border border-white/20 rounded text-sm text-white outline-none"
                      />
                      <button onClick={() => commitRename(conv)} className="p-1 text-emerald-400 hover:bg-white/10 rounded" aria-label="Save name">
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => loadConversation(conv)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 pr-8 rounded-lg text-left transition-colors ${
                          activeConversation?.id === conv.id
                            ? 'bg-white/10 text-white'
                            : 'text-gray-400 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <MessageSquare className="w-4 h-4 flex-shrink-0" />
                        <span className="text-sm truncate">{conv.title}</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConvMenuId(convMenuId === conv.id ? null : conv.id) }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-gray-500 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 focus:opacity-100"
                        aria-label="Conversation options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {convMenuId === conv.id && (
                        <div className="absolute right-1 top-9 z-50 w-36 bg-[#2f2f2f] border border-white/10 rounded-lg shadow-xl p-1" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => startRename(conv)} className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-sm text-gray-300 hover:bg-white/5 rounded">
                            <Pencil className="w-3.5 h-3.5" /> Rename
                          </button>
                          <button onClick={() => handleDeleteConv(conv)} className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-sm text-rose-400 hover:bg-white/5 rounded">
                            <Trash2 className="w-3.5 h-3.5" /> Delete
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Bottom Section */}
            <div className="p-3 border-t border-white/10">
              <div className="flex items-center gap-3 px-3 py-2 text-gray-400">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-sm font-medium">
                  S
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">Sommelier AI</p>
                  <p className="text-xs text-gray-500">Wine Intelligence</p>
                </div>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-2 p-2 border-b border-white/10">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-gray-400"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <div className="relative" data-tour="sommelier-persona">
            <button
              onClick={(e) => { e.stopPropagation(); setModelMenuOpen((o) => !o) }}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 rounded-lg transition-colors"
              aria-haspopup="menu"
              aria-expanded={modelMenuOpen}
            >
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-white font-medium">Sommelier AI</span>
              <span className="text-gray-500 text-sm">· {activeModel.label}</span>
              <ChevronDown className="w-4 h-4 text-gray-500" />
            </button>
            {modelMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 mt-1 w-60 bg-[#2f2f2f] border border-white/10 rounded-xl shadow-xl p-1 z-50"
                onClick={(e) => e.stopPropagation()}
              >
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    role="menuitemradio"
                    aria-checked={m.id === model}
                    onClick={() => chooseModel(m.id)}
                    className="flex items-start gap-2 w-full text-left px-3 py-2 rounded-lg hover:bg-white/5"
                  >
                    <div className="flex-1">
                      <p className="text-sm text-white">{m.label}</p>
                      <p className="text-xs text-gray-500">{m.hint}</p>
                    </div>
                    {m.id === model && <Check className="w-4 h-4 text-purple-400 mt-0.5" />}
                  </button>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            /* Empty State */
            <div className="h-full flex flex-col items-center justify-center px-4">
              <div className="max-w-2xl w-full">
                {/* Logo */}
                <div className="text-center mb-8">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-purple-500 to-pink-600 rounded-2xl flex items-center justify-center">
                    <Wine className="w-8 h-8 text-white" />
                  </div>
                  <h1 className="text-2xl font-semibold text-white mb-2">How can I help you today?</h1>
                  <p className="text-gray-400">I'm your AI sommelier assistant for wine pairings, recommendations, and insights.</p>
                </div>

                {/* Suggested Prompts */}
                <div className="grid grid-cols-2 gap-3" data-tour="sommelier-prompts">
                  {suggestedPrompts.map((item, index) => {
                    const Icon = item.icon
                    return (
                      <button
                        key={index}
                        onClick={() => handlePromptClick(item.prompt)}
                        className="flex flex-col items-start gap-2 p-4 rounded-xl border border-white/10 hover:bg-white/5 transition-colors text-left group"
                      >
                        <Icon className="w-5 h-5 text-gray-400 group-hover:text-purple-400 transition-colors" />
                        <div>
                          <p className="text-sm font-medium text-white">{item.title}</p>
                          <p className="text-xs text-gray-500 line-clamp-2">{item.prompt}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* Messages */
            <div className="max-w-3xl mx-auto py-6 px-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`mb-6 ${message.role === 'user' ? 'flex justify-end' : ''}`}
                >
                  {message.role === 'user' ? (
                    <div className="max-w-[85%] bg-[#2f2f2f] rounded-2xl px-4 py-3">
                      <p className="text-white whitespace-pre-wrap">{message.content}</p>
                    </div>
                  ) : (
                    <div className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center flex-shrink-0">
                        <Sparkles className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="prose prose-invert prose-sm max-w-none">
                          <div 
                            className="text-gray-200 whitespace-pre-wrap"
                            dangerouslySetInnerHTML={{ 
                              __html: renderAssistantMarkdown(message.content)
                            }}
                          />
                        </div>
                        
                        {/* Message Actions */}
                        <div className="flex items-center gap-1 mt-3">
                          <button
                            onClick={() => copyMessage(message.content)}
                            title="Copy"
                            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-gray-500 hover:text-white"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setMsgFeedback(message.id, 'up')}
                            title="Helpful"
                            className={`p-1.5 hover:bg-white/10 rounded-lg transition-colors ${feedback[message.id] === 'up' ? 'text-emerald-400' : 'text-gray-500 hover:text-white'}`}
                          >
                            <ThumbsUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setMsgFeedback(message.id, 'down')}
                            title="Not helpful"
                            className={`p-1.5 hover:bg-white/10 rounded-lg transition-colors ${feedback[message.id] === 'down' ? 'text-rose-400' : 'text-gray-500 hover:text-white'}`}
                          >
                            <ThumbsDown className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => regenerateMessage(message.id)}
                            disabled={isTyping}
                            title="Regenerate"
                            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-gray-500 hover:text-white disabled:opacity-40"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              
              {/* Typing Indicator */}
              {isTyping && (
                <div className="flex gap-4 mb-6">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center flex-shrink-0">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex items-center gap-1 py-3">
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-white/10">
          <div className="max-w-3xl mx-auto">
            <div
              className="relative bg-[#2f2f2f] rounded-2xl border border-white/10 focus-within:border-white/20 transition-colors"
              data-tour="sommelier-input"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about wine pairings, recommendations, or insights..."
                rows={1}
                className="w-full bg-transparent text-white placeholder-gray-500 px-4 py-3.5 pr-12 resize-none focus:outline-none max-h-48"
                style={{ minHeight: '52px' }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || isTyping}
                className="absolute right-2 bottom-2 p-2 bg-white rounded-lg text-black hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-600 text-center mt-2">
              Sommelier AI uses your inventory and sales data to provide intelligent recommendations.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
export default SommelierAI
