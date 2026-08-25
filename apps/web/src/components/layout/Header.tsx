import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Bell,
  ChevronDown,
  Settings,
  LogOut,
  User,
  HelpCircle,
  Command,
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { cn } from '../../lib/utils'
import { ThemeMenu } from './ThemeMenu'
import { RestaurantBranchSwitcher } from './RestaurantBranchSwitcher'
import { useNotifications, useMarkNotificationAsRead, useMarkAllNotificationsAsRead } from '../../hooks/queries'
import type { Notification } from '../../services/api/notifications'
import { useNotificationStore } from '../../stores'
import { collapseStackedNotifications, stackedNotificationLabel } from '../../lib/notificationStack'

interface HeaderProps {
  title?: string
  subtitle?: string
}

export function Header({ title, subtitle }: HeaderProps) {
  const [showSearch, setShowSearch] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const storeUnread = useNotificationStore((s) => s.unreadCount)
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount)
  const userId = user?.userId || ''
  const { data: notifications = [], refetch: refetchNotifications } = useNotifications(userId, { status: 'unread' })
  const markAsRead = useMarkNotificationAsRead()
  const markAllAsRead = useMarkAllNotificationsAsRead()

  const { items: displayNotifications, foldedCount, foldedById } = useMemo(
    () => collapseStackedNotifications(notifications),
    [notifications],
  )

  /** Hide badge while open; show stacked count when closed. */
  const unreadCount = showNotifications ? 0 : displayNotifications.length

  useEffect(() => {
    if (showNotifications) return
    const n = displayNotifications.length
    if (n !== storeUnread) setUnreadCount(n)
  }, [displayNotifications.length, showNotifications, storeUnread, setUnreadCount])

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

  const getNotificationTypeColor = (type: Notification['type']) => {
    switch (type) {
      case 'inventory_low_stock':
        return '#7C3AED'
      case 'order_pending':
      case 'order_delivered':
        return '#4F46E5'
      case 'price_change':
        return '#F59E0B'
      case 'delivery_scheduled':
        return '#10B981'
      case 'calendar_reminder':
        return '#06B6D4'
      case 'ai_suggestion':
        return '#EC4899'
      case 'system':
      default:
        return '#6B7280'
    }
  }

  return (
    <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200 dark:bg-gray-900/80 dark:border-gray-800">
      <div className="flex items-center justify-between h-16 px-4 sm:px-6 gap-2">
        {/* Left: Page Title (mobile nav lives in DashboardLayout chrome) */}
        <div className="min-w-0">
          {title && (
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">{title}</h1>
          )}
          {subtitle && (
            <p className="text-sm text-gray-500 truncate hidden sm:block">{subtitle}</p>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 sm:gap-2">
          <RestaurantBranchSwitcher />
          {/* Global Search → opens the ⌘K command palette (NEW-005 / NEW-007) */}
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('wineops:command-open'))}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-xl text-gray-500 transition-colors dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            aria-label="Open command palette"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
            <span className="text-sm hidden md:block">Search...</span>
            <kbd className="hidden md:flex items-center gap-1 px-2 py-0.5 bg-white rounded text-xs text-gray-400 border border-gray-200 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-400">
              <Command className="w-3 h-3" />K
            </kbd>
          </button>

          {/* Theme Toggle */}
          <ThemeMenu />

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="relative p-2.5 hover:bg-gray-100 rounded-xl transition-colors"
              aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
              aria-expanded={showNotifications}
            >
              <Bell className="w-5 h-5 text-gray-600" aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-4 h-4 bg-wine-500 text-white text-xs font-bold rounded-full flex items-center justify-center" aria-label={`${unreadCount} unread`}>
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Notifications Dropdown */}
            <AnimatePresence>
              {showNotifications && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowNotifications(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
                  >
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                      <div>
                        <h3 className="font-semibold text-gray-900">Notifications</h3>
                        {foldedCount > 0 && (
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {foldedCount} similar grouped
                          </p>
                        )}
                      </div>
                      {notifications.length > 0 && (
                        <button
                          onClick={async () => {
                            await markAllAsRead.mutateAsync(userId)
                            refetchNotifications()
                          }}
                          className="text-sm text-wine-600 hover:text-wine-700 font-medium"
                          aria-label="Mark all notifications as read"
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {displayNotifications.length === 0 ? (
                        <div className="px-4 py-8 text-center text-gray-500">
                          <Bell className="w-8 h-8 mx-auto mb-2 opacity-40" />
                          <p className="text-sm">No new notifications</p>
                        </div>
                      ) : (
                        displayNotifications.map((notification) => {
                          const foldedInto = foldedById[notification.id]
                          const sublabel = stackedNotificationLabel(notification, foldedInto)
                          return (
                          <div
                            key={notification.id}
                            onClick={async () => {
                              await markAsRead.mutateAsync(notification.id)
                              refetchNotifications()
                              navigate('/notifications', {
                                state: { selectedNotificationId: notification.id },
                              })
                              setShowNotifications(false)
                            }}
                            className={cn(
                              'px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors border-b border-gray-50 last:border-0',
                              notification.status === 'unread' && 'bg-wine-50/50'
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <div
                                className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
                                style={{ backgroundColor: getNotificationTypeColor(notification.type) }}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 leading-snug">
                                  {notification.title}
                                </p>
                                {sublabel && (
                                  <p className="text-[11px] text-gray-500 mt-0.5">{sublabel}</p>
                                )}
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {formatTimestamp(notification.timestamp)}
                                </p>
                              </div>
                            </div>
                          </div>
                          )
                        })
                      )}
                    </div>
                    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
                      <button
                        onClick={() => {
                          navigate('/notifications')
                          setShowNotifications(false)
                        }}
                        className="w-full text-sm text-wine-600 hover:text-wine-700 font-medium"
                      >
                        View all notifications
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center gap-2 p-1.5 pr-3 hover:bg-gray-100 rounded-xl transition-colors"
              aria-label="User menu"
              aria-expanded={showUserMenu}
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-wine-400 to-wine-600 flex items-center justify-center text-white font-semibold text-sm" aria-hidden="true">
                {user?.name?.charAt(0) || 'U'}
              </div>
              <div className="hidden md:block text-left">
                <p className="text-sm font-medium text-gray-900">{user?.name || 'User'}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400" aria-hidden="true" />
            </button>

            {/* User Dropdown */}
            <AnimatePresence>
              {showUserMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowUserMenu(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50"
                  >
                    <div className="px-4 py-3 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900">{user?.name || 'User'}</p>
                      <p className="text-sm text-gray-500">{user?.email || 'user@example.com'}</p>
                    </div>
                    <div className="p-2">
                      <button
                        onClick={() => { navigate('/profile'); setShowUserMenu(false) }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        aria-label="View profile"
                      >
                        <User className="w-4 h-4" aria-hidden="true" />
                        Profile
                      </button>
                      <button
                        onClick={() => { navigate('/settings'); setShowUserMenu(false) }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        aria-label="Open settings"
                      >
                        <Settings className="w-4 h-4" aria-hidden="true" />
                        Settings
                      </button>
                      <button
                        onClick={() => { navigate('/help'); setShowUserMenu(false) }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        aria-label="Get help and support"
                      >
                        <HelpCircle className="w-4 h-4" aria-hidden="true" />
                        Help & Support
                      </button>
                    </div>
                    <div className="p-2 border-t border-gray-100">
                      <button
                        onClick={logout}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        aria-label="Log out of your account"
                      >
                        <LogOut className="w-4 h-4" aria-hidden="true" />
                        Log Out
                      </button>
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Search Modal */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-start justify-center pt-32"
            onClick={() => setShowSearch(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center gap-3 px-4 border-b border-gray-100">
                <Search className="w-5 h-5 text-gray-400" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Search wines, orders, reports..."
                  className="flex-1 py-4 text-lg outline-none"
                  autoFocus
                  aria-label="Search wines, orders, and reports"
                />
                <kbd className="px-2 py-1 bg-gray-100 rounded text-xs text-gray-400 border border-gray-200" aria-label="Press Escape to close">
                  ESC
                </kbd>
              </div>
              <div className="p-4">
                <p className="text-sm text-gray-500 mb-3">Quick Actions</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    'View Inventory',
                    'Create Order',
                    'Low Stock Alerts',
                    'Generate Report',
                  ].map((action) => (
                    <button
                      key={action}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <Search className="w-4 h-4 text-gray-400" />
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

