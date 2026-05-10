/**
 * SyncStatus Component
 * ====================
 * Visual indicator for sync status showing online/offline state,
 * pending changes, and sync progress.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wifi,
  WifiOff,
  Cloud,
  RefreshCw,
  Check,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react'
import { useSyncManager } from '../../hooks/useSyncManager'

interface SyncStatusProps {
  /** Show in compact mode (icon only) */
  compact?: boolean
  /** Custom className */
  className?: string
  /** Position for floating mode */
  position?: 'top-right' | 'bottom-right' | 'bottom-left' | 'top-left'
  /** Whether to show as floating indicator */
  floating?: boolean
}

export function SyncStatus({
  compact = false,
  className = '',
  position = 'bottom-right',
  floating = true,
}: SyncStatusProps) {
  const {
    isOnline,
    isSyncing,
    pendingCount,
    lastSyncTime,
    lastError,
    syncNow,
    clearPendingMutations,
  } = useSyncManager()

  const [isExpanded, setIsExpanded] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  // Show success indicator briefly after sync
  useEffect(() => {
    if (!isSyncing && pendingCount === 0 && lastSyncTime) {
      setShowSuccess(true)
      const timer = setTimeout(() => setShowSuccess(false), 2000)
      return () => clearTimeout(timer)
    }
  }, [isSyncing, pendingCount, lastSyncTime])

  // Position classes
  const positionClasses = {
    'top-right': 'top-4 right-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-left': 'top-4 left-4',
  }

  // Status color
  const getStatusColor = () => {
    if (!isOnline) return 'bg-gray-500'
    if (lastError) return 'bg-red-500'
    if (isSyncing) return 'bg-blue-500'
    if (pendingCount > 0) return 'bg-amber-500'
    if (showSuccess) return 'bg-green-500'
    return 'bg-green-500'
  }

  // Status icon
  const StatusIcon = () => {
    if (!isOnline) return <WifiOff className="w-4 h-4" />
    if (isSyncing) return <RefreshCw className="w-4 h-4 animate-spin" />
    if (lastError) return <AlertTriangle className="w-4 h-4" />
    if (pendingCount > 0) return <Cloud className="w-4 h-4" />
    return <Check className="w-4 h-4" />
  }

  // Format last sync time
  const formatLastSync = () => {
    if (!lastSyncTime) return 'Never'
    const now = new Date()
    const diff = now.getTime() - lastSyncTime.getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)
    
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return lastSyncTime.toLocaleDateString()
  }

  // Compact mode - just an icon
  if (compact) {
    return (
      <div
        className={`relative inline-flex items-center justify-center ${className}`}
        title={
          isOnline
            ? pendingCount > 0
              ? `${pendingCount} pending changes`
              : 'Synced'
            : 'Offline'
        }
      >
        <div className={`p-2 rounded-full ${getStatusColor()} text-white`}>
          <StatusIcon />
        </div>
        {pendingCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        )}
      </div>
    )
  }

  const content = (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden ${className}`}
    >
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          <div className={`p-2 rounded-full ${getStatusColor()} text-white`}>
            <StatusIcon />
          </div>
          
          <div className="text-left">
            <p className="font-medium text-gray-900 text-sm">
              {!isOnline && 'Offline'}
              {isOnline && isSyncing && 'Syncing...'}
              {isOnline && !isSyncing && lastError && 'Sync Error'}
              {isOnline && !isSyncing && !lastError && pendingCount > 0 && `${pendingCount} pending`}
              {isOnline && !isSyncing && !lastError && pendingCount === 0 && 'All synced'}
            </p>
            <p className="text-xs text-gray-500">
              {isOnline ? `Last sync: ${formatLastSync()}` : 'Changes saved locally'}
            </p>
          </div>
        </div>
        
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        )}
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-gray-100"
          >
            <div className="p-4 space-y-3">
              {/* Connection status */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Connection</span>
                <span className={`flex items-center gap-1 ${isOnline ? 'text-green-600' : 'text-gray-500'}`}>
                  {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                  {isOnline ? 'Online' : 'Offline'}
                </span>
              </div>

              {/* Pending changes */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Pending changes</span>
                <span className={pendingCount > 0 ? 'text-amber-600 font-medium' : 'text-gray-900'}>
                  {pendingCount}
                </span>
              </div>

              {/* Error message */}
              {lastError && (
                <div className="p-2 bg-red-50 rounded-lg border border-red-100">
                  <p className="text-xs text-red-600">{lastError}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => syncNow()}
                  disabled={!isOnline || isSyncing || pendingCount === 0}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Syncing...' : 'Sync Now'}
                </button>
                
                {pendingCount > 0 && (
                  <button
                    onClick={() => {
                      if (confirm('Clear all pending changes? This cannot be undone.')) {
                        clearPendingMutations()
                      }
                    }}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Clear pending changes"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )

  // Floating mode
  if (floating) {
    return (
      <div className={`fixed ${positionClasses[position]} z-50 w-64`}>
        {content}
      </div>
    )
  }

  return content
}

/**
 * Simple offline banner that shows at the top of the page when offline
 */
export function OfflineBanner() {
  const { isOnline, pendingCount } = useSyncManager()

  if (isOnline) return null

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="bg-amber-500 text-white px-4 py-2 text-center text-sm font-medium"
    >
      <div className="flex items-center justify-center gap-2">
        <WifiOff className="w-4 h-4" />
        <span>
          You're offline.
          {pendingCount > 0 && ` ${pendingCount} change${pendingCount > 1 ? 's' : ''} will sync when you're back online.`}
        </span>
      </div>
    </motion.div>
  )
}

export default SyncStatus
