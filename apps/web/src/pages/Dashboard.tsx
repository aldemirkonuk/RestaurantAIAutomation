import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Header } from '../components/layout/Header'
import {
  TrendingUp,
  TrendingDown,
  Package,
  ShoppingCart,
  DollarSign,
  AlertTriangle,
  Wine,
  ArrowRight,
  X,
  BarChart3,
  Truck,
  Eye,
  Calendar,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  PartyPopper,
  Cake,
  Users,
  FileText,
  Plus,
  Zap,
  Link as LinkIcon,
  ExternalLink,
  Clock,
  Bell,
  Target,
  Search,
} from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { OneTapActionCenter } from '../components/notifications/OneTapActionCenter'
import { AddImportantDateModal, ImportantDate } from '../components/dashboard/AddImportantDateModal'
import { useRealtimeDispatch, CalendarEventPayload } from '../contexts/RealtimeContext'
import { storeAIDateContext, importantDateToAIContext } from '../utils/aiDateContext'
import { formatMoney, formatNumber as fmtNumber } from '../lib/utils'
import { formatVolume } from '../utils/volumeUtils'
import { useAuthStore, useRestaurantSettingsStore } from '../stores'
import { useInventoryData } from '../hooks/useInventoryData'
import { useDashboardPage } from './dashboard/index'

interface CustomOneTapAction {
  id: string
  title: string
  description: string
  icon: string
  actionUrl: string
  priority: 'low' | 'medium' | 'high'
  color: string
  createdAt: string
}

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
}


// One-tap reminders (Apple Reminders style)
interface Reminder {
  id: string
  title: string
  subtitle: string
  priority: 'high' | 'medium' | 'low'
  completed: boolean
  dueTime?: string
  type: 'reorder' | 'delivery' | 'price' | 'action'
  wineId?: string
}

// Calendar Event Types
interface CalendarEvent {
  id: string
  type: 'important_date' | 'vendor_deadline' | 'recurring_order' | 'report_schedule' | 'delivery' | 'birthday' | 'tasting'
  title: string
  time?: string
  priority?: 'low' | 'medium' | 'high'
}

type CalendarFilterType = 'all' | 'delivery' | 'order' | 'meeting' | 'inventory' | 'tasting' | 'reminder' | 'recurring' | 'custom'

const formatEventTime = (time: string) => {
  const [hours = '0', minutes = '00'] = time.split(':')
  const hour = parseInt(hours, 10)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:${minutes.padStart(2, '0')} ${ampm}`
}

const toNumericId = (value: string) => {
  return value.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
}

const getImportantDateConfig = (type?: string) => {
  switch (type) {
    case 'delivery':
      return { icon: Truck, color: 'blue', mappedType: 'delivery' as const }
    case 'birthday':
      return { icon: Cake, color: 'pink', mappedType: 'birthday' as const }
    case 'inventory':
      return { icon: Package, color: 'emerald', mappedType: 'inventory' as const }
    case 'reservation':
      return { icon: Users, color: 'amber', mappedType: 'reservation' as const }
    case 'meeting':
      return { icon: CalendarDays, color: 'indigo', mappedType: 'meeting' as const }
    case 'tasting':
      return { icon: Wine, color: 'rose', mappedType: 'tasting' as const }
    case 'reminder':
      return { icon: Bell, color: 'gray', mappedType: 'reminder' as const }
    default:
      return { icon: PartyPopper, color: 'purple', mappedType: 'event' as const }
  }
}

// Calendar sales data interface
interface DayData {
  revenue: number
  bottles: number
  avgPrice: number
  byType: { red: number; white: number; sparkling: number; rose: number; dessert: number }
  topSeller: string
  orders: number
  events: CalendarEvent[] // Calendar events for this day
}

// Generate calendar sales data - uses ONLY real order data, no mock/fake data
const generateCalendarSalesData = (
  baseDate: Date, 
  eventsByDate: Record<string, CalendarEvent[]>,
  orderDailyData?: Array<{ date: string; orders: number; bottles: number; revenue: number }>
) => {
  const data: { [key: string]: DayData } = {}
  const currentMonth = baseDate.getMonth()
  const currentYear = baseDate.getFullYear()
  
  // Create a map of real order data by date
  const realDataByDate = new Map<string, { orders: number; bottles: number; revenue: number }>()
  if (orderDailyData) {
    orderDailyData.forEach(d => realDataByDate.set(d.date, d))
  }
  
  for (let day = 1; day <= 31; day++) {
    const date = new Date(currentYear, currentMonth, day)
    if (date.getMonth() !== currentMonth) break
    
    const dateStr = date.toISOString().split('T')[0]
    const realData = realDataByDate.get(dateStr)
    
    // Only populate with real data - no mock estimates
    const revenue = realData?.revenue ?? 0
    const bottles = realData?.bottles ?? 0
    const orders = realData?.orders ?? 0
    const avgPrice = bottles > 0 ? Math.round(revenue / bottles) : 0
    
    data[dateStr] = {
      revenue,
      bottles,
      avgPrice,
      byType: {
        red: 0,
        white: 0,
        sparkling: 0,
        rose: 0,
        dessert: 0,
      },
      topSeller: '',
      orders,
      events: eventsByDate[dateStr] || [],
    }
  }
  
  return data
}

type ModalType = 'revenue' | 'inventory' | 'orders' | 'lowStock' | null

export function Dashboard() {
  const [activeModal, setActiveModal] = useState<ModalType>(null)
  const { measurementUnit } = useRestaurantSettingsStore()
  const restaurantId = useAuthStore(state => state.activeRestaurantId)
  
  // Use the extracted dashboard page hook
  const dashboardData = useDashboardPage()
  const {
    stats,
    apiStats,
    inventorySummary,
    lowStockItems: apiLowStock,
    pendingOrders: apiPendingOrders,
    orderMetrics,
    libraryWines,
    dashboardLoading,
    dashboardError,
    calendarMonth,
    calendarFilterType,
    calendarSearchQuery,
    selectedDay,
    calendarEvents: filteredCalendarEvents,
    calendarSalesData,
    eventsByDate,
    reminders,
    lowStockBuckets,
    recentOrderRows,
    greeting,
    refreshDashboard: refetchDashboard,
    refreshReminders,
    handleDayClick,
    setCalendarFilterType,
    setCalendarSearchQuery,
    setSelectedDay,
    setReminders,
  } = dashboardData

  // Get inventory data for shadow stock reconciliation reminders (still needed for manualImportantDates)
  const { inventory } = useInventoryData()

  // Create One-Tap Action Modal State
  const [showCreateActionModal, setShowCreateActionModal] = useState(false)
  const [customActions, setCustomActions] = useState<CustomOneTapAction[]>([])
  const [newAction, setNewAction] = useState({
    title: '',
    description: '',
    icon: 'Zap',
    actionUrl: '',
    priority: 'medium' as 'low' | 'medium' | 'high',
    color: 'wine'
  })

  // Important Dates Modal State
  const [showAddDateModal, setShowAddDateModal] = useState(false)
  const [manualImportantDates, setManualImportantDates] = useState<ImportantDate[]>([])
  const { dispatchCalendarEvent } = useRealtimeDispatch()

  // Handle adding a new important date
  const handleAddImportantDate = (newDate: Omit<ImportantDate, 'id'>) => {
    const dateWithId: ImportantDate = {
      ...newDate,
      id: Date.now(),
    }
    setManualImportantDates(prev => [...prev, dateWithId])

    // Dispatch to Calendar
    const eventTypeMap: Record<string, CalendarEventPayload['eventType']> = {
      'event': 'reminder',
      'birthday': 'reminder',
      'delivery': 'delivery',
      'tasting': 'tasting',
    }
    const calendarPayload: CalendarEventPayload = {
      type: 'created',
      eventId: String(dateWithId.id),
      eventType: eventTypeMap[newDate.type] || 'custom',
      title: newDate.title,
      date: newDate.date,
      startTime: newDate.time,
      description: newDate.notes,
      source: 'manual',
      timestamp: new Date().toISOString(),
    }
    dispatchCalendarEvent(calendarPayload)

    // Store in AI context for intelligent messaging
    const aiContext = importantDateToAIContext(dateWithId, 'manual')
    storeAIDateContext(aiContext)
  }


  // Keyboard shortcut for Create Action
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        setShowCreateActionModal(true)
      }
      if (e.key === 'Escape') {
        setShowCreateActionModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [])

  const formatCurrency = (value: number) => formatMoney(value, 'compact')
  const formatNumber = (value: number) => fmtNumber(value)

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-100 text-amber-700'
      case 'approved': return 'bg-blue-100 text-blue-700'
      case 'delivered': return 'bg-emerald-100 text-emerald-700'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'critical': return 'bg-rose-500'
      case 'high': return 'bg-amber-500'
      case 'medium': return 'bg-yellow-400'
      default: return 'bg-gray-400'
    }
  }

  const toggleReminder = (id: string) => {
    setReminders(prev => prev.map(r => 
      r.id === id ? { ...r, completed: !r.completed } : r
    ))
  }

  const getPriorityColor = (priority: Reminder['priority']) => {
    switch (priority) {
      case 'high': return 'text-orange-500'
      case 'medium': return 'text-blue-500'
      case 'low': return 'text-gray-400'
    }
  }

  // Handle Create One-Tap Action
  const colorOptions = [
    { name: 'Wine', value: 'wine', bg: 'bg-wine-600', text: 'text-white' },
    { name: 'Emerald', value: 'emerald', bg: 'bg-emerald-600', text: 'text-white' },
    { name: 'Blue', value: 'blue', bg: 'bg-blue-600', text: 'text-white' },
    { name: 'Amber', value: 'amber', bg: 'bg-amber-600', text: 'text-white' },
    { name: 'Rose', value: 'rose', bg: 'bg-rose-600', text: 'text-white' },
    { name: 'Purple', value: 'purple', bg: 'bg-purple-600', text: 'text-white' },
  ]

  const handleCreateAction = () => {
    if (!newAction.title || !newAction.actionUrl) {
      alert('Please fill in all required fields')
      return
    }

    const action: CustomOneTapAction = {
      id: `custom_${Date.now()}`,
      title: newAction.title,
      description: newAction.description,
      icon: newAction.icon,
      actionUrl: newAction.actionUrl,
      priority: newAction.priority,
      color: newAction.color,
      createdAt: new Date().toISOString()
    }

    setCustomActions(prev => [...prev, action])
    setShowCreateActionModal(false)
    setNewAction({
      title: '',
      description: '',
      icon: 'Zap',
      actionUrl: '',
      priority: 'medium',
      color: 'wine'
    })
  }

  // Calendar helpers
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const daysInMonth = lastDay.getDate()
    const startingDay = firstDay.getDay()
    return { daysInMonth, startingDay }
  }

  const { daysInMonth, startingDay } = getDaysInMonth(calendarMonth)

  const formatDate = (year: number, month: number, day: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  // Compute calendarImportantDates from filteredCalendarEvents (needed for importantDatesList)
  const calendarImportantDates = useMemo(() => {
    return filteredCalendarEvents.map((event: any) => {
      const config = getImportantDateConfig(event.type)
      return {
        id: Number.parseInt(event.id, 10) || toNumericId(event.id || ''),
        date: event.date.toISOString().split('T')[0],
        title: event.title || 'Untitled event',
        type: config.mappedType,
        icon: config.icon,
        color: config.color,
        time: event.startTime || event.time,
      } as ImportantDate
    })
  }, [filteredCalendarEvents])

  const importantDatesList = useMemo(() => {
    const combined = [...calendarImportantDates, ...manualImportantDates]
    return combined.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [calendarImportantDates, manualImportantDates])

  return (
    <div className="min-h-screen">
      <Header title={`${greeting}, Manager`} subtitle="Here's what's happening with your wine inventory today." />

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="p-6 space-y-6"
      >
        {/* Stats Grid - Clickable Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => {
            const Icon = stat.icon
            return (
              <motion.button
                key={stat.label}
                variants={itemVariants}
                onClick={() => setActiveModal(stat.id)}
                className="bg-white rounded-xl p-5 shadow-sm border border-gray-100 hover:shadow-lg hover:border-wine-200 transition-all text-left group"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">{stat.label}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                    <div className="flex items-center gap-1 mt-1.5">
                      {stat.trend === 'up' ? (
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
                      )}
                      <span className={`text-xs font-medium ${stat.trend === 'up' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {stat.change}
                      </span>
                    </div>
                  </div>
                  <div
                    className="p-2.5 rounded-lg group-hover:scale-110 transition-transform"
                    style={{
                      backgroundColor:
                        stat.color === 'emerald' ? '#d1fae5' :
                        stat.color === 'blue' ? '#dbeafe' :
                        stat.color === 'amber' ? '#fef3c7' : '#ffe4e6',
                    }}
                  >
                    <Icon
                      className="w-5 h-5"
                      style={{
                        color:
                          stat.color === 'emerald' ? '#059669' :
                          stat.color === 'blue' ? '#2563eb' :
                          stat.color === 'amber' ? '#d97706' : '#e11d48',
                      }}
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center text-xs text-wine-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                  <Eye className="w-3.5 h-3.5 mr-1" />
                  View Details
                </div>
              </motion.button>
            )
          })}
        </div>

        {/* One-Tap Actions (2/3) + Quick Actions (1/3) - ABOVE CALENDAR */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* One-Tap Action Center - 2/3 */}
          <motion.div variants={itemVariants} className="lg:col-span-2">
            <OneTapActionCenter />
          </motion.div>

          {/* Quick Actions - 1/3 */}
          <motion.div variants={itemVariants} className="bg-gradient-to-br from-wine-600 to-wine-800 rounded-xl shadow-lg overflow-hidden">
            <div className="p-5">
              <h3 className="font-semibold text-white mb-3">Quick Actions</h3>
              <div className="space-y-2">
                {[
                  { label: 'New Order', icon: ShoppingCart, href: '/orders' },
                  { label: 'Add Wine', icon: Wine, href: '/wines' },
                  { label: 'Stock Check', icon: Package, href: '/inventory' },
                  { label: 'Reports', icon: BarChart3, href: '/reports' },
                ].map((action) => {
                  const Icon = action.icon
                  return (
                    <NavLink
                      key={action.label}
                      to={action.href}
                      className="flex items-center gap-3 px-3 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg transition-all text-white"
                    >
                      <Icon className="w-4 h-4" />
                      <span className="text-sm font-medium">{action.label}</span>
                    </NavLink>
                  )
                })}
                
                {/* Add to Calendar Button */}
                <button
                  onClick={() => alert('Add to Calendar - Opening event creation modal...')}
                  className="flex items-center gap-3 px-3 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg transition-all text-white w-full"
                >
                  <Calendar className="w-4 h-4" />
                  <span className="text-sm font-medium">Add to Calendar</span>
                </button>
                
                {/* iOS-style Add Quick Action Button */}
                <button
                  onClick={() => setShowCreateActionModal(true)}
                  className="flex items-center justify-center gap-2 px-3 py-2.5 border-2 border-dashed border-white/30 hover:border-white/50 hover:bg-white/10 rounded-lg transition-all text-white/80 hover:text-white group w-full"
                  title="Create Quick Action (⌘N)"
                >
                  <Plus className="w-4 h-4" />
                  <span className="text-sm font-medium">Add Quick Action</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Enhanced Sales Calendar with Quick Actions */}
        <motion.div variants={itemVariants} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-wine-100 rounded-lg">
                <Calendar className="w-5 h-5 text-wine-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">Sales Calendar</h3>
                <p className="text-sm text-gray-500">Click any day for detailed report</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Quick Stats */}
              <div className="hidden md:flex items-center gap-4 px-4 py-2 bg-gray-50 rounded-lg">
                <div className="text-center">
                  <p className="text-lg font-bold text-gray-900">
                    {formatMoney(Object.values(calendarSalesData).reduce((sum, d) => sum + d.revenue, 0), 'compact')}
                  </p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">Month Total</p>
                </div>
                <div className="w-px h-8 bg-gray-200" />
                <div className="text-center">
                  <p className="text-lg font-bold text-emerald-600">
                    {fmtNumber(Object.values(calendarSalesData).reduce((sum, d) => sum + d.bottles, 0))}
                  </p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wide">Bottles</p>
                </div>
              </div>

              {/* Calendar Filters */}
              <div className="hidden lg:flex items-center gap-2">
                <select
                  value={calendarFilterType}
                  onChange={(e) => setCalendarFilterType(e.target.value as CalendarFilterType)}
                  className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
                >
                  <option value="all">All types</option>
                  <option value="delivery">Delivery</option>
                  <option value="order">Order</option>
                  <option value="meeting">Meeting</option>
                  <option value="inventory">Inventory</option>
                  <option value="tasting">Tasting</option>
                  <option value="reminder">Reminder</option>
                  <option value="recurring">Recurring</option>
                  <option value="custom">Custom</option>
                </select>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={calendarSearchQuery}
                    onChange={(e) => setCalendarSearchQuery(e.target.value)}
                    placeholder="Search events..."
                    className="pl-9 pr-3 py-2 border border-gray-200 rounded-lg bg-white text-sm text-gray-700"
                  />
                </div>
              </div>
              
              {/* Navigation */}
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => dashboardData.navigateMonth('prev')}
                  className="p-1.5 hover:bg-white rounded-md transition-colors"
                >
                  <ChevronLeft className="w-4 h-4 text-gray-600" />
                </button>
                <span className="text-sm font-medium text-gray-900 min-w-[100px] text-center">
                  {calendarMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </span>
                <button
                  onClick={() => dashboardData.navigateMonth('next')}
                  className="p-1.5 hover:bg-white rounded-md transition-colors"
                >
                  <ChevronRight className="w-4 h-4 text-gray-600" />
                </button>
              </div>
              
              {/* View Full Calendar */}
              <NavLink
                to="/calendar"
                className="flex items-center gap-1.5 px-3 py-2 bg-wine-600 text-white text-sm font-medium rounded-lg hover:bg-wine-700 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">Full Calendar</span>
              </NavLink>
            </div>
          </div>
          
          <div className="flex">
            {/* Calendar Grid */}
            <div className="flex-1 p-4">
              {/* Day headers */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
                  <div key={idx} className="text-center text-xs font-semibold text-gray-400 py-1">
                    {day}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: startingDay }).map((_, i) => (
                  <div key={`empty-${i}`} className="aspect-square" />
                ))}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1
                  const dateStr = formatDate(calendarMonth.getFullYear(), calendarMonth.getMonth(), day)
                  const dayData = calendarSalesData[dateStr]
                  const isToday = dateStr === new Date().toISOString().split('T')[0]
                  const isPast = new Date(dateStr) < new Date(new Date().toDateString())
                  const hasEvents = dayData?.events && dayData.events.length > 0
                  const hasHighPriority = dayData?.events?.some(e => e.priority === 'high')
                  
                  return (
                    <button
                      key={day}
                      onClick={() => handleDayClick(dateStr, dayData)}
                      className={`aspect-square p-0.5 rounded-lg cursor-pointer transition-all group ${
                        isToday ? 'ring-2 ring-wine-500 ring-offset-1' : ''
                      } ${hasHighPriority ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
                    >
                      <div className={`w-full h-full rounded-md flex flex-col items-center justify-center relative ${
                        isPast && dayData ? 'bg-gray-50/50' : ''
                      }`}>
                        <span className={`text-xs font-medium ${
                          isToday ? 'w-5 h-5 bg-wine-600 text-white rounded-full flex items-center justify-center' : 
                          'text-gray-700'
                        }`}>
                          {day}
                        </span>
                        {dayData && (
                          <>
                            <span className="text-[10px] font-bold text-gray-900 group-hover:text-wine-600 transition-colors">
                              ${(dayData.revenue / 1000).toFixed(1)}k
                            </span>
                            
                            {/* Event Indicators */}
                            {hasEvents && (
                              <div className="absolute bottom-0.5 left-0 right-0 flex items-center justify-center gap-0.5">
                                {dayData.events.slice(0, 3).map((event) => {
                                  const eventColor = 
                                    event.type === 'important_date' ? 'bg-purple-500' :
                                    event.type === 'vendor_deadline' ? 'bg-amber-500' :
                                    event.type === 'recurring_order' ? 'bg-blue-500' :
                                    event.type === 'report_schedule' ? 'bg-emerald-500' :
                                    event.type === 'delivery' ? 'bg-indigo-500' :
                                    event.type === 'birthday' ? 'bg-pink-500' :
                                    event.type === 'tasting' ? 'bg-rose-500' :
                                    'bg-gray-500'
                                  
                                  return (
                                    <span
                                      key={event.id}
                                      className={`w-1.5 h-1.5 rounded-full ${eventColor}`}
                                      title={event.title}
                                    />
                                  )
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
              
              {/* Legend */}
              <div className="flex flex-wrap items-center justify-center gap-3 mt-4 pt-3 border-t border-gray-100">
                {[
                  { color: 'bg-purple-500', label: 'Important' },
                  { color: 'bg-amber-500', label: 'Deadline' },
                  { color: 'bg-blue-500', label: 'Recurring' },
                  { color: 'bg-indigo-500', label: 'Delivery' },
                  { color: 'bg-rose-500', label: 'Tasting' },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${item.color}`} />
                    <span className="text-[10px] text-gray-500">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Today's Events Sidebar */}
            <div className="w-64 border-l border-gray-100 p-4 bg-gray-50/50 hidden lg:block">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-wine-600" />
                <h4 className="text-sm font-semibold text-gray-900">Today's Schedule</h4>
              </div>
              
              {(() => {
                const todayStr = new Date().toISOString().split('T')[0]
                const todayData = calendarSalesData[todayStr]
                const todayEvents = todayData?.events || []
                
                if (todayEvents.length === 0) {
                  return (
                    <div className="text-center py-6">
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                        <Calendar className="w-5 h-5 text-gray-400" />
                      </div>
                      <p className="text-xs text-gray-500">No events today</p>
                    </div>
                  )
                }
                
                return (
                  <div className="space-y-2">
                    {todayEvents.map((event) => {
                      const config = {
                        important_date: { icon: '📅', bg: 'bg-purple-100', text: 'text-purple-700' },
                        vendor_deadline: { icon: '⚠️', bg: 'bg-amber-100', text: 'text-amber-700' },
                        recurring_order: { icon: '🔄', bg: 'bg-blue-100', text: 'text-blue-700' },
                        report_schedule: { icon: '📊', bg: 'bg-emerald-100', text: 'text-emerald-700' },
                        delivery: { icon: '🚚', bg: 'bg-indigo-100', text: 'text-indigo-700' },
                        birthday: { icon: '🎂', bg: 'bg-pink-100', text: 'text-pink-700' },
                        tasting: { icon: '🍷', bg: 'bg-rose-100', text: 'text-rose-700' },
                      }[event.type] || { icon: '📌', bg: 'bg-gray-100', text: 'text-gray-700' }
                      
                      return (
                        <div
                          key={event.id}
                          className={`flex items-start gap-2 p-2 rounded-lg ${config.bg}`}
                        >
                          <span className="text-sm">{config.icon}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-xs font-medium ${config.text} truncate`}>{event.title}</p>
                            {event.time && (
                              <p className="text-[10px] text-gray-500">{event.time}</p>
                            )}
                          </div>
                          {event.priority === 'high' && (
                            <Bell className="w-3 h-3 text-amber-500 flex-shrink-0" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
              
              {/* Upcoming This Week */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="w-4 h-4 text-gray-600" />
                  <h4 className="text-sm font-semibold text-gray-900">This Week</h4>
                </div>
                <div className="space-y-1.5">
                  {Object.entries(calendarSalesData)
                    .filter(([dateStr]) => {
                      const date = new Date(dateStr)
                      const today = new Date()
                      const weekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
                      return date >= today && date <= weekFromNow
                    })
                    .flatMap(([dateStr, data]) => 
                      (data.events || []).map(event => ({ ...event, dateStr }))
                    )
                    .slice(0, 4)
                    .map((event) => (
                      <div key={event.id} className="flex items-center gap-2 text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-wine-500" />
                        <span className="text-gray-600 truncate flex-1">{event.title}</span>
                        <span className="text-gray-400">
                          {new Date(event.dateStr).toLocaleDateString('en-US', { weekday: 'short' })}
                        </span>
                      </div>
                    ))
                  }
                </div>
              </div>
              
              {/* Quick Add */}
              <NavLink
                to="/calendar"
                className="mt-4 flex items-center justify-center gap-2 w-full px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-wine-400 hover:text-wine-600 transition-colors text-xs font-medium"
              >
                <Plus className="w-3 h-3" />
                Add Event
              </NavLink>
            </div>
          </div>
        </motion.div>

        {/* Important Dates */}
        <motion.div variants={itemVariants} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-wine-600" />
              <div>
                <h3 className="font-semibold text-gray-900">Important Dates</h3>
                <p className="text-sm text-gray-500">Upcoming events & deadlines</p>
              </div>
            </div>
            <button 
              onClick={() => setShowAddDateModal(true)}
              className="flex items-center gap-1.5 text-sm text-wine-600 font-medium hover:text-wine-700 hover:bg-wine-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Date
            </button>
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {importantDatesList.length === 0 ? (
              <div className="col-span-full p-6 text-center text-sm text-gray-500 bg-gray-50 rounded-xl">
                No upcoming dates yet.
              </div>
            ) : (
              importantDatesList.map((item) => {
                const Icon = item.icon
                const dateObj = new Date(item.date)
                const isUpcoming = dateObj > new Date()
                const daysUntil = Math.ceil((dateObj.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className={`p-2.5 rounded-xl`} style={{
                      backgroundColor: 
                        item.color === 'purple' ? '#f3e8ff' :
                        item.color === 'blue' ? '#dbeafe' :
                        item.color === 'pink' ? '#fce7f3' :
                        item.color === 'emerald' ? '#d1fae5' :
                        item.color === 'amber' ? '#fef3c7' : '#e0e7ff'
                    }}>
                      <Icon className="w-4 h-4" style={{
                        color:
                          item.color === 'purple' ? '#9333ea' :
                          item.color === 'blue' ? '#2563eb' :
                          item.color === 'pink' ? '#ec4899' :
                          item.color === 'emerald' ? '#059669' :
                          item.color === 'amber' ? '#d97706' : '#4f46e5'
                      }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-sm truncate">{item.title}</p>
                      <p className="text-xs text-gray-500">
                        {dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {isUpcoming && daysUntil <= 7 && (
                          <span className="ml-2 text-wine-600 font-medium">
                            {daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </motion.div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Orders */}
          <motion.div
            variants={itemVariants}
            className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">Recent Orders</h3>
                <p className="text-sm text-gray-500">Latest procurement activity</p>
              </div>
              <NavLink to="/orders" className="flex items-center gap-1 text-sm font-medium text-wine-600 hover:text-wine-700">
                View all <ArrowRight className="w-4 h-4" />
              </NavLink>
            </div>
            <div className="divide-y divide-gray-50">
              {recentOrderRows.length === 0 ? (
                <div className="px-5 py-6 text-center text-sm text-gray-500">
                  No recent orders available.
                </div>
              ) : (
                recentOrderRows.map((order) => (
                  <div key={order.id} className="px-5 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-wine-100 rounded-lg flex items-center justify-center">
                          <Wine className="w-4 h-4 text-wine-600" />
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-sm">
                            {order.wine}
                            <span className="text-gray-400 text-xs font-normal ml-1">
                              · {order.bottleFormat}
                            </span>
                          </p>
                          <p className="text-xs text-gray-500">{order.id} · {order.provider} · {order.qty} btls</p>
                        </div>
                      </div>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${getStatusColor(order.status)}`}>
                        {order.status}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>

          {/* Low Stock Alerts */}
          <motion.div variants={itemVariants} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">Low Stock Alerts</h3>
                <p className="text-sm text-gray-500">Items needing attention</p>
              </div>
              <span className="w-6 h-6 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center text-xs font-bold">
                {apiLowStock.length}
              </span>
            </div>
            <div className="p-3 space-y-2 max-h-[280px] overflow-y-auto">
              {apiLowStock.length === 0 && (
                <div className="p-4 text-sm text-gray-500 text-center">
                  No low stock alerts at the moment.
                </div>
              )}
              {apiLowStock.slice(0, 5).map((wine) => {
                const urgency = wine.stockLive <= wine.thresholdMin * 0.5 ? 'critical' : 'high'
                return (
                  <div key={wine.id} className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex items-start gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full mt-1.5 ${getUrgencyColor(urgency)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="font-medium text-gray-900 text-sm truncate">
                            {wine.wineName || wine.wineProducer || 'Unknown wine'}
                            <span className="text-gray-400 text-xs font-normal ml-1">
                              ({formatVolume((wine as { bottleSizeMl?: number }).bottleSizeMl ?? 750, measurementUnit)})
                            </span>
                          </p>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">{wine.stockLive} bottles remaining · Min: {wine.thresholdMin}</p>
                        <div className="mt-1.5 w-full bg-gray-200 rounded-full h-1">
                          <div
                            className={`h-1 rounded-full ${getUrgencyColor(urgency)}`}
                            style={{ width: `${(wine.stockLive / wine.thresholdMin) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="px-5 py-3 border-t border-gray-100">
              <NavLink to="/inventory" className="flex items-center justify-center gap-2 w-full py-1.5 text-sm font-medium text-wine-600 hover:text-wine-700">
                View all inventory <ArrowRight className="w-4 h-4" />
              </NavLink>
            </div>
          </motion.div>
        </div>

        {/* Top Performing Wines */}
        <motion.div variants={itemVariants} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <h3 className="font-semibold text-gray-900">Top Performing Wines</h3>
              <p className="text-sm text-gray-500">This month's best sellers</p>
            </div>
            <NavLink to="/reports" className="flex items-center gap-1 text-sm font-medium text-wine-600 hover:text-wine-700">
              Full report <ArrowRight className="w-4 h-4" />
            </NavLink>
          </div>
          <div className="p-5">
            <div className="p-6 text-center text-sm text-gray-500 bg-gray-50 rounded-xl">
              No sales performance data available yet.
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Detail Modals */}
      <AnimatePresence>
        {activeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setActiveModal(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              {/* Revenue Modal */}
              {activeModal === 'revenue' && (
                <>
                  <div className="flex items-center justify-between px-6 py-4 border-b bg-emerald-50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-emerald-100 rounded-lg">
                        <DollarSign className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Total Revenue</h3>
                        <p className="text-sm text-gray-500">This month's performance</p>
                      </div>
                    </div>
                    <button onClick={() => setActiveModal(null)} className="p-2 hover:bg-white/50 rounded-lg">
                      <X className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>
                  <div className="p-6 space-y-6">
                    <div className="text-center">
                      <p className="text-4xl font-bold text-gray-900">
                        {typeof apiStats.monthSales === 'number' ? formatCurrency(apiStats.monthSales) : 'No data'}
                      </p>
                      <p className="text-sm text-emerald-600 mt-1">This month</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <p className="text-sm text-gray-500">Today</p>
                        <p className="text-xl font-bold text-gray-900">
                          {typeof apiStats.todaySales === 'number' ? formatCurrency(apiStats.todaySales) : '—'}
                        </p>
                      </div>
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <p className="text-sm text-gray-500">This Week</p>
                        <p className="text-xl font-bold text-gray-900">
                          {typeof apiStats.weekSales === 'number' ? formatCurrency(apiStats.weekSales) : '—'}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-3">Revenue Breakdown</p>
                      <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-500 text-center">
                        Breakdown data is not available yet.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Inventory Modal */}
              {activeModal === 'inventory' && (
                <>
                  <div className="flex items-center justify-between px-6 py-4 border-b bg-blue-50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <Package className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Active Inventory</h3>
                        <p className="text-sm text-gray-500">Current stock overview</p>
                      </div>
                    </div>
                    <button onClick={() => setActiveModal(null)} className="p-2 hover:bg-white/50 rounded-lg">
                      <X className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>
                  <div className="p-6 space-y-6">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center p-4 bg-gray-50 rounded-xl">
                        <p className="text-2xl font-bold text-gray-900">
                          {typeof inventorySummary?.totalItems === 'number' ? inventorySummary.totalItems : '—'}
                        </p>
                        <p className="text-xs text-gray-500">Wine SKUs</p>
                      </div>
                      <div className="text-center p-4 bg-gray-50 rounded-xl">
                        <p className="text-2xl font-bold text-gray-900">
                          {typeof inventorySummary?.totalBottles === 'number' ? formatNumber(inventorySummary.totalBottles) : '—'}
                        </p>
                        <p className="text-xs text-gray-500">Total Bottles</p>
                        {typeof inventorySummary?.totalBottles === 'number' && inventorySummary.totalBottles > 0 && (
                          <p className="text-xs text-gray-400 mt-1">
                            Total Volume: {formatVolume(inventorySummary.totalBottles * 750)}
                          </p>
                        )}
                      </div>
                      <div className="text-center p-4 bg-gray-50 rounded-xl">
                        <p className="text-2xl font-bold text-gray-900">—</p>
                        <p className="text-xs text-gray-500">Value on Hand</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-3">By Wine Type</p>
                      <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-500 text-center">
                        Type breakdown is not available yet.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Orders Modal */}
              {activeModal === 'orders' && (
                <>
                  <div className="flex items-center justify-between px-6 py-4 border-b bg-amber-50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-amber-100 rounded-lg">
                        <ShoppingCart className="w-5 h-5 text-amber-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Pending Orders</h3>
                        <p className="text-sm text-gray-500">Orders awaiting action</p>
                      </div>
                    </div>
                    <button onClick={() => setActiveModal(null)} className="p-2 hover:bg-white/50 rounded-lg">
                      <X className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>
                  <div className="p-6 space-y-6">
                    <div className="flex items-center justify-center gap-6">
                      <div className="text-center">
                        <p className="text-3xl font-bold text-gray-900">{apiPendingOrders.length}</p>
                        <p className="text-xs text-gray-500">Awaiting Approval</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-700 mb-3">Upcoming Deliveries</p>
                      {apiPendingOrders.length === 0 ? (
                        <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-500 text-center">
                          No pending orders available.
                        </div>
                      ) : (
                        apiPendingOrders.slice(0, 4).map((order) => {
                          const wine = libraryWines.find(w => w.id === order.wineId)
                          const bottleMl = (order as { bottleSizeMl?: number }).bottleSizeMl ?? wine?.bottleSizeMl ?? 750
                          return (
                          <div key={order.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {order.wineName || order.wineProducer || 'Unknown wine'}
                                <span className="text-gray-400 text-xs font-normal ml-1">
                                  · {formatVolume(bottleMl, measurementUnit)}
                                </span>
                              </p>
                              <p className="text-xs text-gray-500">{order.providerName || 'Unknown provider'} · {order.quantity} bottles</p>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <Truck className="w-4 h-4" />
                              <span>Pending</span>
                            </div>
                          </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Low Stock Modal */}
              {activeModal === 'lowStock' && (
                <>
                  <div className="flex items-center justify-between px-6 py-4 border-b bg-rose-50">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-rose-100 rounded-lg">
                        <AlertTriangle className="w-5 h-5 text-rose-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Low Stock Alerts</h3>
                        <p className="text-sm text-gray-500">Items requiring attention</p>
                      </div>
                    </div>
                    <button onClick={() => setActiveModal(null)} className="p-2 hover:bg-white/50 rounded-lg">
                      <X className="w-5 h-5 text-gray-500" />
                    </button>
                  </div>
                  <div className="p-6 space-y-4 max-h-[400px] overflow-y-auto">
                    {lowStockBuckets.critical.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-rose-600 mb-2 flex items-center gap-2">
                          <span className="w-2 h-2 bg-rose-500 rounded-full" />
                          Critical ({lowStockBuckets.critical.length})
                        </p>
                        {lowStockBuckets.critical.map((wine) => (
                          <div key={wine.id} className="flex items-center justify-between py-2 pl-4 border-l-2 border-rose-500 mb-2">
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {wine.wineName || wine.wineProducer || 'Unknown wine'}
                                <span className="text-gray-400 text-xs font-normal ml-1">
                                  ({formatVolume((wine as { bottleSizeMl?: number }).bottleSizeMl ?? 750, measurementUnit)})
                                </span>
                              </p>
                              <p className="text-xs text-gray-500">{wine.stockLive} bottles remaining · Min: {wine.thresholdMin}</p>
                            </div>
                            <button className="px-3 py-1.5 bg-rose-100 text-rose-700 text-xs font-medium rounded-lg hover:bg-rose-200">
                              Reorder
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {lowStockBuckets.warning.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-amber-600 mb-2 flex items-center gap-2">
                          <span className="w-2 h-2 bg-amber-500 rounded-full" />
                          Warning ({lowStockBuckets.warning.length})
                        </p>
                        {lowStockBuckets.warning.map((wine) => (
                          <div key={wine.id} className="flex items-center justify-between py-2 pl-4 border-l-2 border-amber-500 mb-2">
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                {wine.wineName || wine.wineProducer || 'Unknown wine'}
                                <span className="text-gray-400 text-xs font-normal ml-1">
                                  ({formatVolume((wine as { bottleSizeMl?: number }).bottleSizeMl ?? 750, measurementUnit)})
                                </span>
                              </p>
                              <p className="text-xs text-gray-500">{wine.stockLive} bottles remaining · Min: {wine.thresholdMin}</p>
                            </div>
                            <button className="px-3 py-1.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-lg hover:bg-amber-200">
                              Reorder
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {lowStockBuckets.critical.length === 0 && lowStockBuckets.warning.length === 0 && (
                      <div className="p-4 bg-gray-50 rounded-xl text-sm text-gray-500 text-center">
                        No low stock items right now.
                      </div>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}

        {/* Daily Report Modal */}
        <AnimatePresence>
          {selectedDay && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setSelectedDay(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
              >
                <div className="flex items-center justify-between px-6 py-4 border-b bg-wine-50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-wine-100 rounded-lg">
                      <FileText className="w-5 h-5 text-wine-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">Daily Sales Report</h3>
                      <p className="text-sm text-gray-500">
                        {new Date(selectedDay.date).toLocaleDateString('en-US', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })}
                      </p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedDay(null)} className="p-2 hover:bg-white/50 rounded-lg">
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
                <div className="p-6 space-y-6">
                  {selectedDay.data.orders === 0 && selectedDay.data.revenue === 0 ? (
                    /* Empty state when no real sales data */
                    <div className="text-center py-8">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <BarChart3 className="w-8 h-8 text-gray-400" />
                      </div>
                      <h4 className="text-lg font-medium text-gray-700 mb-2">No Sales Data</h4>
                      <p className="text-sm text-gray-500 max-w-xs mx-auto">
                        Connect your POS system to see real sales data for this day. Go to Settings to configure your Toast POS integration.
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Key Metrics */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 mb-1">Total Revenue</p>
                          <p className="text-3xl font-bold text-gray-900">{formatMoney(selectedDay.data.revenue, 'full')}</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                          <p className="text-sm text-gray-500 mb-1">Bottles Sold</p>
                          <p className="text-3xl font-bold text-gray-900">{selectedDay.data.bottles}</p>
                        </div>
                      </div>

                      {/* Wine Type Breakdown */}
                      {selectedDay.data.bottles > 0 && (
                        <div>
                          <p className="text-sm font-medium text-gray-700 mb-3">Wine Type Breakdown</p>
                          <div className="space-y-2">
                            {[
                              { label: 'Red', value: selectedDay.data.byType.red, color: 'bg-rose-600' },
                              { label: 'White', value: selectedDay.data.byType.white, color: 'bg-amber-400' },
                              { label: 'Sparkling', value: selectedDay.data.byType.sparkling, color: 'bg-yellow-300' },
                              { label: 'Rosé', value: selectedDay.data.byType.rose, color: 'bg-pink-400' },
                              { label: 'Dessert', value: selectedDay.data.byType.dessert, color: 'bg-purple-500' },
                            ].map((type) => {
                              const percent = selectedDay.data.bottles > 0 ? (type.value / selectedDay.data.bottles) * 100 : 0
                              return (
                                <div key={type.label} className="flex items-center gap-3">
                                  <span className="text-sm text-gray-600 w-20">{type.label}</span>
                                  <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full ${type.color} transition-all`}
                                      style={{ width: `${percent}%` }}
                                    />
                                  </div>
                                  <span className="text-sm font-medium text-gray-900 w-12 text-right">{type.value}</span>
                                  <span className="text-xs text-gray-500 w-12">{percent.toFixed(1)}%</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Additional Stats */}
                      <div className="grid grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Avg Price/Bottle</p>
                          <p className="text-lg font-semibold text-gray-900">{selectedDay.data.avgPrice > 0 ? `$${selectedDay.data.avgPrice}` : '--'}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Total Orders</p>
                          <p className="text-lg font-semibold text-gray-900">{selectedDay.data.orders}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Top Seller</p>
                          <p className="text-lg font-semibold text-gray-900 truncate">{selectedDay.data.topSeller || '--'}</p>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Calendar Events */}
                  {selectedDay.data.events && selectedDay.data.events.length > 0 && (
                    <div className="pt-4 border-t border-gray-100">
                      <p className="text-sm font-medium text-gray-700 mb-3">Events & Reminders</p>
                      <div className="space-y-2">
                        {selectedDay.data.events.map((event) => {
                          const eventConfig: Record<string, { icon: string; bg: string; border: string; text: string }> = {
                            important_date: { icon: '📅', bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900' },
                            vendor_deadline: { icon: '⚠️', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900' },
                            recurring_order: { icon: '🔄', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900' },
                            report_schedule: { icon: '📊', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900' },
                            delivery: { icon: '🚚', bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-900' },
                            birthday: { icon: '🎂', bg: 'bg-pink-50', border: 'border-pink-200', text: 'text-pink-900' },
                            tasting: { icon: '🍷', bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-900' },
                            order: { icon: '🧾', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900' },
                            meeting: { icon: '👥', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-900' },
                            inventory: { icon: '📦', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900' },
                            reminder: { icon: '⏰', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900' },
                            recurring: { icon: '🔁', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900' },
                            custom: { icon: '📌', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-900' },
                          }
                          const config = eventConfig[event.type] || { icon: '📌', bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-900' }

                          return (
                            <div
                              key={event.id}
                              className={`flex items-center gap-3 p-3 rounded-lg border ${config.bg} ${config.border}`}
                            >
                              <span className="text-lg">{config.icon}</span>
                              <div className="flex-1">
                                <p className={`text-sm font-medium ${config.text}`}>{event.title}</p>
                                {event.time && (
                                  <p className="text-xs text-gray-600 mt-0.5">at {event.time}</p>
                                )}
                              </div>
                              {event.priority === 'high' && (
                                <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-semibold rounded-full">
                                  URGENT
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Create One-Tap Action Modal */}
        <AnimatePresence>
          {showCreateActionModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
              onClick={() => setShowCreateActionModal(false)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-50 to-purple-50">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-wine-600 rounded-xl">
                      <Zap className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">Create Quick Action</h2>
                      <p className="text-sm text-gray-500">Design a custom quick action for your workflow</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowCreateActionModal(false)}
                    className="p-2 hover:bg-white/50 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-gray-500" />
                  </button>
                </div>

                {/* Form */}
                <div className="p-6 space-y-6">
                  {/* Title */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Action Title <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={newAction.title}
                      onChange={(e) => setNewAction({ ...newAction, title: e.target.value })}
                      placeholder="e.g., Check Low Stock Wines"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={newAction.description}
                      onChange={(e) => setNewAction({ ...newAction, description: e.target.value })}
                      placeholder="Brief description of what this action does"
                      rows={3}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                    />
                  </div>

                  {/* Action URL */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Action URL <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        value={newAction.actionUrl}
                        onChange={(e) => setNewAction({ ...newAction, actionUrl: e.target.value })}
                        placeholder="/inventory or https://example.com"
                        className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500 focus:border-transparent"
                      />
                    </div>
                  </div>

                  {/* Priority & Color */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Priority
                      </label>
                      <select
                        value={newAction.priority}
                        onChange={(e) => setNewAction({ ...newAction, priority: e.target.value as any })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-wine-500"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Color Theme
                      </label>
                      <div className="flex gap-2 flex-wrap">
                        {colorOptions.map((color) => (
                          <button
                            key={color.value}
                            onClick={() => setNewAction({ ...newAction, color: color.value })}
                            className={`w-10 h-10 rounded-lg ${color.bg} ${
                              newAction.color === color.value ? 'ring-2 ring-offset-2 ring-gray-900' : ''
                            } transition-all hover:scale-110`}
                            title={color.name}
                          />
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Preview */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Preview
                    </label>
                    <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                      <button
                        className={`${colorOptions.find(c => c.value === newAction.color)?.bg} ${colorOptions.find(c => c.value === newAction.color)?.text} rounded-xl p-4 w-full text-left shadow-lg`}
                      >
                        <div className="flex items-center gap-3">
                          <Zap className="w-6 h-6" />
                          <div className="flex-1">
                            <h4 className="font-semibold">{newAction.title || 'Action Title'}</h4>
                            <p className="text-sm opacity-90">{newAction.description || 'Action description'}</p>
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-3">
                    <button
                      onClick={handleCreateAction}
                      disabled={!newAction.title || !newAction.actionUrl}
                      className="flex-1 px-6 py-3 bg-wine-600 text-white font-medium rounded-xl hover:bg-wine-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Create Action
                    </button>
                    <button
                      onClick={() => setShowCreateActionModal(false)}
                      className="px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </AnimatePresence>

      {/* Add Important Date Modal */}
      <AddImportantDateModal
        isOpen={showAddDateModal}
        onClose={() => setShowAddDateModal(false)}
        onSave={handleAddImportantDate}
      />
    </div>
  )
}
