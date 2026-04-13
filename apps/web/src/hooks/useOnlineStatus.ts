/**
 * useOnlineStatus Hook
 * ====================
 * Simple hook to track online/offline status reactively.
 */

import { useState, useEffect } from 'react'

export interface UseOnlineStatusReturn {
  /** Whether the device is online */
  isOnline: boolean
  
  /** Whether the device is offline */
  isOffline: boolean
  
  /** Time since last status change */
  lastChangeTime: Date | null
}

/**
 * Hook to track online/offline status
 */
export function useOnlineStatus(): UseOnlineStatusReturn {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [lastChangeTime, setLastChangeTime] = useState<Date | null>(null)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setLastChangeTime(new Date())
    }

    const handleOffline = () => {
      setIsOnline(false)
      setLastChangeTime(new Date())
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return {
    isOnline,
    isOffline: !isOnline,
    lastChangeTime,
  }
}

export default useOnlineStatus
