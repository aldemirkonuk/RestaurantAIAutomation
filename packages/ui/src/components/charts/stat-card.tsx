import * as React from "react"
import { Card } from "@tremor/react"
import { LucideIcon } from "lucide-react"
import { cn, formatCurrency, formatNumber, formatPercentage } from "../../lib/utils"

export interface StatCardProps {
  title: string
  value: number | string
  change?: number
  changeType?: "increase" | "decrease"
  icon?: LucideIcon
  format?: "number" | "currency" | "percentage"
  subtitle?: string
  loading?: boolean
  className?: string
}

export function StatCard({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  format = "number",
  subtitle,
  loading = false,
  className,
}: StatCardProps) {
  const formattedValue = React.useMemo(() => {
    if (typeof value === "string") return value
    
    switch (format) {
      case "currency":
        return formatCurrency(value)
      case "percentage":
        return formatPercentage(value)
      default:
        return formatNumber(value)
    }
  }, [value, format])

  const changeColor = React.useMemo(() => {
    if (!change) return ""
    if (changeType === "increase") {
      return change > 0 ? "text-wine-green-600" : "text-red-600"
    }
    return change > 0 ? "text-red-600" : "text-wine-green-600"
  }, [change, changeType])

  if (loading) {
    return (
      <Card className={cn("bg-white/60 backdrop-blur-md border border-white/20 shadow-xl", className)}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-4"></div>
          <div className="h-8 bg-gray-200 rounded w-3/4"></div>
        </div>
      </Card>
    )
  }

  return (
    <Card
      className={cn(
        "bg-white/60 backdrop-blur-md border border-white/20 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1",
        className
      )}
      decoration="top"
      decorationColor="wine"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
          <div className="flex items-baseline gap-2">
            <h3 className="text-3xl font-bold text-gray-900">{formattedValue}</h3>
            {change !== undefined && (
              <span className={cn("text-sm font-medium", changeColor)}>
                {change > 0 ? "+" : ""}
                {formatPercentage(change, 1)}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className="rounded-lg bg-wine-100/50 p-3">
            <Icon className="h-6 w-6 text-wine-600" />
          </div>
        )}
      </div>
    </Card>
  )
}

