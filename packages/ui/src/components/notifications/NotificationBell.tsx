import * as React from "react"
import { Bell } from "lucide-react"
import { Badge } from "../primitives/badge"
import { Button } from "../primitives/button"
import { cn } from "../../lib/utils"
import { motion, AnimatePresence } from "framer-motion"

export interface NotificationBellProps {
  count?: number
  onClick?: () => void
  className?: string
  showDot?: boolean
  size?: "sm" | "md" | "lg"
}

export function NotificationBell({
  count = 0,
  onClick,
  className,
  showDot = true,
  size = "md",
}: NotificationBellProps) {
  const [isRinging, setIsRinging] = React.useState(false)

  // Animate bell when count increases
  React.useEffect(() => {
    if (count > 0) {
      setIsRinging(true)
      const timer = setTimeout(() => setIsRinging(false), 1000)
      return () => clearTimeout(timer)
    }
  }, [count])

  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-5 h-5",
    lg: "w-6 h-6",
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      className={cn("relative", className)}
    >
      <motion.div
        animate={isRinging ? { rotate: [0, -15, 15, -15, 15, 0] } : {}}
        transition={{ duration: 0.5 }}
      >
        <Bell className={sizeClasses[size]} />
      </motion.div>

      {/* Notification badge */}
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-1 -right-1"
          >
            <Badge
              variant="destructive"
              size="sm"
              className="h-5 min-w-[20px] flex items-center justify-center px-1 text-[10px] font-bold"
            >
              {count > 99 ? "99+" : count}
            </Badge>
          </motion.div>
        )}

        {/* Red dot for unread (when no count shown) */}
        {count === 0 && showDot && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"
          />
        )}
      </AnimatePresence>
    </Button>
  )
}

