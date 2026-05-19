import { useState, useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  Wine,
  Package,
  TrendingUp,
  Calendar,
  Eye,
  EyeOff,
  Archive,
  Trash2,
  Star,
  Filter,
  Search,
  CheckSquare,
  Square,
  Zap,
  ArrowRight,
  X,
  Settings,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Clock,
  MoreVertical,
  Plus,
  Link as LinkIcon,
  MessageSquare,
  Mail,
} from 'lucide-react'
import { useNotifications, useMarkNotificationAsRead, useMarkAllNotificationsAsRead, useArchiveNotification, useDeleteNotification } from '../hooks/queries'
import { useAuthStore } from '../stores'
import { OneTapActionCenter } from '../components/notifications/OneTapActionCenter'
import type { Notification, NotificationType } from '../services/api/notifications'

type NotificationStatus = 'unread' | 'read'
type NotificationPriority = 'low' | 'medium' | 'high' | 'critical'

// Helper function for timestamp formatting
const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

interface CustomOneTapAction {
  id: string
  title: string
  description: string
  icon: string
  actionUrl: string
  priority: 'low' | 'medium' | 'high'
  color: string
  createdAt: string
}

export function Notifications() {
  const user = useAuthStore(state => state.user)
  const location = useLocation()
  const [filter, setFilter] = useState<'all' | NotificationStatus>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | NotificationPriority>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNotifications, setSelectedNotifications] = useState<Set<string>>(new Set())
  const [batchMode, setBatchMode] = useState(false)
  const [selectedNotification, setSelectedNotification] = useState<Notification | null>(null)
  const [starredNotifications, setStarredNotifications] = useState<Set<string>>(new Set())
  const [showOneTap, setShowOneTap] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [detailRequestStatus, setDetailRequestStatus] = useState<Record<string, 'idle' | 'sending' | 'sent'>>({})
  
  // Fetch notifications from API
  const { data: rawNotifications, isLoading: _isLoading, error: _error, refetch } = useNotifications(user?.userId || '', {
    status: filter === 'all' ? undefined : filter,
  })
  const notifications: Notification[] = Array.isArray(rawNotifications) ? rawNotifications : []
  const markAsRead = useMarkNotificationAsRead()
  const markAllAsRead = useMarkAllNotificationsAsRead()
  const archiveNotificationMutation = useArchiveNotification()
  const deleteNotification = useDeleteNotification()

  // Create One-Tap Action Modal State
  const [showCreateActionModal, setShowCreateActionModal] = useState(false)
  const [customActions, setCustomActions] = useState<CustomOneTapAction[]>([])
  const [newAction, setNewAction] = useState({
    title: '',
    description: '',
    icon: 'Zap',
    actionUrl: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
    color: 'wine'
  })

  // Auto-open detail panel when navigated from the bell icon
  useEffect(() => {
    const state = location.state as { selectedNotificationId?: string } | null
    if (!state?.selectedNotificationId || notifications.length === 0) return
    const target = notifications.find((n) => n.id === state.selectedNotificationId)
    if (target) setSelectedNotification(target)
  }, [location.state, notifications])

  // Auto-refresh simulation - MOVED BEFORE CONDITIONAL RETURNS
  useEffect(() => {
    const interval = setInterval(() => {
      setLastRefresh(new Date())
      refetch()
    }, 60000) // Every minute
    return () => clearInterval(interval)
  }, [refetch])

  const filteredNotifications = useMemo(() => {
    const safeNotifications = Array.isArray(notifications) ? notifications : []
    return safeNotifications.filter(n => {
      const matchesFilter = filter === 'all' || n.status === filter
      const matchesPriority = priorityFilter === 'all' || n.priority === priorityFilter
      const matchesSearch = n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                           n.message.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesFilter && matchesPriority && matchesSearch
    }).sort((a, b) => {
      // Starred first
      const aStarred = starredNotifications.has(a.id)
      const bStarred = starredNotifications.has(b.id)
      if (aStarred && !bStarred) return -1
      if (!aStarred && bStarred) return 1
      
      // Then by priority
      const priorityOrder: Record<NotificationPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }
      const priorityDiff = (priorityOrder[a.priority as NotificationPriority] ?? 99) - (priorityOrder[b.priority as NotificationPriority] ?? 99)
      if (priorityDiff !== 0) return priorityDiff
      
      // Finally by timestamp
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    })
  }, [notifications, filter, priorityFilter, searchQuery, starredNotifications])

  // Smart grouping
  const groupedNotifications = useMemo(() => {
    const groups: { [key: string]: Notification[] } = {
      starred: [],
      today: [],
      yesterday: [],
      thisWeek: [],
      older: []
    }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 3600000)
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 3600000)

    filteredNotifications.forEach(notif => {
      const notifDate = new Date(notif.timestamp)
      
      if (starredNotifications.has(notif.id)) {
        groups.starred.push(notif)
      } else if (notifDate >= todayStart) {
        groups.today.push(notif)
      } else if (notifDate >= yesterdayStart) {
        groups.yesterday.push(notif)
      } else if (notifDate >= weekStart) {
        groups.thisWeek.push(notif)
      } else {
        groups.older.push(notif)
      }
    })

    return groups
  }, [filteredNotifications, starredNotifications])

  const stats = useMemo(() => {
    const safeNotifications = Array.isArray(notifications) ? notifications : []
    const unread = safeNotifications.filter(n => n.status === 'unread').length
    const urgent = safeNotifications.filter(n => n.priority === 'critical' && n.status === 'unread').length
    const starred = starredNotifications.size
    const today = safeNotifications.filter(n => {
      const notifDate = new Date(n.timestamp)
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      return notifDate >= todayStart
    }).length

    return { unread, urgent, starred, today }
  }, [notifications, starredNotifications])

  const getTypeConfig = (type: NotificationType) => {
    const configs: Record<string, { icon: any; bg: string; text: string; border: string }> = {
      info: { icon: Info, bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-400' },
      success: { icon: CheckCircle2, bg: 'bg-emerald-100', text: 'text-emerald-600', border: 'border-emerald-400' },
      warning: { icon: AlertTriangle, bg: 'bg-amber-100', text: 'text-amber-600', border: 'border-amber-400' },
      alert: { icon: Bell, bg: 'bg-rose-100', text: 'text-rose-600', border: 'border-rose-400' },
      order: { icon: TrendingUp, bg: 'bg-indigo-100', text: 'text-indigo-600', border: 'border-indigo-400' },
      inventory: { icon: Package, bg: 'bg-purple-100', text: 'text-purple-600', border: 'border-purple-400' },
      report: { icon: Calendar, bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-400' },
      reminder: { icon: Bell, bg: 'bg-orange-100', text: 'text-orange-600', border: 'border-orange-400' },
      event: { icon: Calendar, bg: 'bg-cyan-100', text: 'text-cyan-600', border: 'border-cyan-400' },
      // Phase 32 AI draft types
      draft_ready: { icon: Mail, bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-400' },
      constraint_triggered: { icon: AlertTriangle, bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-400' },
      unknown_sender: { icon: Mail, bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-400' },
      invoice_received: { icon: Package, bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-400' },
      // API type names
      inventory_low_stock: { icon: Package, bg: 'bg-purple-100', text: 'text-purple-600', border: 'border-purple-400' },
      order_pending: { icon: TrendingUp, bg: 'bg-indigo-100', text: 'text-indigo-600', border: 'border-indigo-400' },
      order_delivered: { icon: CheckCircle2, bg: 'bg-emerald-100', text: 'text-emerald-600', border: 'border-emerald-400' },
      price_change: { icon: TrendingUp, bg: 'bg-amber-100', text: 'text-amber-600', border: 'border-amber-400' },
      delivery_scheduled: { icon: Calendar, bg: 'bg-cyan-100', text: 'text-cyan-600', border: 'border-cyan-400' },
      calendar_reminder: { icon: Bell, bg: 'bg-orange-100', text: 'text-orange-600', border: 'border-orange-400' },
      system: { icon: Info, bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-400' },
      ai_suggestion: { icon: Info, bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-400' },
    }
    return configs[type] || configs.info
  }

  const getDetailPrompt = (type: NotificationType) => {
    switch (type) {
      case 'order_pending':
        return 'Request provider quote details and delivery timing.'
      case 'order_delivered':
        return 'Request delivery confirmation and invoice details.'
      case 'inventory_low_stock':
        return 'Request inventory usage trends and reorder recommendations.'
      case 'price_change':
        return 'Request price change rationale and alternatives.'
      case 'delivery_scheduled':
        return 'Request delivery window and contact details.'
      case 'calendar_reminder':
        return 'Request event notes and attendee list.'
      case 'ai_suggestion':
        return 'Request the AI reasoning and data sources.'
      case 'draft_ready':
        return 'Click "Review & Approve Draft" to open the email compose view.'
      case 'constraint_triggered':
        return 'A business rule blocked automatic sending. Manager action required.'
      case 'unknown_sender':
        return 'An unrecognised sender emailed. Decide whether to add them as a provider.'
      case 'invoice_received':
        return 'An invoice arrived. Confirm the order match or create a retroactive order.'
      case 'system':
      default:
        return 'Request additional context for this notification.'
    }
  }

  const handleRequestDetails = (notification: Notification) => {
    setDetailRequestStatus(prev => ({ ...prev, [notification.id]: 'sending' }))
    setTimeout(() => {
      setDetailRequestStatus(prev => ({ ...prev, [notification.id]: 'sent' }))
    }, 700)
  }

  const getPriorityColor = (priority: NotificationPriority) => {
    const colors: Record<NotificationPriority, string> = {
      low: 'border-l-gray-300',
      medium: 'border-l-blue-400',
      high: 'border-l-amber-500',
      critical: 'border-l-rose-600',
    }
    return colors[priority] ?? 'border-l-gray-300'
  }

  // API wrappers for notification actions (refetch to sync UI)
  const handleMarkAsRead = async (id: string) => {
    await markAsRead.mutateAsync(id)
    await refetch()
  }

  const handleArchiveNotification = async (id: string) => {
    await archiveNotificationMutation.mutateAsync(id)
    await refetch()
  }

  const handleDeleteNotification = async (id: string) => {
    await deleteNotification.mutateAsync(id)
    await refetch()
  }

  const handleNotificationClick = (notification: Notification) => {
    if (!batchMode) {
      setSelectedNotification(notification)
      if (notification.status === 'unread') {
        void handleMarkAsRead(notification.id)
      }
    }
  }

  const toggleNotificationSelection = (id: string) => {
    setSelectedNotifications(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  const toggleStar = (id: string) => {
    setStarredNotifications(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  const handleMarkAllAsRead = async () => {
    if (!user?.userId) return
    await markAllAsRead.mutateAsync(user.userId)
    await refetch()
  }

  const handleQuickAction = (notification: Notification) => {
    void handleMarkAsRead(notification.id)
    if (notification.actionUrl) {
      window.location.href = notification.actionUrl
    }
  }

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault()
    setContextMenu({ id, x: e.clientX, y: e.clientY })
  }

  const handleBatchAction = async (action: 'read' | 'archive' | 'delete') => {
    const ids = Array.from(selectedNotifications)
    await Promise.all(
      ids.map((id) => {
        if (action === 'read') return markAsRead.mutateAsync(id)
        if (action === 'archive') return archiveNotificationMutation.mutateAsync(id)
        if (action === 'delete') return deleteNotification.mutateAsync(id)
        return Promise.resolve()
      })
    )
    setSelectedNotifications(new Set())
    await refetch()
  }

  const selectAllInGroup = (group: Notification[]) => {
    setSelectedNotifications(new Set(group.map(n => n.id)))
  }

  // Handle Create One-Tap Action
  const handleCreateAction = () => {
    if (!newAction.title || !newAction.actionUrl) {
      alert('Please fill in all required fields')
      return
    }

    const action: CustomOneTapAction = {
      id: `custom_${Date.now()}`,
      title: newAction.title,
      description: newAction.description,
      icon: newAction.icon,
      actionUrl: newAction.actionUrl,
      priority: newAction.priority,
      color: newAction.color,
      createdAt: new Date().toISOString(),
    }

    setCustomActions(prev => [action, ...prev])
    setShowCreateActionModal(false)
    setNewAction({
      title: '',
      description: '',
      icon: 'Zap',
      actionUrl: '',
      priority: 'medium',
      color: 'wine'
    })
  }

  const colorOptions = [
    { name: 'Wine', value: 'wine', bg: 'bg-wine-600', text: 'text-white' },
    { name: 'Emerald', value: 'emerald', bg: 'bg-emerald-600', text: 'text-white' },
    { name: 'Blue', value: 'blue', bg: 'bg-blue-600', text: 'text-white' },
    { name: 'Amber', value: 'amber', bg: 'bg-amber-600', text: 'text-white' },
    { name: 'Rose', value: 'rose', bg: 'bg-rose-600', text: 'text-white' },
    { name: 'Purple', value: 'purple', bg: 'bg-purple-600', text: 'text-white' },
  ]

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="relative p-3 bg-wine-100 rounded-xl">
              <Bell className="w-6 h-6 text-wine-600" />
              {stats.urgent > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-xs font-bold rounded-full flex items-center justify-center animate-pulse">
                  {stats.urgent}
                </span>
              )}
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Notifications & Actions</h1>
              <p className="text-sm text-gray-600">
                {stats.unread} unread • {stats.starred} starred • Last updated {formatTimestamp(lastRefresh.toISOString())}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateActionModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-wine-600 text-white rounded-lg hover:bg-wine-700 transition-colors shadow-lg"
              title="Create One-Tap Action (⌘N)"
            >
              <Plus className="w-5 h-5" />
              <span className="font-medium hidden md:inline">Create Action</span>
            </button>
            <button
              onClick={() => setLastRefresh(new Date())}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-5 h-5 text-gray-600" />
            </button>
            <button
              onClick={() => window.location.href = '/notifications?tab=settings'}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Settings"
            >
              <Settings className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Unread</p>
                <p className="text-2xl font-bold text-wine-600">{stats.unread}</p>
              </div>
              <div className="p-2 bg-wine-100 rounded-lg">
                <Bell className="w-5 h-5 text-wine-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Urgent</p>
                <p className="text-2xl font-bold text-rose-600">{stats.urgent}</p>
              </div>
              <div className="p-2 bg-rose-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-rose-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Starred</p>
                <p className="text-2xl font-bold text-amber-600">{stats.starred}</p>
              </div>
              <div className="p-2 bg-amber-100 rounded-lg">
                <Star className="w-5 h-5 text-amber-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Today</p>
                <p className="text-2xl font-bold text-blue-600">{stats.today}</p>
              </div>
              <div className="p-2 bg-blue-100 rounded-lg">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Custom Actions Display */}
        {customActions.length > 0 && (
          <div className="mb-6 bg-gradient-to-r from-wine-50 to-purple-50 rounded-2xl p-5 border border-wine-200">
            <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Zap className="w-5 h-5 text-wine-600" />
              Your Custom Actions ({customActions.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {customActions.map(action => {
                const colorConfig = colorOptions.find(c => c.value === action.color)
                return (
                  <button
                    key={action.id}
                    onClick={() => window.location.href = action.actionUrl}
                    className={`${colorConfig?.bg} ${colorConfig?.text} rounded-xl p-4 text-left hover:scale-105 transition-transform shadow-lg`}
                  >
                    <div className="flex items-center gap-3">
                      <Zap className="w-6 h-6" />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold truncate">{action.title}</h4>
                        <p className="text-sm opacity-90 truncate">{action.description}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* One-Tap Action Center */}
        <AnimatePresence>
          {showOneTap && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 overflow-hidden"
            >
              <OneTapActionCenter />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Toggle One-Tap */}
        <button
          onClick={() => setShowOneTap(!showOneTap)}
          className="w-full flex items-center justify-center gap-2 mb-6 py-2 text-sm text-wine-600 hover:text-wine-700 font-medium transition-colors"
        >
          {showOneTap ? (
            <>
              <ChevronUp className="w-4 h-4" />
              Hide One-Tap Actions
            </>
          ) : (
            <>
              <ChevronDown className="w-4 h-4" />
              Show One-Tap Actions ({stats.urgent} urgent)
            </>
          )}
        </button>
      </div>

      {/* Filters and Search */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search notifications... (⌘K for filters)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'unread', 'read', 'archived'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f as 'all' | NotificationStatus)}
                className={`px-4 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                  filter === f
                    ? 'bg-wine-600 text-white shadow-lg shadow-wine-600/30'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2.5 rounded-lg transition-colors ${
                showFilters ? 'bg-wine-100 text-wine-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Advanced Filters (⌘K)"
            >
              <Filter className="w-5 h-5" />
            </button>
            <button
              onClick={() => setBatchMode(!batchMode)}
              className={`p-2.5 rounded-lg transition-colors ${
                batchMode ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title="Batch Mode (⌘B)"
            >
              <CheckSquare className="w-5 h-5" />
            </button>
            <button
              onClick={handleMarkAllAsRead}
              disabled={stats.unread === 0}
              className="px-4 py-2.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Mark All Read
            </button>
          </div>
        </div>

        {/* Extended Filters */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-4 pt-4 border-t border-gray-200 overflow-hidden"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Priority</label>
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value as any)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500"
                  >
                    <option value="all">All Priorities</option>
                    <option value="urgent">Urgent Only</option>
                    <option value="high">High Only</option>
                    <option value="medium">Medium Only</option>
                    <option value="low">Low Only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Quick Filters</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setFilter('unread')
                        setPriorityFilter('critical')
                      }}
                      className="flex-1 px-3 py-2 bg-rose-100 text-rose-700 rounded-lg hover:bg-rose-200 text-sm font-medium transition-colors"
                    >
                      Urgent Unread
                    </button>
                    <button
                      onClick={() => {
                        setFilter('all')
                      }}
                      className="flex-1 px-3 py-2 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 text-sm font-medium transition-colors"
                    >
                      Starred Only
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {batchMode && selectedNotifications.size > 0 && (
          <div className="mt-4 flex items-center gap-2 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
            <span className="text-sm font-medium text-emerald-900">
              {selectedNotifications.size} selected
            </span>
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => handleBatchAction('read')}
                className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Mark Read
              </button>
              <button
                onClick={() => handleBatchAction('archive')}
                className="px-3 py-1.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
              >
                Archive
              </button>
              <button
                onClick={() => handleBatchAction('delete')}
                className="px-3 py-1.5 bg-rose-600 text-white rounded-lg hover:bg-rose-700 text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Notifications List - Grouped */}
      <div className="space-y-6">
        {filteredNotifications.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
            <Bell className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No notifications</h3>
            <p className="text-gray-600">You're all caught up!</p>
          </div>
        ) : (
          Object.entries(groupedNotifications).map(([groupKey, groupNotifications]) => {
            if (groupNotifications.length === 0) return null

            const groupLabels: { [key: string]: string } = {
              starred: `⭐ Starred (${groupNotifications.length})`,
              today: `Today (${groupNotifications.length})`,
              yesterday: `Yesterday (${groupNotifications.length})`,
              thisWeek: `This Week (${groupNotifications.length})`,
              older: `Older (${groupNotifications.length})`
            }

            return (
              <div key={groupKey}>
                {/* Group Header */}
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wide flex items-center gap-2">
                    {groupLabels[groupKey]}
                  </h3>
                  <div className="flex items-center gap-2">
                    {batchMode && (
                      <button
                        onClick={() => selectAllInGroup(groupNotifications)}
                        className="text-xs text-wine-600 hover:text-wine-700 font-medium"
                      >
                        Select All
                      </button>
                    )}
                    <div className="h-px flex-1 bg-gray-200 min-w-[100px]"></div>
                  </div>
                </div>

                {/* Group Notifications */}
                <div className="space-y-3">
                  {groupNotifications.map((notification, index) => {
                    const typeConfig = getTypeConfig(notification.type)
                    const TypeIcon = typeConfig.icon
                    const isUnread = notification.status === 'unread'
                    const isSelected = selectedNotifications.has(notification.id)
                    const isStarred = starredNotifications.has(notification.id)

                    return (
                      <motion.div
                        key={notification.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                        onClick={() => handleNotificationClick(notification)}
                        onContextMenu={(e) => handleContextMenu(e, notification.id)}
                        className={`relative bg-white rounded-xl p-4 shadow-sm border-l-4 ${getPriorityColor(notification.priority)} ${
                          isUnread ? 'border border-wine-200 bg-wine-50/30' : 
                          isSelected ? 'border border-emerald-200 bg-emerald-50/30' :
                          'border border-gray-100'
                        } hover:shadow-lg hover:scale-[1.01] transition-all cursor-pointer group`}
                      >
                        <div className="flex items-start gap-4">
                          {batchMode && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleNotificationSelection(notification.id)
                              }}
                              className="mt-1"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-5 h-5 text-emerald-600" />
                              ) : (
                                <Square className="w-5 h-5 text-gray-400" />
                              )}
                            </button>
                          )}

                          <div className={`p-3 ${typeConfig.bg} rounded-lg flex-shrink-0`}>
                            <TypeIcon className={`w-5 h-5 ${typeConfig.text}`} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-4 mb-1">
                              <div className="flex items-center gap-2">
                                <h3 className={`font-semibold ${isUnread ? 'text-gray-900' : 'text-gray-700'}`}>
                                  {notification.title}
                                </h3>
                                {isUnread && (
                                  <span className="w-2 h-2 bg-wine-600 rounded-full"></span>
                                )}
                              </div>
                              <span className="text-xs text-gray-500 whitespace-nowrap">
                                {formatTimestamp(notification.timestamp)}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 mb-2">{notification.message}</p>
                            
                            {notification.metadata && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {notification.metadata.wineName && (
                                  <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                                    <Wine className="w-3 h-3 inline mr-1" />
                                    {notification.metadata.wineName}
                                  </span>
                                )}
                                {notification.metadata.quantity && (
                                  <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                                    {notification.metadata.quantity} bottles
                                  </span>
                                )}
                                {notification.metadata.provider && (
                                  <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                                    {notification.metadata.provider}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0">
                            {/* Priority Badge */}
                            {notification.priority === 'critical' && (
                              <span className="px-2 py-1 bg-rose-100 text-rose-700 rounded-full text-xs font-bold mr-2">
                                CRITICAL
                              </span>
                            )}

                            {/* Star Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleStar(notification.id)
                              }}
                              className="p-2 hover:bg-amber-50 rounded-lg transition-colors"
                              title={isStarred ? "Unstar" : "Star"}
                            >
                              <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400 text-amber-400' : 'text-gray-400'}`} />
                            </button>

                            {/* Quick Action Button */}
                            {notification.actionUrl && !batchMode && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleQuickAction(notification)
                                }}
                                className="p-2 bg-wine-600 text-white hover:bg-wine-700 rounded-lg transition-all opacity-0 group-hover:opacity-100 flex items-center gap-1"
                                title="Quick action"
                              >
                                <Zap className="w-4 h-4" />
                                <span className="text-xs font-medium hidden md:inline">Action</span>
                              </button>
                            )}
                            
                            {/* Read/Unread Toggle */}
                            {isUnread ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void handleMarkAsRead(notification.id)
                                }}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                                title="Mark as read"
                              >
                                <Eye className="w-4 h-4 text-gray-400" />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  // TODO: Add mark-as-unread API endpoint and mutation
                                  console.log('Mark as unread not implemented yet')
                                }}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                title="Mark as unread (coming soon)"
                                disabled
                              >
                                <EyeOff className="w-4 h-4 text-gray-300" />
                              </button>
                            )}
                            
                            {/* Archive Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleArchiveNotification(notification.id)
                              }}
                              className="p-2 hover:bg-blue-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                              title="Archive"
                            >
                              <Archive className="w-4 h-4 text-blue-400" />
                            </button>
                            
                            {/* Delete Button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleDeleteNotification(notification.id)
                              }}
                              className="p-2 hover:bg-rose-100 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4 text-rose-500" />
                            </button>

                            {/* More Options */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleContextMenu(e, notification.id)
                              }}
                              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                              title="More options"
                            >
                              <MoreVertical className="w-4 h-4 text-gray-400" />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Notification Detail Modal */}
      <AnimatePresence>
        {selectedNotification && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedNotification(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <h2 className="text-2xl font-bold text-gray-900">{selectedNotification?.title}</h2>
                  <button
                    onClick={() => setSelectedNotification(null)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <p className="text-gray-600 mb-4">{selectedNotification?.message}</p>
                <div className="text-sm text-gray-500">
                  {selectedNotification && formatTimestamp(selectedNotification.timestamp)}
                </div>
                {selectedNotification && (
                  <div className="mt-5 flex flex-col gap-2">
                    <button
                      onClick={() => handleRequestDetails(selectedNotification)}
                      disabled={detailRequestStatus[selectedNotification.id] === 'sending' || detailRequestStatus[selectedNotification.id] === 'sent'}
                      className="inline-flex items-center gap-2 px-4 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <MessageSquare className="w-4 h-4" />
                      {detailRequestStatus[selectedNotification.id] === 'sending'
                        ? 'Requesting details...'
                        : detailRequestStatus[selectedNotification.id] === 'sent'
                          ? 'Details requested'
                          : 'Ask for more details'}
                    </button>
                    <p className="text-xs text-gray-500">
                      {getDetailPrompt(selectedNotification.type)}
                    </p>
                  </div>
                )}
                {selectedNotification?.type === 'draft_ready' && selectedNotification.metadata?.conversation_id && (
                  <div className="mt-6 flex flex-col gap-2">
                    <a
                      href={`/orders?draft=${selectedNotification.metadata.conversation_id}`}
                      className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-700 text-white rounded-lg hover:bg-indigo-800 transition-colors font-medium"
                    >
                      <Mail className="w-4 h-4" />
                      Review &amp; Approve Draft
                    </a>
                    {selectedNotification.metadata.email_type && (
                      <p className="text-xs text-gray-500">
                        {(selectedNotification.metadata.email_type as string).replace(/_/g, ' ')} ·{' '}
                        {selectedNotification.metadata.wine_name || ''}
                        {selectedNotification.metadata.provider_name
                          ? ` · ${selectedNotification.metadata.provider_name}`
                          : ''}
                      </p>
                    )}
                  </div>
                )}
                {selectedNotification?.actionUrl && selectedNotification.type !== 'draft_ready' && (
                  <div className="mt-6">
                    <a
                      href={selectedNotification.actionUrl}
                      className="inline-flex items-center gap-2 px-6 py-3 bg-wine-600 text-white rounded-lg hover:bg-wine-700 transition-colors font-medium"
                    >
                      Take Action
                      <ArrowRight className="w-4 h-4" />
                    </a>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create One-Tap Action Modal - Enhanced */}
      <AnimatePresence>
        {showCreateActionModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowCreateActionModal(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-wine-600 via-wine-700 to-purple-700">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/20 rounded-xl">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">Create One-Tap Action</h2>
                    <p className="text-sm text-white/80">Design a custom quick action for your workflow</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowCreateActionModal(false)}
                  className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-0">
                  {/* Left Side - Form */}
                  <div className="lg:col-span-3 p-6 space-y-5 border-r border-gray-100">
                    {/* Action Type Categories */}
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                        <Zap className="w-4 h-4 text-wine-600" />
                        Action Categories
                      </label>
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        {[
                          { id: 'communication', label: 'Communication', icon: MessageSquare, color: 'blue', desc: 'Email & SMS' },
                          { id: 'inventory', label: 'Inventory', icon: Package, color: 'emerald', desc: 'Stock actions' },
                          { id: 'orders', label: 'Orders', icon: Clock, color: 'amber', desc: 'Order management' },
                          { id: 'reports', label: 'Reports', icon: TrendingUp, color: 'purple', desc: 'Generate reports' },
                        ].map((cat) => (
                          <button
                            key={cat.id}
                            onClick={() => setNewAction({ ...newAction, color: cat.color })}
                            className={`p-3 rounded-xl border-2 transition-all text-center ${
                              newAction.color === cat.color
                                ? 'border-wine-500 bg-wine-50'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <cat.icon className={`w-5 h-5 mx-auto mb-1 ${newAction.color === cat.color ? 'text-wine-600' : 'text-gray-500'}`} />
                            <p className="text-xs font-semibold text-gray-900">{cat.label}</p>
                            <p className="text-[10px] text-gray-500">{cat.desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Quick Start Templates by Category */}
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                        <Star className="w-4 h-4 text-amber-500" />
                        Quick Start Templates
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { title: 'Send Email Template', desc: 'Use saved email template', url: '/communication?tab=email-templates', icon: 'MessageSquare', color: 'blue', category: 'communication' },
                          { title: 'Send SMS Alert', desc: 'Quick SMS notification', url: '/communication?tab=sms-templates', icon: 'MessageSquare', color: 'emerald', category: 'communication' },
                          { title: 'Check Low Stock', desc: 'View wines below threshold', url: '/inventory?filter=low-stock', icon: 'Package', color: 'rose', category: 'inventory' },
                          { title: 'Pending Orders', desc: 'Review orders awaiting approval', url: '/orders?status=pending', icon: 'Clock', color: 'amber', category: 'orders' },
                          { title: 'Generate Report', desc: 'Create scheduled report', url: '/communication?tab=reports', icon: 'TrendingUp', color: 'purple', category: 'reports' },
                          { title: 'Contact Provider', desc: 'Quick provider communication', url: '/providers', icon: 'MessageSquare', color: 'emerald', category: 'communication' },
                          { title: 'Reorder Wine', desc: 'Quick reorder action', url: '/inventory?action=reorder', icon: 'Package', color: 'blue', category: 'inventory' },
                          { title: 'Weekly Summary', desc: 'Generate weekly summary', url: '/reports?type=weekly', icon: 'TrendingUp', color: 'indigo', category: 'reports' },
                        ].map((template, idx) => (
                          <button
                            key={idx}
                            onClick={() => setNewAction({
                              ...newAction,
                              title: template.title,
                              description: template.desc,
                              actionUrl: template.url,
                              icon: template.icon,
                              color: template.color,
                            })}
                            className="p-3 border-2 border-dashed border-gray-200 rounded-xl hover:border-wine-300 hover:bg-wine-50 transition-all text-left group"
                          >
                            <div className="flex items-center gap-2">
                              <div className={`p-1.5 rounded-lg bg-${template.color}-100 text-${template.color}-600 group-hover:scale-110 transition-transform`}>
                                {template.icon === 'Package' && <Package className="w-4 h-4" />}
                                {template.icon === 'Clock' && <Clock className="w-4 h-4" />}
                                {template.icon === 'TrendingUp' && <TrendingUp className="w-4 h-4" />}
                                {template.icon === 'MessageSquare' && <MessageSquare className="w-4 h-4" />}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{template.title}</p>
                                <p className="text-xs text-gray-500">{template.desc}</p>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Trigger Configuration */}
                    <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-100">
                      <label className="block text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                        <Bell className="w-4 h-4 text-indigo-600" />
                        Trigger Configuration
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <button className="p-2.5 bg-white rounded-lg border border-indigo-200 hover:border-indigo-400 transition-colors text-center">
                          <Clock className="w-4 h-4 mx-auto mb-1 text-indigo-600" />
                          <p className="text-xs font-medium text-gray-900">Time-based</p>
                          <p className="text-[10px] text-gray-500">Daily/Weekly</p>
                        </button>
                        <button className="p-2.5 bg-white rounded-lg border border-indigo-200 hover:border-indigo-400 transition-colors text-center">
                          <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-amber-600" />
                          <p className="text-xs font-medium text-gray-900">Threshold</p>
                          <p className="text-[10px] text-gray-500">Low stock, etc.</p>
                        </button>
                        <button className="p-2.5 bg-white rounded-lg border border-indigo-200 hover:border-indigo-400 transition-colors text-center">
                          <Zap className="w-4 h-4 mx-auto mb-1 text-purple-600" />
                          <p className="text-xs font-medium text-gray-900">Manual</p>
                          <p className="text-[10px] text-gray-500">On-demand</p>
                        </button>
                      </div>
                    </div>

                    <div className="h-px bg-gray-200" />

                    {/* Title */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Action Title <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={newAction.title}
                        onChange={(e) => setNewAction({ ...newAction, title: e.target.value })}
                        placeholder="e.g., Check Low Stock Wines"
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent text-lg"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Description
                      </label>
                      <textarea
                        value={newAction.description}
                        onChange={(e) => setNewAction({ ...newAction, description: e.target.value })}
                        placeholder="Brief description of what this action does"
                        rows={2}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent resize-none"
                      />
                    </div>

                    {/* Action URL with Quick Links */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Action URL <span className="text-rose-500">*</span>
                      </label>
                      <div className="relative mb-2">
                        <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          value={newAction.actionUrl}
                          onChange={(e) => setNewAction({ ...newAction, actionUrl: e.target.value })}
                          placeholder="/inventory or https://example.com"
                          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {['/inventory', '/orders', '/reports', '/wines', '/providers', '/calendar', '/documents'].map((url) => (
                          <button
                            key={url}
                            onClick={() => setNewAction({ ...newAction, actionUrl: url })}
                            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                              newAction.actionUrl === url
                                ? 'bg-wine-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {url}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Icon Selection */}
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Icon
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { name: 'Zap', icon: Zap },
                          { name: 'Wine', icon: Wine },
                          { name: 'Package', icon: Package },
                          { name: 'TrendingUp', icon: TrendingUp },
                          { name: 'Clock', icon: Clock },
                          { name: 'Star', icon: Star },
                          { name: 'Bell', icon: Bell },
                          { name: 'CheckCircle2', icon: CheckCircle2 },
                          { name: 'AlertTriangle', icon: AlertTriangle },
                          { name: 'Calendar', icon: Calendar },
                          { name: 'Search', icon: Search },
                          { name: 'RefreshCw', icon: RefreshCw },
                        ].map(({ name, icon: IconComponent }) => (
                          <button
                            key={name}
                            onClick={() => setNewAction({ ...newAction, icon: name })}
                            className={`p-3 rounded-xl border-2 transition-all ${
                              newAction.icon === name
                                ? 'border-wine-500 bg-wine-50 text-wine-600 scale-110'
                                : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                            title={name}
                          >
                            <IconComponent className="w-5 h-5" />
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Priority & Color Row */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                          Priority Level
                        </label>
                        <div className="flex gap-2">
                          {[
                            { value: 'low', label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-300' },
                            { value: 'medium', label: 'Medium', color: 'bg-blue-100 text-blue-700 border-blue-300' },
                            { value: 'high', label: 'High', color: 'bg-rose-100 text-rose-700 border-rose-300' },
                          ].map((p) => (
                            <button
                              key={p.value}
                              onClick={() => setNewAction({ ...newAction, priority: p.value as any })}
                              className={`flex-1 px-3 py-2.5 rounded-xl border-2 font-medium text-sm transition-all ${
                                newAction.priority === p.value
                                  ? `${p.color} border-current`
                                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                          Color Theme
                        </label>
                        <div className="flex gap-2">
                          {colorOptions.map((color) => (
                            <button
                              key={color.value}
                              onClick={() => setNewAction({ ...newAction, color: color.value })}
                              className={`flex-1 h-11 rounded-xl ${color.bg} transition-all ${
                                newAction.color === color.value 
                                  ? 'ring-2 ring-offset-2 ring-gray-900 scale-105' 
                                  : 'hover:scale-105'
                              }`}
                              title={color.name}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Side - Live Preview */}
                  <div className="lg:col-span-2 p-6 bg-gradient-to-br from-gray-50 to-gray-100">
                    <label className="block text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <Eye className="w-4 h-4 text-wine-600" />
                      Live Preview
                    </label>
                    
                    {/* Phone Mockup */}
                    <div className="flex justify-center">
                      <div className="w-64 bg-black rounded-[2.5rem] p-2 shadow-2xl">
                        <div className="bg-white rounded-[2rem] overflow-hidden">
                          {/* Status Bar */}
                          <div className="h-8 bg-gray-100 flex items-center justify-center">
                            <div className="w-20 h-5 bg-black rounded-full" />
                          </div>
                          
                          {/* App Header */}
                          <div className="px-4 py-3 border-b border-gray-200 bg-white">
                            <div className="flex items-center gap-2">
                              <Bell className="w-5 h-5 text-wine-600" />
                              <span className="font-semibold text-gray-900 text-sm">One-Tap Actions</span>
                            </div>
                          </div>

                          {/* Action Preview */}
                          <div className="p-4 bg-gray-50 min-h-[200px]">
                            <p className="text-xs text-gray-500 mb-3 font-medium">YOUR NEW ACTION</p>
                            <motion.button
                              whileHover={{ scale: 1.02 }}
                              whileTap={{ scale: 0.98 }}
                              className={`${colorOptions.find(c => c.value === newAction.color)?.bg || 'bg-wine-600'} ${colorOptions.find(c => c.value === newAction.color)?.text || 'text-white'} rounded-xl p-4 w-full text-left shadow-lg`}
                            >
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-white/20 rounded-lg">
                                  {newAction.icon === 'Zap' && <Zap className="w-5 h-5" />}
                                  {newAction.icon === 'Wine' && <Wine className="w-5 h-5" />}
                                  {newAction.icon === 'Package' && <Package className="w-5 h-5" />}
                                  {newAction.icon === 'TrendingUp' && <TrendingUp className="w-5 h-5" />}
                                  {newAction.icon === 'Clock' && <Clock className="w-5 h-5" />}
                                  {newAction.icon === 'Star' && <Star className="w-5 h-5" />}
                                  {newAction.icon === 'Bell' && <Bell className="w-5 h-5" />}
                                  {newAction.icon === 'CheckCircle2' && <CheckCircle2 className="w-5 h-5" />}
                                  {newAction.icon === 'AlertTriangle' && <AlertTriangle className="w-5 h-5" />}
                                  {newAction.icon === 'Calendar' && <Calendar className="w-5 h-5" />}
                                  {newAction.icon === 'Search' && <Search className="w-5 h-5" />}
                                  {newAction.icon === 'RefreshCw' && <RefreshCw className="w-5 h-5" />}
                                  {!newAction.icon && <Zap className="w-5 h-5" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h4 className="font-bold text-sm truncate">
                                    {newAction.title || 'Action Title'}
                                  </h4>
                                  <p className="text-xs opacity-90 truncate">
                                    {newAction.description || 'Action description'}
                                  </p>
                                </div>
                                <ArrowRight className="w-4 h-4 opacity-70" />
                              </div>
                            </motion.button>

                            {/* Priority Badge */}
                            <div className="mt-4 flex items-center justify-between">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                newAction.priority === 'high' ? 'bg-rose-100 text-rose-700' :
                                newAction.priority === 'medium' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-700'
                              }`}>
                                {newAction.priority.charAt(0).toUpperCase() + newAction.priority.slice(1)} Priority
                              </span>
                              <span className="text-xs text-gray-500">
                                {newAction.actionUrl || '/path'}
                              </span>
                            </div>
                          </div>

                          {/* Bottom Nav Mock */}
                          <div className="h-12 bg-white border-t border-gray-200 flex items-center justify-around px-6">
                            <div className="w-6 h-1 bg-gray-300 rounded-full" />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Action Info */}
                    <div className="mt-6 p-4 bg-white rounded-xl border border-gray-200">
                      <h4 className="text-sm font-semibold text-gray-900 mb-2">Action Details</h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Title:</span>
                          <span className="font-medium text-gray-900 truncate max-w-[150px]">
                            {newAction.title || '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">URL:</span>
                          <span className="font-mono text-gray-900 truncate max-w-[150px]">
                            {newAction.actionUrl || '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Priority:</span>
                          <span className="font-medium text-gray-900 capitalize">
                            {newAction.priority}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
                <div className="text-sm text-gray-500">
                  <span className="font-medium">Tip:</span> Press <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-xs font-mono">⌘N</kbd> to quickly open this modal
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowCreateActionModal(false)}
                    className="px-5 py-2.5 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateAction}
                    disabled={!newAction.title || !newAction.actionUrl}
                    className="px-6 py-2.5 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-wine-600/30 flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Create Action
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Context Menu */}
      <AnimatePresence>
        {contextMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            style={{ top: contextMenu?.y || 0, left: contextMenu?.x || 0 }}
            className="fixed bg-white rounded-xl shadow-2xl border border-gray-200 py-2 z-50 min-w-[200px]"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              if (!contextMenu) return null
              const notif = notifications.find(n => n.id === contextMenu.id)
              if (!notif) return null
              const isStarred = starredNotifications.has(contextMenu.id)

              return (
                <>
                  <button
                    onClick={() => {
                      if (contextMenu) toggleStar(contextMenu.id)
                      setContextMenu(null)
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-sm"
                  >
                    <Star className={`w-4 h-4 ${isStarred ? 'fill-amber-400 text-amber-400' : 'text-gray-400'}`} />
                    {isStarred ? 'Unstar' : 'Star'}
                  </button>
                  <button
                    onClick={() => {
                      if (contextMenu) markAsRead.mutateAsync(contextMenu.id)
                      setContextMenu(null)
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-sm"
                  >
                    <Eye className="w-4 h-4 text-gray-400" />
                    Mark as Read
                  </button>
                  <button
                    onClick={() => {
                      if (contextMenu) handleArchiveNotification(contextMenu.id)
                      setContextMenu(null)
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-sm"
                  >
                    <Archive className="w-4 h-4 text-blue-400" />
                    Archive
                  </button>
                  <div className="h-px bg-gray-200 my-1"></div>
                  <button
                    onClick={() => {
                      if (confirm('Delete this notification?') && contextMenu) {
                        handleDeleteNotification(contextMenu.id)
                      }
                      setContextMenu(null)
                    }}
                    className="w-full px-4 py-2 text-left hover:bg-rose-50 flex items-center gap-2 text-sm text-rose-600"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </>
              )
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Action Button */}
      <button
        onClick={() => setBatchMode(!batchMode)}
        className={`fixed bottom-8 right-8 p-4 rounded-full shadow-xl transition-all ${
          batchMode ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-wine-600 hover:bg-wine-700'
        } text-white z-40`}
        title={batchMode ? 'Exit Batch Mode (⌘B)' : 'Enter Batch Mode (⌘B)'}
      >
        {batchMode ? <CheckSquare className="w-6 h-6" /> : <Filter className="w-6 h-6" />}
      </button>
    </div>
  )
}
export default Notifications
