/**
 * WineTypeBar - Atomic Component
 * Horizontal stacked bar for wine type distribution
 */

interface WineTypeData {
  red: number
  white: number
  sparkling: number
  rose: number
  dessert: number
}

interface WineTypeBarProps {
  data: WineTypeData
  showLabels?: boolean
  height?: 'sm' | 'md' | 'lg'
  className?: string
}

const HEIGHT_CLASSES = {
  sm: 'h-5',
  md: 'h-6',
  lg: 'h-8',
}

export function WineTypeBar({ data, showLabels = false, height = 'md', className = '' }: WineTypeBarProps) {
  const total = data.red + data.white + data.sparkling + data.rose + data.dessert
  
  if (total === 0) return null

  const segments = [
    { type: 'Red', value: data.red, color: 'bg-rose-600', textColor: 'text-white' },
    { type: 'White', value: data.white, color: 'bg-amber-400', textColor: 'text-gray-900' },
    { type: 'Sparkling', value: data.sparkling, color: 'bg-yellow-300', textColor: 'text-gray-900' },
    { type: 'Rosé', value: data.rose, color: 'bg-pink-400', textColor: 'text-white' },
    { type: 'Dessert', value: data.dessert, color: 'bg-purple-500', textColor: 'text-white' },
  ]

  return (
    <div className={`${HEIGHT_CLASSES[height]} rounded-full overflow-hidden flex bg-gray-100 ${className}`}>
      {segments.map((segment) => {
        if (segment.value === 0) return null
        
        const percentage = (segment.value / total) * 100
        
        return (
          <div
            key={segment.type}
            className={`${segment.color} transition-all flex items-center justify-center`}
            style={{ width: `${percentage}%` }}
            title={`${segment.type}: ${segment.value}`}
          >
            {showLabels && segment.value >= 3 && (
              <span className={`text-[9px] font-bold ${segment.textColor}`}>
                {segment.value}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export type { WineTypeData }
