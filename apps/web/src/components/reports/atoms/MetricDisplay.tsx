/**
 * MetricDisplay - Atomic Component
 * Displays a single metric value with formatting
 */

interface MetricDisplayProps {
  value: string | number
  label: string
  format?: 'currency' | 'number' | 'percentage'
  className?: string
}

export function MetricDisplay({ value, label, format = 'number', className = '' }: MetricDisplayProps) {
  const formatValue = (val: string | number): string => {
    if (typeof val === 'string') return val
    
    switch (format) {
      case 'currency':
        return `$${val.toLocaleString()}`
      case 'percentage':
        return `${val}%`
      case 'number':
      default:
        return val.toLocaleString()
    }
  }

  return (
    <div className={className}>
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">
        {formatValue(value)}
      </p>
    </div>
  )
}
