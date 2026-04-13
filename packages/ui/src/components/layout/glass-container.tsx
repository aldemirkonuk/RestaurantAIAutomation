import * as React from "react"
import { cn } from "../../lib/utils"

export interface GlassContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "light" | "dark" | "subtle"
}

export function GlassContainer({
  children,
  className,
  variant = "light",
  ...props
}: GlassContainerProps) {
  const variantClasses = {
    light: "bg-white/60 border-white/20",
    dark: "bg-gray-900/60 border-gray-800/20",
    subtle: "bg-white/40 border-white/10",
  }

  return (
    <div
      className={cn(
        "backdrop-blur-md border rounded-xl shadow-xl transition-all duration-300",
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

