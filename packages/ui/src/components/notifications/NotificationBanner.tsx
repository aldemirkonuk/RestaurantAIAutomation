import * as React from "react"
import { Bell, X } from "lucide-react"
import { Button } from "../primitives/button"
import { Card } from "../primitives/card"
import { useNotifications } from "./NotificationProvider"
import { motion, AnimatePresence } from "framer-motion"
import { cn } from "../../lib/utils"

export interface NotificationBannerProps {
  className?: string
  onDismiss?: () => void
  autoShow?: boolean
  position?: "top" | "bottom"
}

export function NotificationBanner({
  className,
  onDismiss,
  autoShow = true,
  position = "top",
}: NotificationBannerProps) {
  const { permission, isSupported, requestPermission } = useNotifications()
  const [dismissed, setDismissed] = React.useState(false)
  const [requesting, setRequesting] = React.useState(false)

  // Auto-hide if dismissed or permission granted/denied
  const shouldShow = React.useMemo(() => {
    if (!autoShow || dismissed || !isSupported) return false
    return permission === "default"
  }, [autoShow, dismissed, isSupported, permission])

  const handleEnable = async () => {
    setRequesting(true)
    try {
      await requestPermission()
    } finally {
      setRequesting(false)
    }
  }

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ y: position === "top" ? -100 : 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: position === "top" ? -100 : 100, opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className={cn(
            "fixed left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4",
            position === "top" ? "top-4" : "bottom-4",
            className
          )}
        >
          <Card
            variant="glass"
            padding="md"
            className="shadow-2xl border-wine-200"
          >
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div className="flex-shrink-0 w-10 h-10 bg-wine-100 rounded-lg flex items-center justify-center">
                <Bell className="w-5 h-5 text-wine-600" />
              </div>

              {/* Content */}
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-1">
                  Enable Notifications
                </h3>
                <p className="text-sm text-gray-600 mb-3">
                  Get instant alerts for order approvals, low stock, and important updates.
                  Notifications appear in your browser, even when WineOps AI isn't open.
                </p>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleEnable}
                    disabled={requesting}
                  >
                    {requesting ? "Requesting..." : "Enable Notifications"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDismiss}
                  >
                    Not Now
                  </Button>
                </div>
              </div>

              {/* Close button */}
              <button
                onClick={handleDismiss}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Dismiss"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

