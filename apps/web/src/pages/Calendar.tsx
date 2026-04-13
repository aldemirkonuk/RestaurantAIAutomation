import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Header } from '../components/layout/Header'
import { Card, Button } from '../components/ui'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Users,
  Wine,
  Truck,
  Package,
  Bell,
  X,
  Check,
  Edit3,
  Trash2,
  Search,
  Grid3X3,
  List,
  Repeat,
  Star,
  Filter,
} from 'lucide-react'
import { useCalendarEvents, useCreateCalendarEvent, useUpdateCalendarEvent, useDeleteCalendarEvent, useEventTypes, useProviders } from '../hooks/queries'
import { PageSkeleton, ErrorState } from '../components/ui'
import { getCustomEventTypes, deleteCustomEventType, isCustomEventType } from '../data/customEventTypes'
import { NewEventTypeModal } from '../components/calendar/NewEventTypeModal'
import { useCalendarEventsSubscription, CalendarEventPayload } from '../contexts/RealtimeContext'
import { scheduleReminder } from '../lib/reminder-scheduler'
import { expandAllRecurringEvents } from '../lib/calendar/recurrence'
import { EntityAutocomplete, EntityOption } from '../components/shared/EntityAutocomplete'
import { 
  CompanyClass, 
  providerTypeToClass,
  COMPANY_CLASS_CONFIG,
  getClassConfig,
} from '../types/companyClass'
import { createNotification } from '../services/api/notifications'
import { useAuth } from '../contexts/AuthContext'

// Event types
type EventType = 'delivery' | 'order' | 'meeting' | 'inventory' | 'tasting' | 'reminder' | 'recurring' | 'custom'

type ReminderTime = '15min' | '1hour' | '1day' | '1week' | 'custom'

interface RecurringConfig {
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'monthly' | 'custom'
  interval: number // Every X days/weeks/months
  daysOfWeek?: number[] // 0-6 (Sunday-Saturday) for weekly
  dayOfMonth?: number // 1-31 for monthly
  endType: 'never' | 'on' | 'after'
  endDate?: Date
  endCount?: number // Number of occurrences
}

interface CalendarEvent {
  id: string
  title: string
  type: EventType
  date: Date
  startTime?: string
  endTime?: string
  allDay?: boolean
  description?: string
  location?: string
  attendees?: string[]
  color: string
  provider?: string
  providerId?: string
  wineCount?: number
  totalValue?: number
  status?: 'pending' | 'confirmed' | 'approved' | 'dismissed' | 'completed' | 'cancelled'
  recurring?: RecurringConfig
  reminders?: ReminderTime[]
  customReminderMinutes?: number
  relatedEntity?: {
    id: string
    name: string
    type: 'provider' | 'client' | 'contact' | 'wine_type' | 'label'
    badge?: string
    /** Company Class ID for AI context and reporting */
    companyClass?: CompanyClass
  }
  /** Multiple entity tags for comprehensive AI context */
  entityTags?: Array<{
    id: string
    name: string
    type: 'provider' | 'client' | 'contact' | 'wine_type' | 'label'
    badge?: string
    companyClass?: CompanyClass
  }>
}

// Sample events data
// Helper functions
const getDaysInMonth = (year: number, month: number) => {
  return new Date(year, month + 1, 0).getDate()
}

const getFirstDayOfMonth = (year: number, month: number) => {
  return new Date(year, month, 1).getDay()
}

const isSameDay = (date1: Date, date2: Date) => {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  )
}

const isToday = (date: Date) => isSameDay(date, new Date())

const formatTime = (time: string) => {
  const [hours = '0', minutes = '00'] = time.split(':')
  const hour = parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:${minutes.padStart(2, '0')} ${ampm}`
}

const clampTime = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (!digits) return ''
  const hours = parseInt(digits.slice(0, 2).padStart(2, '0'), 10)
  const minutes = parseInt(digits.slice(2).padEnd(2, '0'), 10)
  const clampedHours = Math.min(Math.max(hours, 0), 23)
  const clampedMinutes = Math.min(Math.max(minutes, 0), 59)
  return `${clampedHours.toString().padStart(2, '0')}:${clampedMinutes.toString().padStart(2, '0')}`
}

const formatTimeInput = (raw: string) => {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

const getNextTimeSlot = (base: Date, stepMinutes = 15) => {
  const next = new Date(base)
  next.setSeconds(0, 0)
  const minutes = next.getMinutes()
  const remainder = minutes % stepMinutes
  if (remainder !== 0) {
    next.setMinutes(minutes + (stepMinutes - remainder))
  }
  return `${next.getHours().toString().padStart(2, '0')}:${next.getMinutes().toString().padStart(2, '0')}`
}

const getEventDateTime = (date: Date, time: string) => {
  const [hours, minutes] = time.split(':')
  const eventDateTime = new Date(date)
  eventDateTime.setHours(parseInt(hours || '0', 10), parseInt(minutes || '0', 10), 0, 0)
  return eventDateTime
}

const addMinutesToTime = (date: Date, time: string, minutes: number) => {
  const next = getEventDateTime(date, time)
  next.setMinutes(next.getMinutes() + minutes)
  return `${next.getHours().toString().padStart(2, '0')}:${next.getMinutes().toString().padStart(2, '0')}`
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const EVENT_TYPE_CONFIG: Record<EventType, { icon: typeof Wine; label: string; defaultColor: string }> = {
  delivery: { icon: Truck, label: 'Delivery', defaultColor: '#10B981' },
  order: { icon: Package, label: 'Order', defaultColor: '#F59E0B' },
  meeting: { icon: Users, label: 'Meeting', defaultColor: '#3B82F6' },
  inventory: { icon: Package, label: 'Inventory', defaultColor: '#8B5CF6' },
  tasting: { icon: Wine, label: 'Tasting', defaultColor: '#EC4899' },
  reminder: { icon: Bell, label: 'Reminder', defaultColor: '#EF4444' },
  recurring: { icon: Repeat, label: 'Recurring', defaultColor: '#6366F1' },
  custom: { icon: Star, label: 'Custom', defaultColor: '#6B7280' },
}

// ==================== Title with Entity Tags Component ====================
// Gmail/n8n style - detects entity names as you type and suggests tags

interface EntityTag {
  id: string
  name: string
  type: 'provider' | 'client' | 'contact' | 'wine_type' | 'label'
  badge?: string
  companyClass?: CompanyClass
}

interface TitleWithEntityTagsProps {
  value: string
  onChange: (value: string) => void
  entityOptions: EntityOption[]
  entityTags: EntityTag[]
  onAddTag: (entity: EntityOption) => void
  onRemoveTag: (tagId: string) => void
  placeholder?: string
}

function TitleWithEntityTags({
  value,
  onChange,
  entityOptions,
  entityTags,
  onAddTag,
  onRemoveTag,
  placeholder = 'Enter event title...',
}: TitleWithEntityTagsProps) {
  const [isSuggestionFocused, setIsSuggestionFocused] = useState(false)
  const [cursorPosition, setCursorPosition] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  
  // Find matching entities based on what user is typing
  const matchingEntities = useMemo(() => {
    if (!value.trim()) return []
    
    // Split the title into words/phrases and check each against entity options
    const words = value.toLowerCase().split(/[\s\-,]+/).filter(w => w.length >= 2)
    const lastWord = words[words.length - 1] || ''
    
    // Also check for multi-word matches (e.g., "Premium Napa" or "VIP")
    const lastTwoWords = words.slice(-2).join(' ')
    const lastThreeWords = words.slice(-3).join(' ')
    
    // Find entities that match any part of the title
    const matches = entityOptions.filter(opt => {
      // Skip already tagged entities
      if (entityTags.some(t => t.id === opt.id)) return false
      
      const optLabel = opt.label.toLowerCase()
      const optBadge = (opt.badge || '').toLowerCase()
      
      // Check for partial matches at the end of input (for typing suggestions)
      if (lastWord.length >= 2) {
        if (optLabel.includes(lastWord) || optBadge.includes(lastWord)) return true
      }
      if (lastTwoWords.length >= 3) {
        if (optLabel.includes(lastTwoWords)) return true
      }
      if (lastThreeWords.length >= 4) {
        if (optLabel.includes(lastThreeWords)) return true
      }
      
      // Check for full matches anywhere in title
      if (value.toLowerCase().includes(optLabel)) return true
      
      return false
    })
    
    // Sort by relevance (exact match > starts with > contains)
    return matches
      .sort((a, b) => {
        const aLabel = a.label.toLowerCase()
        const bLabel = b.label.toLowerCase()
        const input = value.toLowerCase()
        
        // Exact match in input
        const aExact = input.includes(aLabel)
        const bExact = input.includes(bLabel)
        if (aExact && !bExact) return -1
        if (bExact && !aExact) return 1
        
        // Starts with last word
        const aStarts = aLabel.startsWith(lastWord)
        const bStarts = bLabel.startsWith(lastWord)
        if (aStarts && !bStarts) return -1
        if (bStarts && !aStarts) return 1
        
        return aLabel.localeCompare(bLabel)
      })
      .slice(0, 5) // Limit to 5 suggestions
  }, [value, entityOptions, entityTags])
  
  const showSuggestions = isSuggestionFocused && matchingEntities.length > 0 && value.length >= 2
  
  const handleSelectEntity = (entity: EntityOption) => {
    onAddTag(entity)
    setIsSuggestionFocused(false)
    inputRef.current?.focus()
  }
  
  const getTagColors = (type: string, companyClass?: CompanyClass) => {
    if (type === 'provider') return 'bg-emerald-100 text-emerald-800 border-emerald-300'
    if (type === 'wine_type') return 'bg-purple-100 text-purple-800 border-purple-300'
    return 'bg-blue-100 text-blue-800 border-blue-300'
  }
  
  const getTagIcon = (type: string) => {
    if (type === 'provider') return '🚚'
    if (type === 'wine_type') return '🍷'
    return '🏷️'
  }

  return (
    <div className="relative">
      {/* Main input container with tags */}
      <div className="w-full min-h-[46px] px-3 py-2 border border-gray-200 rounded-lg bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent flex flex-wrap items-center gap-1.5">
        {/* Render entity tags as chips */}
        {entityTags.map((tag) => {
          const classConfig = tag.companyClass ? getClassConfig(tag.companyClass) : null
          return (
            <span
              key={tag.id}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${getTagColors(tag.type, tag.companyClass)} transition-all hover:shadow-sm`}
            >
              <span className="text-[10px]">{getTagIcon(tag.type)}</span>
              <span className="max-w-[100px] truncate">{tag.name}</span>
              {tag.companyClass && (
                <span 
                  className="px-1 py-0.5 rounded text-[9px] font-mono bg-black/10"
                  title={classConfig?.description || tag.companyClass}
                >
                  {tag.companyClass}
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemoveTag(tag.id)}
                className="ml-0.5 p-0.5 rounded hover:bg-black/10 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )
        })}
        
        {/* Text input */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setCursorPosition(e.target.selectionStart || 0)
          }}
          onFocus={() => setIsSuggestionFocused(true)}
          onBlur={() => setTimeout(() => setIsSuggestionFocused(false), 200)}
          placeholder={entityTags.length === 0 ? placeholder : 'Continue typing...'}
          className="flex-1 min-w-[150px] py-1 bg-transparent border-none outline-none focus:ring-0 text-sm"
          style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
        />
      </div>
      
      {/* Entity suggestions dropdown */}
      <AnimatePresence>
        {showSuggestions && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
          >
            <div className="px-3 py-2 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-600">
                ✨ Detected entities - click to tag
              </p>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {matchingEntities.map((entity) => {
                const classConfig = entity.companyClass ? getClassConfig(entity.companyClass) : null
                return (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => handleSelectEntity(entity)}
                    className="w-full px-3 py-2.5 text-left hover:bg-blue-50 transition-colors flex items-center gap-3 border-b border-gray-50 last:border-b-0"
                  >
                    {/* Entity icon */}
                    <span className="text-base flex-shrink-0">
                      {getTagIcon(entity.kind)}
                    </span>
                    
                    {/* Entity info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {entity.label}
                      </p>
                      {entity.subtitle && (
                        <p className="text-xs text-gray-500 truncate">{entity.subtitle}</p>
                      )}
                    </div>
                    
                    {/* Company Class badge */}
                    {entity.companyClass && (
                      <span className={`flex-shrink-0 text-[10px] px-2 py-1 rounded font-mono font-medium border ${
                        entity.kind === 'provider' 
                          ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                          : entity.kind === 'wine_type'
                          ? 'bg-purple-100 text-purple-700 border-purple-200'
                          : 'bg-blue-100 text-blue-700 border-blue-200'
                      }`}>
                        {entity.companyClass}
                      </span>
                    )}
                    
                    {/* Add indicator */}
                    <span className="text-blue-500 text-xs font-medium">+ Tag</span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Hint text */}
      {entityTags.length === 0 && value.length === 0 && (
        <p className="mt-1 text-xs text-gray-400">
          💡 Type "Premium Napa" or "VIP" to auto-detect entities
        </p>
      )}
    </div>
  )
}

export function Calendar() {
  const { user, activeRestaurantId } = useAuth()
  const restaurantId = activeRestaurantId || user?.restaurantId || null
  const { data: providers = [] } = useProviders(restaurantId || '')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day' | 'agenda'>('month')
  const [showEventModal, setShowEventModal] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showNewEventTypeModal, setShowNewEventTypeModal] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [filterType, setFilterType] = useState<EventType | 'all'>('all')
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const filterDropdownRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [eventTypeConfig, setEventTypeConfig] = useState(EVENT_TYPE_CONFIG)

  // Build entity options with Company Class support for AI context
  const entityOptions = useMemo<EntityOption[]>(() => {
    // Provider options with Company Class
    const providerOptions: EntityOption[] = providers.map(provider => {
      const companyClass = providerTypeToClass(provider.primaryBusinessType || 'Distributor')
      const classConfig = getClassConfig(companyClass)
      return {
        id: provider.id,
        label: provider.name,
        kind: 'provider' as const,
        badge: classConfig.shortLabel,
        subtitle: provider.email || provider.phone || provider.physicalAddress,
        companyClass,
        metadata: {
          businessType: provider.primaryBusinessType,
          rating: provider.rating,
        },
      }
    })

    // Contact options - extract from provider knownPersonnel
    const contactOptions: EntityOption[] = []
    const seenContacts = new Set<string>()
    
    providers.forEach(provider => {
      if (provider.knownPersonnel && Array.isArray(provider.knownPersonnel)) {
        provider.knownPersonnel.forEach(personName => {
          const normalizedName = personName.trim().toLowerCase()
          if (!seenContacts.has(normalizedName) && personName.trim()) {
            seenContacts.add(normalizedName)
            contactOptions.push({
              id: `contact_${provider.id}_${normalizedName.replace(/\s+/g, '_')}`,
              label: personName.trim(),
              kind: 'contact' as const,
              badge: 'Person',
              subtitle: `Contact at ${provider.name}`,
              companyClass: 'CONTACT' as CompanyClass,
              metadata: {
                providerId: provider.id,
                providerName: provider.name,
              },
            })
          }
        })
      }
    })

    // Wine type options with Company Class
    const wineTypeOptions: EntityOption[] = [
      { id: 'wine_red', label: 'Red Wine', kind: 'wine_type', badge: 'Red', companyClass: 'WINE-RED' },
      { id: 'wine_white', label: 'White Wine', kind: 'wine_type', badge: 'Wht', companyClass: 'WINE-WHT' },
      { id: 'wine_sparkling', label: 'Sparkling', kind: 'wine_type', badge: 'Spk', companyClass: 'WINE-SPK' },
      { id: 'wine_rose', label: 'Rosé', kind: 'wine_type', badge: 'Rsé', companyClass: 'WINE-RSE' },
      { id: 'wine_dessert', label: 'Dessert Wine', kind: 'wine_type', badge: 'Des', companyClass: 'WINE-DES' },
      { id: 'wine_fortified', label: 'Fortified', kind: 'wine_type', badge: 'Frt', companyClass: 'WINE-FRT' },
      { id: 'wine_natural', label: 'Natural Wine', kind: 'wine_type', badge: 'Nat', companyClass: 'WINE-NAT' },
      { id: 'wine_organic', label: 'Organic Wine', kind: 'wine_type', badge: 'Org', companyClass: 'WINE-ORG' },
    ]

    // Label options with Company Class
    const labelOptions: EntityOption[] = [
      { id: 'label_vip', label: 'VIP Client', kind: 'label', badge: 'VIP', companyClass: 'LBL-VIP', subtitle: 'Priority contact' },
      { id: 'label_wholesale', label: 'Wholesale Account', kind: 'label', badge: 'Whsl', companyClass: 'LBL-WHSL', subtitle: 'Wholesale pricing' },
      { id: 'label_event', label: 'Special Event', kind: 'label', badge: 'Evt', companyClass: 'LBL-EVNT', subtitle: 'Event-related' },
      { id: 'label_tasting', label: 'Wine Tasting', kind: 'label', badge: 'Tst', companyClass: 'LBL-TST', subtitle: 'Tasting session' },
      { id: 'label_urgent', label: 'Urgent', kind: 'label', badge: 'Urg', companyClass: 'LBL-URG', subtitle: 'Time-sensitive' },
      { id: 'label_premium', label: 'Premium', kind: 'label', badge: 'Prm', companyClass: 'LBL-PREM', subtitle: 'High-value' },
      { id: 'label_new', label: 'New Relationship', kind: 'label', badge: 'New', companyClass: 'LBL-NEW', subtitle: 'New contact' },
    ]

    return [...providerOptions, ...contactOptions, ...wineTypeOptions, ...labelOptions]
  }, [providers])

  const providerNameById = useMemo(() => {
    return new Map(providers.map(provider => [provider.id, provider.name]))
  }, [providers])
  
  // Calculate date range for current month
  const startDate = useMemo(() => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    return date.toISOString().split('T')[0]
  }, [currentDate])
  
  const endDate = useMemo(() => {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0)
    return date.toISOString().split('T')[0]
  }, [currentDate])
  
  // Fetch events from API
  const { data: apiEvents = [], isLoading, error, refetch } = useCalendarEvents(restaurantId || '', {
    startDate,
    endDate,
    eventType: filterType === 'all' ? undefined : filterType,
  })
  
  // Convert API events to local format and expand recurring events
  const events = useMemo(() => {
    // First map API events to local format
    const mapped = apiEvents.map(event => ({
      ...event,
      date: parseLocalDate(event.date),
      provider: event.provider || (event.providerId ? providerNameById.get(event.providerId) : undefined),
    }))
    // Expand recurring events into individual occurrences within the visible date range
    const expanded = expandAllRecurringEvents(
      mapped as any[],
      startDate,
      endDate,
    )
    // Ensure dates are Date objects for the calendar grid
    return expanded.map(event => ({
      ...event,
      date: typeof event.date === 'string' ? parseLocalDate(event.date) : event.date,
    }))
  }, [apiEvents, providerNameById, startDate, endDate])
  
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'pre-fix',
        hypothesisId: 'H1',
        location: 'Calendar.tsx:eventsMapping',
        message: 'calendar_event_mapping',
        data: {
          startDate,
          endDate,
          apiEventsCount: apiEvents.length,
          eventsCount: events.length,
          currentMonth: currentDate.getMonth() + 1,
          currentYear: currentDate.getFullYear(),
          firstEventDate: events[0]?.date ? new Date(events[0].date).toISOString().split('T')[0] : null,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
  }, [apiEvents.length, events.length, startDate, endDate, currentDate])
  
  const createEvent = useCreateCalendarEvent()
  const updateEvent = useUpdateCalendarEvent()
  const deleteEvent = useDeleteCalendarEvent()
  const [isCreatingEvent, setIsCreatingEvent] = useState(false)

  // New event form state - MOVED BEFORE CONDITIONAL RETURNS
  const [newEvent, setNewEvent] = useState<Partial<CalendarEvent>>({
    title: '',
    type: 'meeting',
    date: new Date(),
    startTime: '09:00',
    endTime: '10:00',
    description: '',
    color: '#3B82F6',
    recurring: {
      enabled: false,
      frequency: 'weekly',
      interval: 1,
      daysOfWeek: [],
      endType: 'never',
    },
    relatedEntity: undefined,
    entityTags: [], // Multiple tags for comprehensive AI context
  })
  const [relatedEntitySearch, setRelatedEntitySearch] = useState('')

  const startTimeRef = useRef<HTMLInputElement>(null)
  const endTimeRef = useRef<HTMLInputElement>(null)

  const updateTimeField = (
    field: 'startTime' | 'endTime',
    rawValue: string,
    ref: { current: HTMLInputElement | null }
  ) => {
    const formatted = formatTimeInput(rawValue)
    const shouldAdvance = formatted.length === 2 && !formatted.includes(':')
    const nextValue = shouldAdvance ? `${formatted}:` : formatted

    setNewEvent(prev => ({ ...prev, [field]: nextValue }))

    if (shouldAdvance) {
      requestAnimationFrame(() => {
        ref.current?.setSelectionRange(3, 3)
      })
    }
  }

  const normalizeTimeField = (field: 'startTime' | 'endTime', rawValue: string) => {
    const clamped = clampTime(rawValue)
    setNewEvent(prev => {
      const nextDate = prev.date ? new Date(prev.date) : new Date()
      const next = { ...prev, [field]: clamped }
      if (field === 'startTime' && clamped && next.endTime) {
        const start = getEventDateTime(nextDate, clamped)
        const end = getEventDateTime(nextDate, clampTime(next.endTime))
        if (end <= start) {
          next.endTime = addMinutesToTime(nextDate, clamped, 60)
        }
      }
      return next
    })
  }

  function parseLocalDate(value: string) {
    const [year, month, day] = value.split('-').map(Number)
    return new Date(year, month - 1, day)
  }

  const formatDateInput = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const handleDateChange = (value: string) => {
    const nextDate = parseLocalDate(value)
    let nextStartTime = newEvent.startTime || '09:00'
    let nextEndTime = newEvent.endTime || '10:00'

    if (isSameDay(nextDate, new Date())) {
      const candidateStart = getEventDateTime(nextDate, clampTime(nextStartTime))
      if (candidateStart < new Date()) {
        const nextSlot = getNextTimeSlot(new Date())
        nextStartTime = nextSlot
        nextEndTime = addMinutesToTime(nextDate, nextSlot, 60)
      }
    }

    setNewEvent(prev => ({
      ...prev,
      date: nextDate,
      startTime: nextStartTime,
      endTime: nextEndTime,
    }))
  }

  // Load custom event types - MUST BE BEFORE CONDITIONAL RETURNS
  const loadCustomTypes = useCallback(() => {
    const customTypes = getCustomEventTypes()
    const updatedConfig = { ...EVENT_TYPE_CONFIG }
    
    customTypes.forEach((customType) => {
      updatedConfig[customType.name.toLowerCase() as EventType] = {
        icon: Star, // All custom types use Star icon for now
        label: customType.name,
        defaultColor: customType.color,
      }
    })
    
    setEventTypeConfig(updatedConfig)
  }, [])

  useEffect(() => {
    loadCustomTypes()
  }, [loadCustomTypes])

  // Close filter dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(event.target as Node)) {
        setShowFilterDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle realtime calendar events - MUST BE BEFORE CONDITIONAL RETURNS
  const handleCalendarEventUpdate = useCallback((payload: any) => {
    // Refetch to get latest data from server instead of manually updating state
    console.log('Calendar received event update, refetching...')
    refetch()
  }, [refetch])

  useCalendarEventsSubscription(handleCalendarEventUpdate)

  // Computed values - MUST BE BEFORE CONDITIONAL RETURNS
  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()
  const daysInMonth = getDaysInMonth(year, month)
  const firstDayOfMonth = getFirstDayOfMonth(year, month)

  // Filter events - MUST BE BEFORE CONDITIONAL RETURNS
  const filteredEvents = useMemo(() => {
    let filtered = events
    if (filterType !== 'all') {
      filtered = filtered.filter(e => e.type === filterType)
    }
    if (searchQuery) {
      filtered = filtered.filter(e => 
        e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.provider?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }
    return filtered
  }, [events, filterType, searchQuery])
  
  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'pre-fix',
        hypothesisId: 'H1',
        location: 'Calendar.tsx:filteredEvents',
        message: 'calendar_filtered_events',
        data: {
          filterType,
          searchQuery: searchQuery || null,
          filteredCount: filteredEvents.length,
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
  }, [filteredEvents.length, filterType, searchQuery])

  // Generate calendar grid - MUST BE BEFORE CONDITIONAL RETURNS
  const calendarDays = useMemo(() => {
    const days: (number | null)[] = []
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < firstDayOfMonth; i++) {
      days.push(null)
    }
    
    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(day)
    }
    
    return days
  }, [firstDayOfMonth, daysInMonth])

  // Get upcoming events for sidebar - MUST BE BEFORE CONDITIONAL RETURNS
  const upcomingEvents = useMemo(() => {
    const now = new Date()
    return filteredEvents
      .filter(e => new Date(e.date) >= now)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 5)
  }, [filteredEvents])

  const now = new Date()
  const eventDate = newEvent.date ? new Date(newEvent.date) : new Date()
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)

  const startDateTime = newEvent.startTime ? getEventDateTime(eventDate, newEvent.startTime) : null
  const endDateTime = newEvent.endTime ? getEventDateTime(eventDate, newEvent.endTime) : null

  const isPastDate = eventDate < startOfToday
  const isPastTimeToday = !newEvent.allDay && isSameDay(eventDate, now) && !!startDateTime && startDateTime < now
  const isEndBeforeStart = !newEvent.allDay && !!startDateTime && !!endDateTime && endDateTime <= startDateTime

  const timeErrorMessage = isPastDate
    ? 'Events cannot be created in the past.'
    : isPastTimeToday
      ? 'Start time must be in the future.'
      : isEndBeforeStart
        ? 'End time must be after start time.'
        : ''

  const canCreateEvent = !!newEvent.title && !timeErrorMessage

  // Show loading state (only on initial load)
  if (isLoading && !events.length) {
    return (
      <div className="min-h-screen">
        <Header title="Calendar" subtitle="Schedule and track important dates" />
        <div className="p-6">
          <PageSkeleton />
        </div>
      </div>
    )
  }
  
  // Show error state only if no cached data
  if (error && !events.length) {
    return (
      <div className="min-h-screen">
        <Header title="Calendar" subtitle="Schedule and track important dates" />
        <div className="p-6">
          <ErrorState 
            variant="network"
            title="Unable to load calendar events"
            description="The backend API is not available. This page will work once the backend is connected."
            action={{ label: 'Retry', onClick: () => refetch() }}
          />
        </div>
      </div>
    )
  }

  // Handle deletion of custom event types
  const handleDeleteCustomEventType = (typeName: string) => {
    if (!confirm(`Delete "${typeName}" event type?\n\nAll events using this type will be converted to "Custom" type.`)) {
      return
    }

    // Delete the custom event type
    deleteCustomEventType(typeName)

    // Refetch events to get updated data from server
    refetch()

    // Reload custom types config
    loadCustomTypes()

    // If the current new event is using this type, reset it
    if (newEvent.type === typeName.toLowerCase() || newEvent.type === typeName) {
      setNewEvent({
        ...newEvent,
        type: 'custom' as EventType,
        color: EVENT_TYPE_CONFIG.custom.defaultColor,
      })
    }
  }

  // Get events for a specific date
  const getEventsForDate = (date: Date) => {
    return filteredEvents.filter(event => isSameDay(new Date(event.date), date))
  }

  // Navigation
  const goToPreviousMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1))
  }

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1))
  }

  const goToToday = () => {
    setCurrentDate(new Date())
    setSelectedDate(new Date())
  }

  // Event handlers
  const handleDateClick = (day: number) => {
    const clickedDate = new Date(year, month, day)
    setSelectedDate(clickedDate)
    setNewEvent(prev => ({ ...prev, date: clickedDate }))
  }

  const handleEventClick = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedEvent(event)
    setShowEventModal(true)
  }

  const handleCreateEvent = async () => {
    if (isCreatingEvent || createEvent.isPending) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'debug-session',
          runId: 'pre-fix',
          hypothesisId: 'H3',
          location: 'Calendar.tsx:handleCreateEvent',
          message: 'calendar_create_ignored_duplicate',
          data: { isCreatingEvent, isPending: createEvent.isPending },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
      return
    }
    setIsCreatingEvent(true)
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'pre-fix',
        hypothesisId: 'H1',
        location: 'Calendar.tsx:handleCreateEvent',
        message: 'calendar_create_attempt',
        data: {
          titlePresent: !!newEvent.title?.trim(),
          restaurantIdPresent: !!restaurantId,
          timeErrorMessage: timeErrorMessage || null,
          allDay: !!newEvent.allDay,
          startTime: newEvent.startTime || null,
          endTime: newEvent.endTime || null,
          eventType: newEvent.type || 'meeting',
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {})
    // #endregion
    // Validate required fields with explicit feedback
    if (!newEvent.title?.trim()) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'debug-session',
          runId: 'pre-fix',
          hypothesisId: 'H1',
          location: 'Calendar.tsx:handleCreateEvent',
          message: 'calendar_create_blocked',
          data: { reason: 'missing_title' },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
      console.warn('[Calendar] Event creation blocked: Missing title')
      return
    }
    
    if (!restaurantId) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'debug-session',
          runId: 'pre-fix',
          hypothesisId: 'H1',
          location: 'Calendar.tsx:handleCreateEvent',
          message: 'calendar_create_blocked',
          data: { reason: 'missing_restaurant_id' },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
      console.error('[Calendar] Event creation blocked: Missing restaurantId - user may not be authenticated')
      alert('Unable to create event. Please ensure you are logged in and try again.')
      return
    }
    
    if (timeErrorMessage) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'debug-session',
          runId: 'pre-fix',
          hypothesisId: 'H1',
          location: 'Calendar.tsx:handleCreateEvent',
          message: 'calendar_create_blocked',
          data: { reason: 'time_validation_error', timeErrorMessage },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
      console.warn('[Calendar] Event creation blocked: Time validation error -', timeErrorMessage)
      return
    }

    // Log event creation attempt for debugging
    console.log('[Calendar] Creating event:', {
      title: newEvent.title,
      type: newEvent.type,
      date: newEvent.date,
      restaurantId,
      hasRelatedEntity: !!newEvent.relatedEntity,
    })

    try {
      const baseEventTypes: EventType[] = ['delivery', 'order', 'meeting', 'inventory', 'tasting', 'reminder', 'recurring', 'custom']
      const isCustomType = !!newEvent.type && !baseEventTypes.includes(newEvent.type as EventType)
      const normalizedEventType: EventType = (isCustomType ? 'custom' : (newEvent.type || 'meeting')) as EventType
      const relatedEntityTag = newEvent.relatedEntity && newEvent.relatedEntity.type !== 'provider'
        ? `[tag:${newEvent.relatedEntity.type}:${newEvent.relatedEntity.name}]`
        : undefined
      const customTypeTag = isCustomType ? `[custom_type:${newEvent.type}]` : undefined
      const descriptionWithTag = [newEvent.description?.trim(), relatedEntityTag, customTypeTag]
        .filter(Boolean)
        .join('\n')

      const eventData = {
        title: newEvent.title.trim(),
        type: normalizedEventType,
        date: formatDateInput(newEvent.date || new Date()),
        startTime: newEvent.startTime,
        endTime: newEvent.endTime,
        allDay: newEvent.allDay,
        description: descriptionWithTag || undefined,
        location: newEvent.location?.trim(),
        color: newEvent.color || EVENT_TYPE_CONFIG[newEvent.type || 'meeting'].defaultColor,
        status: 'pending' as const,
        reminders: newEvent.reminders,
        customReminderMinutes: newEvent.customReminderMinutes,
        recurring: newEvent.recurring?.enabled ? {
          ...newEvent.recurring,
          endDate: newEvent.recurring.endDate?.toISOString().split('T')[0],
        } : undefined,
        // Include provider from related entity if available
        provider: newEvent.relatedEntity?.type === 'provider' 
          ? newEvent.relatedEntity.name 
          : newEvent.provider,
        providerId: newEvent.relatedEntity?.type === 'provider'
          ? newEvent.relatedEntity.id
          : undefined,
        restaurantId,
      }

      const created = await createEvent.mutateAsync(eventData)

      console.log('[Calendar] Event created successfully:', created.id)
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'debug-session',
          runId: 'pre-fix',
          hypothesisId: 'H2',
          location: 'Calendar.tsx:handleCreateEvent',
          message: 'calendar_create_success',
          data: { eventId: created?.id || null },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion

      // Send push notification for calendar event
      if (user?.userId && restaurantId) {
        try {
          await createNotification({
            userId: user.userId,
            restaurantId: restaurantId,
            type: 'calendar_reminder',
            title: `📅 New Calendar Event: ${newEvent.title}`,
            message: `${(eventTypeConfig[newEvent.type || 'meeting'] ?? eventTypeConfig.custom).label} scheduled for ${formatDateInput(newEvent.date || new Date())}${!newEvent.allDay && newEvent.startTime ? ` at ${formatTime(newEvent.startTime)}` : ''}`,
            priority: 'medium',
            actionUrl: '/calendar',
            actionLabel: 'View Calendar',
            metadata: {
              eventId: created.id,
              eventType: newEvent.type,
              eventDate: formatDateInput(newEvent.date || new Date()),
              provider: newEvent.provider || newEvent.relatedEntity?.name,
            },
          })
          console.log('[Calendar] Push notification sent for event:', created.id)
        } catch (notifError) {
          console.warn('[Calendar] Failed to send push notification:', notifError)
          // Don't block event creation if notification fails
        }
      }

      // Schedule reminders for this event
      if (newEvent.reminders && newEvent.reminders.length > 0) {
        newEvent.reminders.forEach((reminderType) => {
          scheduleReminder({
            eventId: created.id,
            title: newEvent.title || '',
            eventType: newEvent.type || 'meeting',
            date: newEvent.date || new Date(),
            startTime: newEvent.startTime,
            reminderType,
            customMinutes: newEvent.customReminderMinutes,
          })
        })
      }

      // Success - close modal and reset form
      setShowCreateModal(false)
      setRelatedEntitySearch('')
      setNewEvent({
        title: '',
        type: 'meeting',
        date: selectedDate || new Date(),
        startTime: '09:00',
        endTime: '10:00',
        description: '',
        color: '#3B82F6',
        recurring: {
          enabled: false,
          frequency: 'weekly',
          interval: 1,
          daysOfWeek: [],
          endType: 'never',
        },
        relatedEntity: undefined,
      })
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/626cdea4-d9db-4e9f-b37f-f410baa5330f', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'debug-session',
          runId: 'pre-fix',
          hypothesisId: 'H2',
          location: 'Calendar.tsx:handleCreateEvent',
          message: 'calendar_create_error',
          data: {
            message: error?.message || 'Unknown error',
            status: error?.response?.status || null,
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {})
      // #endregion
      // Enhanced error logging
      console.error('[Calendar] Failed to create event:', {
        error,
        message: error?.message || 'Unknown error',
        response: error?.response?.data,
        eventData: { title: newEvent.title, type: newEvent.type, date: newEvent.date },
      })
      // Error toast is already handled by the mutation's onError callback
      // Keep the modal open so user can retry or cancel
    } finally {
      setIsCreatingEvent(false)
    }
  }

  const handleDeleteEvent = async (eventId: string) => {
    if (confirm('Delete this event?')) {
      await deleteEvent.mutateAsync(eventId)
      setShowEventModal(false)
      setSelectedEvent(null)
    }
  }

  const handleUpdateEventStatus = async (eventId: string, status: CalendarEvent['status']) => {
    if (!status) return
    const event = events.find(e => e.id === eventId)
    await updateEvent.mutateAsync({ id: eventId, status })
    
    // Send push notification for status change
    if (user?.userId && restaurantId && event && status === 'confirmed') {
      try {
        await createNotification({
          userId: user.userId,
          restaurantId: restaurantId,
          type: 'calendar_reminder',
          title: `✅ Event Confirmed: ${event.title}`,
          message: `${(eventTypeConfig[event.type] ?? eventTypeConfig.custom).label} on ${formatDateInput(event.date)} has been confirmed.`,
          priority: 'low',
          actionUrl: '/calendar',
          actionLabel: 'View Calendar',
          metadata: {
            eventId,
            eventType: event.type,
            status,
          },
        })
      } catch (notifError) {
        console.warn('[Calendar] Failed to send status update notification:', notifError)
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header 
        title="Calendar" 
        subtitle="Manage deliveries, orders, tastings, and events" 
      />

      <div className="p-6">
        {/* Top Bar */}
        <Card variant="glass" padding="md" className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Navigation */}
              <div className="flex items-center gap-2">
                <button
                  onClick={goToPreviousMonth}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  onClick={goToNextMonth}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <h2 className="text-xl font-bold text-gray-900">
                {MONTHS[month]} {year}
              </h2>

              <Button variant="outline" size="sm" onClick={goToToday}>
                Today
              </Button>
            </div>

            <div className="flex items-center gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search events..."
                  className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg bg-white text-sm w-48 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                />
              </div>

              {/* Filter Dropdown */}
              <div className="relative" ref={filterDropdownRef}>
                <button
                  onClick={() => setShowFilterDropdown(!showFilterDropdown)}
                  className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-all ${
                    filterType !== 'all'
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {filterType === 'all' ? (
                    <>
                      <Filter className="w-4 h-4" />
                      <span>All Events</span>
                    </>
                  ) : (
                    <>
                      {(() => {
                        const config = eventTypeConfig[filterType]
                        const Icon = config?.icon || Filter
                        return <Icon className="w-4 h-4" />
                      })()}
                      <span>{eventTypeConfig[filterType]?.label || filterType}</span>
                    </>
                  )}
                  <ChevronDown className={`w-4 h-4 transition-transform ${showFilterDropdown ? 'rotate-180' : ''}`} />
                </button>

                <AnimatePresence>
                  {showFilterDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 overflow-hidden"
                    >
                      {/* All Events Option */}
                      <button
                        onClick={() => {
                          setFilterType('all')
                          setShowFilterDropdown(false)
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          filterType === 'all'
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          filterType === 'all' ? 'bg-blue-100' : 'bg-gray-100'
                        }`}>
                          <Filter className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                          <span className="text-sm font-medium">All Events</span>
                        </div>
                        {filterType === 'all' && <Check className="w-4 h-4 text-blue-600" />}
                      </button>

                      <div className="h-px bg-gray-100 my-1" />

                      {/* Event Type Options */}
                      {Object.entries(eventTypeConfig).map(([type, config]) => {
                        const Icon = config.icon
                        const isSelected = filterType === type
                        return (
                          <button
                            key={type}
                            onClick={() => {
                              setFilterType(type as EventType)
                              setShowFilterDropdown(false)
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                              isSelected
                                ? 'bg-blue-50 text-blue-700'
                                : 'text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            <div 
                              className="w-8 h-8 rounded-lg flex items-center justify-center"
                              style={{ backgroundColor: `${config.defaultColor}20` }}
                            >
                              <Icon className="w-4 h-4" style={{ color: config.defaultColor }} />
                            </div>
                            <div className="flex-1">
                              <span className="text-sm font-medium">{config.label}</span>
                            </div>
                            {isSelected && <Check className="w-4 h-4 text-blue-600" />}
                          </button>
                        )
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* View Mode */}
              <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                {[
                  { mode: 'month' as const, icon: Grid3X3, label: 'Month' },
                  { mode: 'agenda' as const, icon: List, label: 'Agenda' },
                ].map(({ mode, icon: Icon, label }) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      viewMode === mode
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Create Event */}
              <Button
                variant="default"
                onClick={() => setShowCreateModal(true)}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Event
              </Button>
            </div>
          </div>
        </Card>

        <div className="flex gap-6">
          {/* Main Calendar */}
          <div className="flex-1">
            {viewMode === 'month' && (
              <Card variant="glass" padding="none" className="overflow-hidden">
                {/* Day Headers */}
                <div className="grid grid-cols-7 bg-gray-50 border-b border-gray-200">
                  {DAYS.map((day) => (
                    <div
                      key={day}
                      className="py-3 text-center text-sm font-semibold text-gray-600"
                    >
                      {day}
                    </div>
                  ))}
                </div>

                {/* Calendar Grid */}
                <div className="grid grid-cols-7 divide-x divide-y divide-gray-100">
                  {calendarDays.map((day, index) => {
                    if (day === null) {
                      return <div key={`empty-${index}`} className="h-32 bg-gray-50/50" />
                    }

                    const date = new Date(year, month, day)
                    const dayEvents = getEventsForDate(date)
                    const isSelected = selectedDate && isSameDay(date, selectedDate)
                    const isTodayDate = isToday(date)

                    return (
                      <motion.div
                        key={day}
                        onClick={() => handleDateClick(day)}
                        className={`h-32 p-2 cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                        whileHover={{ scale: 1.01 }}
                      >
                        {/* Day Number */}
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium ${
                              isTodayDate
                                ? 'bg-blue-600 text-white'
                                : isSelected
                                ? 'bg-blue-100 text-blue-700'
                                : 'text-gray-700'
                            }`}
                          >
                            {day}
                          </span>
                          {dayEvents.length > 3 && (
                            <span className="text-xs text-gray-500">
                              +{dayEvents.length - 3} more
                            </span>
                          )}
                        </div>

                        {/* Events */}
                        <div className="space-y-1 overflow-hidden">
                          {dayEvents.slice(0, 3).map((event) => {
                            const TypeIcon = (eventTypeConfig[event.type] ?? eventTypeConfig.custom).icon
                            return (
                              <motion.div
                                key={event.id}
                                onClick={(e) => handleEventClick(event, e)}
                                className="group flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium truncate cursor-pointer hover:opacity-90 transition-opacity"
                                style={{ backgroundColor: event.color + '20', color: event.color }}
                                whileHover={{ scale: 1.02 }}
                              >
                                <TypeIcon className="w-3 h-3 flex-shrink-0" />
                                <span className="truncate">{event.title}</span>
                              </motion.div>
                            )
                          })}
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </Card>
            )}

            {viewMode === 'agenda' && (
              <Card variant="glass" padding="lg">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Upcoming Events</h3>
                <div className="space-y-3">
                  {filteredEvents
                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .map((event) => {
                      const TypeIcon = (eventTypeConfig[event.type] ?? eventTypeConfig.custom).icon
                      const eventDate = new Date(event.date)
                      
                      return (
                        <motion.div
                          key={event.id}
                          onClick={(e) => handleEventClick(event, e as any)}
                          className="flex items-start gap-4 p-4 bg-white rounded-xl border border-gray-200 hover:shadow-md hover:border-gray-300 cursor-pointer transition-all"
                          whileHover={{ y: -2 }}
                        >
                          <div
                            className="p-3 rounded-xl"
                            style={{ backgroundColor: event.color + '20' }}
                          >
                            <TypeIcon className="w-5 h-5" style={{ color: event.color }} />
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between mb-1">
                              <h4 className="font-semibold text-gray-900">{event.title}</h4>
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  event.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                                  event.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                                  event.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                  'bg-yellow-100 text-yellow-700'
                                }`}
                              >
                                {event.status}
                              </span>
                            </div>
                            
                            <div className="flex items-center gap-4 text-sm text-gray-600">
                              <div className="flex items-center gap-1">
                                <CalendarIcon className="w-4 h-4" />
                                <span>{eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                              </div>
                              {event.startTime && (
                                <div className="flex items-center gap-1">
                                  <Clock className="w-4 h-4" />
                                  <span>{formatTime(event.startTime)}</span>
                                  {event.endTime && <span>- {formatTime(event.endTime)}</span>}
                                </div>
                              )}
                              {event.allDay && (
                                <span className="text-xs bg-gray-100 px-2 py-0.5 rounded">All Day</span>
                              )}
                            </div>
                            
                            {event.description && (
                              <p className="text-sm text-gray-500 mt-2 line-clamp-1">{event.description}</p>
                            )}
                          </div>
                        </motion.div>
                      )
                    })}
                </div>
              </Card>
            )}
          </div>

          {/* Right Sidebar */}
          <div className="w-80 space-y-6">
            {/* Selected Date Details */}
            {selectedDate && (
              <Card variant="glass" padding="lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900">
                    {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setNewEvent(prev => ({ ...prev, date: selectedDate }))
                      setShowCreateModal(true)
                    }}
                  >
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>

                {getEventsForDate(selectedDate).length === 0 ? (
                  <div className="text-center py-8">
                    <CalendarIcon className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500 text-sm">No events scheduled</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {getEventsForDate(selectedDate).map((event) => {
                      const TypeIcon = (eventTypeConfig[event.type] ?? eventTypeConfig.custom).icon
                      return (
                        <div
                          key={event.id}
                          onClick={(e) => handleEventClick(event, e as any)}
                          className="p-3 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                          style={{ borderLeft: `3px solid ${event.color}` }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <TypeIcon className="w-4 h-4" style={{ color: event.color }} />
                            <span className="font-medium text-sm text-gray-900">{event.title}</span>
                          </div>
                          {event.startTime && (
                            <p className="text-xs text-gray-500 ml-6">
                              {formatTime(event.startTime)}
                              {event.endTime && ` - ${formatTime(event.endTime)}`}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>
            )}

            {/* Quick Stats */}
            <Card variant="glass" padding="lg">
              <h3 className="font-bold text-gray-900 mb-4">This Month</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { type: 'delivery', count: events.filter(e => e.type === 'delivery' && new Date(e.date).getMonth() === month).length },
                  { type: 'order', count: events.filter(e => e.type === 'order' && new Date(e.date).getMonth() === month).length },
                  { type: 'meeting', count: events.filter(e => e.type === 'meeting' && new Date(e.date).getMonth() === month).length },
                  { type: 'tasting', count: events.filter(e => e.type === 'tasting' && new Date(e.date).getMonth() === month).length },
                ].map(({ type, count }) => {
                  const config = EVENT_TYPE_CONFIG[type as EventType]
                  const Icon = config.icon
                  return (
                    <div
                      key={type}
                      className="p-3 rounded-lg text-center"
                      style={{ backgroundColor: config.defaultColor + '15' }}
                    >
                      <Icon className="w-5 h-5 mx-auto mb-1" style={{ color: config.defaultColor }} />
                      <p className="text-2xl font-bold" style={{ color: config.defaultColor }}>{count}</p>
                      <p className="text-xs text-gray-600">{config.label}s</p>
                    </div>
                  )
                })}
              </div>
            </Card>

            {/* Upcoming */}
            <Card variant="glass" padding="lg">
              <h3 className="font-bold text-gray-900 mb-4">Coming Up</h3>
              <div className="space-y-3">
                {upcomingEvents.map((event) => {
                  const TypeIcon = (eventTypeConfig[event.type] ?? eventTypeConfig.custom).icon
                  const eventDate = new Date(event.date)
                  const isEventToday = isToday(eventDate)
                  
                  return (
                    <div
                      key={event.id}
                      onClick={(e) => handleEventClick(event, e as any)}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <div
                        className="p-2 rounded-lg"
                        style={{ backgroundColor: event.color + '20' }}
                      >
                        <TypeIcon className="w-4 h-4" style={{ color: event.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                        <p className="text-xs text-gray-500">
                          {isEventToday ? 'Today' : eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                          {event.startTime && ` · ${formatTime(event.startTime)}`}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        </div>
      </div>

      {/* Event Details Modal */}
      <AnimatePresence>
        {showEventModal && selectedEvent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
            onClick={() => setShowEventModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              {/* Header */}
              <div
                className="px-6 py-4"
                style={{ backgroundColor: selectedEvent.color + '20' }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="p-3 rounded-xl"
                      style={{ backgroundColor: selectedEvent.color }}
                    >
                      {(() => {
                        const Icon = (EVENT_TYPE_CONFIG[selectedEvent.type] ?? EVENT_TYPE_CONFIG.custom).icon
                        return <Icon className="w-6 h-6 text-white" />
                      })()}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">{selectedEvent.title}</h2>
                      <p className="text-sm" style={{ color: selectedEvent.color }}>
                        {(EVENT_TYPE_CONFIG[selectedEvent.type] ?? EVENT_TYPE_CONFIG.custom).label}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowEventModal(false)}
                    className="p-2 hover:bg-black/10 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-6 space-y-4">
                {/* Date & Time */}
                <div className="flex items-center gap-3 text-gray-700">
                  <CalendarIcon className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="font-medium">
                      {new Date(selectedEvent.date).toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                      })}
                    </p>
                    {selectedEvent.allDay ? (
                      <p className="text-sm text-gray-500">All day</p>
                    ) : selectedEvent.startTime && (
                      <p className="text-sm text-gray-500">
                        {formatTime(selectedEvent.startTime)}
                        {selectedEvent.endTime && ` - ${formatTime(selectedEvent.endTime)}`}
                      </p>
                    )}
                  </div>
                </div>

                {/* Location */}
                {selectedEvent.location && (
                  <div className="flex items-center gap-3 text-gray-700">
                    <MapPin className="w-5 h-5 text-gray-400" />
                    <p>{selectedEvent.location}</p>
                  </div>
                )}

                {/* Provider */}
                {selectedEvent.provider && (
                  <div className="flex items-center gap-3 text-gray-700">
                    <Truck className="w-5 h-5 text-gray-400" />
                    <p>{selectedEvent.provider}</p>
                  </div>
                )}

                {/* Attendees */}
                {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                  <div className="flex items-start gap-3 text-gray-700">
                    <Users className="w-5 h-5 text-gray-400 mt-0.5" />
                    <div>
                      <p className="font-medium mb-1">Attendees</p>
                      <div className="flex flex-wrap gap-2">
                        {selectedEvent.attendees.map((attendee, idx) => (
                          <span key={idx} className="px-2 py-1 bg-gray-100 rounded-full text-sm">
                            {attendee}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Wine Info */}
                {(selectedEvent.wineCount || selectedEvent.totalValue) && (
                  <div className="flex items-center gap-6 p-4 bg-gray-50 rounded-xl">
                    {selectedEvent.wineCount && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-gray-900">{selectedEvent.wineCount}</p>
                        <p className="text-xs text-gray-500">Cases</p>
                      </div>
                    )}
                    {selectedEvent.totalValue && (
                      <div className="text-center">
                        <p className="text-2xl font-bold text-emerald-600">${selectedEvent.totalValue.toLocaleString()}</p>
                        <p className="text-xs text-gray-500">Total Value</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Description */}
                {selectedEvent.description && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Description</p>
                    <p className="text-gray-700">{selectedEvent.description}</p>
                  </div>
                )}

                {/* Status */}
                <div className="flex items-center gap-2">
                  <p className="text-sm text-gray-500">Status:</p>
                  <select
                    value={selectedEvent.status}
                    onChange={(e) => handleUpdateEventStatus(selectedEvent.id, e.target.value as CalendarEvent['status'])}
                    className={`px-3 py-1 rounded-full text-sm font-medium border-0 cursor-pointer ${
                      selectedEvent.status === 'confirmed' ? 'bg-green-100 text-green-700' :
                      selectedEvent.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                      selectedEvent.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}
                  >
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-between">
                <button
                  onClick={() => handleDeleteEvent(selectedEvent.id)}
                  className="flex items-center gap-2 px-4 py-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setShowEventModal(false)}>
                    Close
                  </Button>
                  <Button variant="default" className="bg-blue-600 hover:bg-blue-700">
                    <Edit3 className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Event Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
            onClick={() => setShowCreateModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
            >
              {/* Header */}
              <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-lg">
                      <Plus className="w-5 h-5 text-white" />
                    </div>
                    <h2 className="text-lg font-bold text-white">Create Event</h2>
                  </div>
                  <button
                    onClick={() => setShowCreateModal(false)}
                    className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-white" />
                  </button>
                </div>
              </div>

              {/* Form */}
              <div className="p-6 space-y-4 overflow-y-auto max-h-[60vh]">
                {/* Title with inline entity detection */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Event Title
                    <span className="ml-2 text-xs text-gray-400 font-normal">
                      Type entity names to auto-tag
                    </span>
                  </label>
                  <TitleWithEntityTags
                    value={newEvent.title || ''}
                    onChange={(title) => setNewEvent({ ...newEvent, title })}
                    entityOptions={entityOptions}
                    entityTags={newEvent.entityTags || []}
                    onAddTag={(entity) => {
                      const newTag = {
                        id: entity.id,
                        name: entity.label,
                        type: entity.kind,
                        badge: entity.badge,
                        companyClass: entity.companyClass,
                      }
                      const currentTags = newEvent.entityTags || []
                      if (currentTags.some(t => t.id === entity.id)) return
                      
                      const updatedTags = [...currentTags, newTag]
                      setNewEvent({
                        ...newEvent,
                        entityTags: updatedTags,
                        relatedEntity: updatedTags[0] ? {
                          id: updatedTags[0].id,
                          name: updatedTags[0].name,
                          type: updatedTags[0].type,
                          badge: updatedTags[0].badge,
                          companyClass: updatedTags[0].companyClass,
                        } : undefined,
                        provider: entity.kind === 'provider' ? entity.label : newEvent.provider,
                      })
                    }}
                    onRemoveTag={(tagId) => {
                      const updatedTags = (newEvent.entityTags || []).filter(t => t.id !== tagId)
                      const removedTag = (newEvent.entityTags || []).find(t => t.id === tagId)
                      setNewEvent({
                        ...newEvent,
                        entityTags: updatedTags,
                        relatedEntity: updatedTags[0] ? {
                          id: updatedTags[0].id,
                          name: updatedTags[0].name,
                          type: updatedTags[0].type,
                          badge: updatedTags[0].badge,
                          companyClass: updatedTags[0].companyClass,
                        } : undefined,
                        provider: removedTag?.type === 'provider' && newEvent.provider === removedTag.name
                          ? (updatedTags.find(t => t.type === 'provider')?.name || '')
                          : newEvent.provider,
                      })
                    }}
                    placeholder="Enter event title..."
                  />
                </div>

                {/* Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Event Type</label>
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(eventTypeConfig).map(([type, config]) => {
                      const Icon = config.icon
                      const isSelected = newEvent.type === type
                      const isCustomType = type === 'custom'
                      const isUserCustomType = isCustomEventType(type)
                      
                      return (
                        <div key={type} className="relative group">
                          <button
                            onClick={() => {
                              if (isCustomType) {
                                setShowNewEventTypeModal(true)
                              } else {
                                setNewEvent({ ...newEvent, type: type as EventType, color: config.defaultColor })
                              }
                            }}
                            className={`w-full p-3 rounded-lg border-2 transition-all ${
                              isSelected
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <Icon className="w-5 h-5 mx-auto mb-1" style={{ color: config.defaultColor }} />
                            <p className="text-xs font-medium text-gray-700">{config.label}</p>
                          </button>
                          
                          {/* Delete button for custom event types */}
                          {isUserCustomType && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDeleteCustomEventType(type)
                              }}
                              className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600 shadow-lg"
                              title={`Delete "${config.label}" event type`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <p className="mt-2 text-xs text-gray-600">
                    💡 Hover over custom event types to delete them
                  </p>
                </div>

                {/* Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Date</label>
                  <input
                    type="date"
                    value={newEvent.date ? formatDateInput(new Date(newEvent.date)) : ''}
                    onChange={(e) => handleDateChange(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                  />
                </div>

                {/* Time */}
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={newEvent.allDay}
                      onChange={(e) => setNewEvent({ ...newEvent, allDay: e.target.checked })}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <span className="text-sm text-gray-700">All day</span>
                  </label>
                </div>

                {!newEvent.allDay && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Start Time</label>
                      <input
                        ref={startTimeRef}
                        type="text"
                        inputMode="numeric"
                        placeholder="HH:MM"
                        value={newEvent.startTime || ''}
                        onChange={(e) => updateTimeField('startTime', e.target.value, startTimeRef)}
                        onBlur={(e) => normalizeTimeField('startTime', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">End Time</label>
                      <input
                        ref={endTimeRef}
                        type="text"
                        inputMode="numeric"
                        placeholder="HH:MM"
                        value={newEvent.endTime || ''}
                        onChange={(e) => updateTimeField('endTime', e.target.value, endTimeRef)}
                        onBlur={(e) => normalizeTimeField('endTime', e.target.value)}
                        className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                      />
                    </div>
                  </div>
                )}

                {!!timeErrorMessage && (
                  <p className="text-sm text-rose-600 mt-2">{timeErrorMessage}</p>
                )}

                {/* Location */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Location (optional)</label>
                  <input
                    type="text"
                    value={newEvent.location || ''}
                    onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
                    placeholder="Enter location..."
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                  />
                </div>

                {/* AI Context Tags Summary - Shows when entities are tagged */}
                {(newEvent.entityTags || []).length > 0 && (
                  <div className="p-3 bg-gradient-to-r from-gray-50 to-blue-50 rounded-lg border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
                        <span className="text-blue-500">🤖</span> AI Context Tags
                      </div>
                      <span className="text-[10px] text-gray-400">
                        {(newEvent.entityTags || []).length} tagged
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(newEvent.entityTags || []).map((tag, index) => {
                        const classConfig = tag.companyClass ? getClassConfig(tag.companyClass) : null
                        const chipColors = tag.type === 'provider' 
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                          : tag.type === 'wine_type'
                          ? 'bg-purple-100 text-purple-800 border-purple-200'
                          : 'bg-blue-100 text-blue-800 border-blue-200'
                        
                        return (
                          <span 
                            key={`summary-${tag.id}-${index}`}
                            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border ${chipColors} shadow-sm`}
                          >
                            <span className="text-[11px]">
                              {tag.type === 'provider' ? '🚚' : tag.type === 'wine_type' ? '🍷' : '🏷️'}
                            </span>
                            <span className="font-medium">{tag.name}</span>
                            {tag.companyClass && (
                              <span 
                                className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-black/10"
                                title={classConfig?.description || tag.companyClass}
                              >
                                {tag.companyClass}
                              </span>
                            )}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Manual Entity Search - Alternative way to add entities */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Search Entities
                    <span className="ml-2 text-xs text-gray-400 font-normal">
                      Or search manually if not detected in title
                    </span>
                  </label>
                  <EntityAutocomplete
                    value={relatedEntitySearch}
                    options={entityOptions.filter(opt => 
                      !(newEvent.entityTags || []).some(tag => tag.id === opt.id)
                    )}
                    onChange={setRelatedEntitySearch}
                    showClassBadges={true}
                    onSelect={(entity: EntityOption) => {
                      const newTag = {
                        id: entity.id,
                        name: entity.label,
                        type: entity.kind,
                        badge: entity.badge,
                        companyClass: entity.companyClass,
                      }
                      const currentTags = newEvent.entityTags || []
                      
                      // Prevent duplicates
                      if (currentTags.some(t => t.id === entity.id)) {
                        setRelatedEntitySearch('')
                        return
                      }
                      
                      const updatedTags = [...currentTags, newTag]
                      
                      setNewEvent({
                        ...newEvent,
                        entityTags: updatedTags,
                        relatedEntity: updatedTags[0] ? {
                          id: updatedTags[0].id,
                          name: updatedTags[0].name,
                          type: updatedTags[0].type,
                          badge: updatedTags[0].badge,
                          companyClass: updatedTags[0].companyClass,
                        } : undefined,
                        provider: entity.kind === 'provider' ? entity.label : newEvent.provider,
                      })
                      setRelatedEntitySearch('')
                    }}
                    placeholder="Search providers, wine types, labels..."
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Description (optional)</label>
                  <textarea
                    value={newEvent.description || ''}
                    onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                    placeholder="Add details..."
                    rows={3}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    style={{ color: '#1f2937', WebkitTextFillColor: '#1f2937' }}
                  />
                </div>

                {/* Color */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Color</label>
                  <div className="flex gap-2">
                    {['#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#EF4444', '#6366F1', '#14B8A6'].map((color) => (
                      <button
                        key={color}
                        onClick={() => setNewEvent({ ...newEvent, color })}
                        className={`w-8 h-8 rounded-full transition-transform ${
                          newEvent.color === color ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* Reminders */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    <Bell className="w-4 h-4 inline mr-1" />
                    Reminders
                  </label>
                  <div className="space-y-2">
                    {(['15min', '1hour', '1day', '1week'] as const).map((reminder) => {
                      const labels: Record<typeof reminder, string> = {
                        '15min': '15 minutes before',
                        '1hour': '1 hour before',
                        '1day': '1 day before',
                        '1week': '1 week before',
                      }
                      const isChecked = newEvent.reminders?.includes(reminder) || false
                      
                      return (
                        <label key={reminder} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const currentReminders = newEvent.reminders || []
                              if (e.target.checked) {
                                setNewEvent({ ...newEvent, reminders: [...currentReminders, reminder] })
                              } else {
                                setNewEvent({ ...newEvent, reminders: currentReminders.filter(r => r !== reminder) })
                              }
                            }}
                            className="w-4 h-4 text-blue-600 rounded"
                          />
                          <span className="text-sm text-gray-700">{labels[reminder]}</span>
                        </label>
                      )
                    })}
                    {/* Custom Reminder */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newEvent.reminders?.includes('custom') || false}
                        onChange={(e) => {
                          const currentReminders = newEvent.reminders || []
                          if (e.target.checked) {
                            setNewEvent({ ...newEvent, reminders: [...currentReminders, 'custom'], customReminderMinutes: 30 })
                          } else {
                            setNewEvent({ ...newEvent, reminders: currentReminders.filter(r => r !== 'custom'), customReminderMinutes: undefined })
                          }
                        }}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="text-sm text-gray-700">Custom</span>
                    </label>
                    {newEvent.reminders?.includes('custom') && (
                      <div className="ml-6 flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          value={newEvent.customReminderMinutes || 30}
                          onChange={(e) => setNewEvent({ ...newEvent, customReminderMinutes: parseInt(e.target.value) || 30 })}
                          className="w-20 px-2 py-1 border border-gray-200 rounded text-sm"
                        />
                        <span className="text-sm text-gray-600">minutes before</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Recurring Event Options */}
                <div className="border-t border-gray-200 pt-4">
                  <label className="flex items-center gap-2 cursor-pointer mb-3">
                    <input
                      type="checkbox"
                      checked={newEvent.recurring?.enabled || false}
                      onChange={(e) => setNewEvent({
                        ...newEvent,
                        recurring: {
                          ...newEvent.recurring!,
                          enabled: e.target.checked,
                        }
                      })}
                      className="w-4 h-4 text-blue-600 rounded"
                    />
                    <Repeat className="w-4 h-4 text-gray-600" />
                    <span className="text-sm font-medium text-gray-700">Repeat this event</span>
                  </label>

                  {newEvent.recurring?.enabled && (
                    <div className="ml-6 space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
                      {/* Frequency */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Repeat</label>
                        <div className="flex gap-2">
                          <select
                            value={newEvent.recurring.frequency}
                            onChange={(e) => setNewEvent({
                              ...newEvent,
                              recurring: {
                                ...newEvent.recurring!,
                                frequency: e.target.value as RecurringConfig['frequency'],
                              }
                            })}
                            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                            <option value="custom">Custom</option>
                          </select>
                          {newEvent.recurring.frequency === 'custom' && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-600">Every</span>
                              <input
                                type="number"
                                min="1"
                                value={newEvent.recurring.interval || 1}
                                onChange={(e) => setNewEvent({
                                  ...newEvent,
                                  recurring: {
                                    ...newEvent.recurring!,
                                    interval: parseInt(e.target.value) || 1,
                                  }
                                })}
                                className="w-16 px-2 py-2 border border-gray-200 rounded-lg text-sm"
                              />
                              <span className="text-sm text-gray-600">days</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Days of Week (for weekly) */}
                      {newEvent.recurring.frequency === 'weekly' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Repeat on</label>
                          <div className="flex gap-1">
                            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => {
                              const isSelected = newEvent.recurring?.daysOfWeek?.includes(idx) || false
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => {
                                    const currentDays = newEvent.recurring?.daysOfWeek || []
                                    const newDays = isSelected
                                      ? currentDays.filter(d => d !== idx)
                                      : [...currentDays, idx]
                                    setNewEvent({
                                      ...newEvent,
                                      recurring: {
                                        ...newEvent.recurring!,
                                        daysOfWeek: newDays,
                                      }
                                    })
                                  }}
                                  className={`w-9 h-9 rounded-full text-sm font-medium transition-all ${
                                    isSelected
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-white border border-gray-200 text-gray-600 hover:border-blue-300'
                                  }`}
                                >
                                  {day}
                                </button>
                              )
                            })}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            {newEvent.recurring.daysOfWeek?.length === 0 
                              ? 'Select at least one day'
                              : `Every ${newEvent.recurring.daysOfWeek?.map(d => DAYS[d]).join(', ')}`
                            }
                          </p>
                        </div>
                      )}

                      {/* Day of Month (for monthly) */}
                      {newEvent.recurring.frequency === 'monthly' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1.5">Day of month</label>
                          <select
                            value={newEvent.recurring.dayOfMonth || 1}
                            onChange={(e) => setNewEvent({
                              ...newEvent,
                              recurring: {
                                ...newEvent.recurring!,
                                dayOfMonth: parseInt(e.target.value),
                              }
                            })}
                            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                          >
                            {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                              <option key={day} value={day}>
                                {day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' : `${day}th`}
                              </option>
                            ))}
                            <option value={-1}>Last day of month</option>
                          </select>
                        </div>
                      )}

                      {/* End Condition */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Ends</label>
                        <div className="space-y-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="endType"
                              checked={newEvent.recurring.endType === 'never'}
                              onChange={() => setNewEvent({
                                ...newEvent,
                                recurring: {
                                  ...newEvent.recurring!,
                                  endType: 'never',
                                }
                              })}
                              className="w-4 h-4 text-blue-600"
                            />
                            <span className="text-sm text-gray-700">Never</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="endType"
                              checked={newEvent.recurring.endType === 'on'}
                              onChange={() => setNewEvent({
                                ...newEvent,
                                recurring: {
                                  ...newEvent.recurring!,
                                  endType: 'on',
                                }
                              })}
                              className="w-4 h-4 text-blue-600"
                            />
                            <span className="text-sm text-gray-700">On date</span>
                            {newEvent.recurring.endType === 'on' && (
                              <input
                                type="date"
                                value={newEvent.recurring.endDate ? new Date(newEvent.recurring.endDate).toISOString().split('T')[0] : ''}
                                onChange={(e) => setNewEvent({
                                  ...newEvent,
                                  recurring: {
                                    ...newEvent.recurring!,
                                    endDate: new Date(e.target.value),
                                  }
                                })}
                                className="px-2 py-1 border border-gray-200 rounded text-sm"
                              />
                            )}
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="radio"
                              name="endType"
                              checked={newEvent.recurring.endType === 'after'}
                              onChange={() => setNewEvent({
                                ...newEvent,
                                recurring: {
                                  ...newEvent.recurring!,
                                  endType: 'after',
                                  endCount: 10,
                                }
                              })}
                              className="w-4 h-4 text-blue-600"
                            />
                            <span className="text-sm text-gray-700">After</span>
                            {newEvent.recurring.endType === 'after' && (
                              <>
                                <input
                                  type="number"
                                  min="1"
                                  value={newEvent.recurring.endCount || 10}
                                  onChange={(e) => setNewEvent({
                                    ...newEvent,
                                    recurring: {
                                      ...newEvent.recurring!,
                                      endCount: parseInt(e.target.value) || 10,
                                    }
                                  })}
                                  className="w-16 px-2 py-1 border border-gray-200 rounded text-sm"
                                />
                                <span className="text-sm text-gray-700">occurrences</span>
                              </>
                            )}
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-2 sticky bottom-0">
                <Button variant="outline" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  onClick={handleCreateEvent}
                  disabled={!canCreateEvent || isCreatingEvent || createEvent.isPending}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Check className="w-4 h-4 mr-2" />
                  Create Event
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* New Event Type Modal */}
      {showNewEventTypeModal && (
        <NewEventTypeModal
          onClose={() => setShowNewEventTypeModal(false)}
          onSuccess={(typeName, color) => {
            // Reload custom types
            loadCustomTypes()
            
            // Set the newly created type as selected
            setNewEvent({ 
              ...newEvent, 
              type: typeName.toLowerCase() as EventType, 
              color 
            })
            
            setShowNewEventTypeModal(false)
          }}
        />
      )}
    </div>
  )
}

export default Calendar
