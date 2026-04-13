import { Clock, MapPin, Users, Wine, Truck, Package, Bell, Repeat, Star } from 'lucide-react'
import type { CalendarEvent, EventType } from './useCalendarPage'

// ==================== Types ====================

export interface EventCardProps {
  event: CalendarEvent
  color: string
  onClose?: () => void
}

// ==================== Constants ====================

const EVENT_TYPE_CONFIG: Record<EventType, { icon: typeof Wine; label: string }> = {
  delivery: { icon: Truck, label: 'Delivery' },
  order: { icon: Package, label: 'Order' },
  meeting: { icon: Users, label: 'Meeting' },
  inventory: { icon: Package, label: 'Inventory' },
  tasting: { icon: Wine, label: 'Tasting' },
  reminder: { icon: Bell, label: 'Reminder' },
  recurring: { icon: Repeat, label: 'Recurring' },
  custom: { icon: Star, label: 'Custom' },
}

// ==================== Helpers ====================

function formatTime(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':')
  const hour = parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const h12 = hour % 12 || 12
  return `${h12}:${minutes.padStart(2, '0')} ${ampm}`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

// ==================== Main Component ====================

export function EventCard({ event, color, onClose }: EventCardProps) {
  const config = EVENT_TYPE_CONFIG[event.type] || EVENT_TYPE_CONFIG.custom
  const TypeIcon = config.icon

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden w-72">
      {/* Colored header */}
      <div className="px-4 py-3" style={{ backgroundColor: color + '15' }}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="flex-shrink-0 p-1.5 rounded-lg"
              style={{ backgroundColor: color + '22' }}
            >
              <TypeIcon className="w-4 h-4" style={{ color }} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-gray-900 truncate">{event.title}</h3>
              <span
                className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full mt-0.5"
                style={{ backgroundColor: color + '22', color }}
              >
                {config.label}
              </span>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors p-0.5"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-2.5">
        {/* Date */}
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <div>
            <div className="font-medium">{formatDate(event.date)}</div>
            {event.allDay ? (
              <span className="text-gray-400">All day</span>
            ) : event.startTime ? (
              <span className="text-gray-400">
                {formatTime(event.startTime)}
                {event.endTime && ` – ${formatTime(event.endTime)}`}
              </span>
            ) : null}
          </div>
        </div>

        {/* Location */}
        {event.location && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span>{event.location}</span>
          </div>
        )}

        {/* Description */}
        {event.description && (
          <p className="text-xs text-gray-500 leading-relaxed">{event.description}</p>
        )}

        {/* Provider / Wine info */}
        {event.provider && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Truck className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span>{event.provider}</span>
          </div>
        )}

        {event.wineCount != null && event.wineCount > 0 && (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Wine className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            <span>
              {event.wineCount} wine{event.wineCount > 1 ? 's' : ''}
              {event.totalValue != null && ` · $${event.totalValue.toLocaleString()}`}
            </span>
          </div>
        )}

        {/* Status */}
        {event.status && (
          <div className="pt-1">
            <span className={`
              inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize
              ${event.status === 'pending' ? 'bg-yellow-100 text-yellow-700' : ''}
              ${event.status === 'confirmed' ? 'bg-green-100 text-green-600' : ''}
              ${event.status === 'approved' ? 'bg-blue-100 text-blue-600' : ''}
              ${event.status === 'completed' ? 'bg-green-100 text-green-600' : ''}
              ${event.status === 'cancelled' ? 'bg-red-100 text-red-600' : ''}
              ${event.status === 'dismissed' ? 'bg-gray-100 text-gray-500' : ''}
            `}>
              {event.status}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

export default EventCard
