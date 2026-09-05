/**
 * ONE-TAP ACTION CENTER
 * 
 * This is the CRITICAL component for Mudavym.
 * Per Blueprint requirements:
 * - Human-in-the-loop for all critical decisions
 * - One-tap actions for: Approve/Reject orders, stock corrections, price acceptance
 * - No autonomous purchasing without manager approval
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  X,
  Package,
  DollarSign,
  Truck,
  Wine,
  Plus,
  Clock,
  ChevronRight,
  Bell,
  Zap,
  RefreshCw,
  Filter,
  CheckSquare,
  Square,
  Command,
  Sparkles,
  Mail,
  Send,
  Copy,
  ExternalLink,
  Moon,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ContextMenu } from '../ui/ContextMenu'
import { useContextMenu } from '../../hooks/useContextMenu'
import { getWineTypeColor, Wine as WineType } from '../../data/wineData'
import { QuickGmailModal } from '../emails/QuickGmailModal'
import { useRealtimeDispatch } from '../../contexts/RealtimeContext'
import { getOrdersNeedingApproval, getOrders, markOrderDelivered } from '../../services/api/orders'
import {
  getOneTapActions,
  executeOneTapAction,
  cancelOneTapAction,
} from '../../services/api/dashboard'
import type { Order, OrderStatus } from '../../services/api/types'
import { canonicalStatus } from '../../lib/mudavym/status'
import { useAuthStore } from '../../stores'
import { useWines } from '../../hooks/queries'
import { mapApiWinesToUiWines } from '../../lib/wine-library'
import { useInventoryData } from '../../hooks/useInventoryData'

export interface ActionItem {
  id: string
  type: 'low_stock' | 'price_change' | 'delivery_confirm' | 'inequality' | 'vintage_sub' | 'stock_receipt' | 'gmail_send' | 'gmail_contextual'
  priority: 'critical' | 'high' | 'medium'
  title: string
  subtitle: string
  wine?: WineType
  details: Record<string, any>
  timestamp: Date
  /**
   * `'server'` means `id` is a real `one_tap_actions` row UUID and the card can
   * be executed or cancelled through `/one-tap-actions/:id/{execute,cancel}`.
   * Everything else is derived client-side from inventory/orders/localStorage
   * and has no server row behind it — approving such a card cannot be recorded
   * anywhere, which is why `commitApproval` refuses rather than pretending.
   */
  source?: 'server' | 'derived'
}

/**
 * Server action types the card bodies know how to render. `custom` is a valid
 * gateway type but has no branch below, so it would render a header with an
 * empty expansion; it is filtered out rather than shown as a dead card.
 */
const RENDERABLE_SERVER_TYPES = new Set<ActionItem['type']>([
  'low_stock',
  'price_change',
  'delivery_confirm',
  'inequality',
  'vintage_sub',
  'stock_receipt',
  'gmail_send',
  'gmail_contextual',
])

/**
 * Raised when a card promises an effect the backend has no way to perform.
 * Distinguished from a network failure so the UI can say "this cannot be done
 * from here" rather than "try again".
 */
class UnsupportedActionError extends Error {}

/** Gateway priorities include `low`, which this UI does not have a tier for. */
function toUiPriority(priority: unknown): ActionItem['priority'] {
  return priority === 'critical' || priority === 'high' ? priority : 'medium'
}

/** Map a `one_tap_actions` row (OneTapActionResponseDto) onto a card. */
function mapServerAction(row: any): ActionItem | null {
  if (!row?.id || !RENDERABLE_SERVER_TYPES.has(row.actionType)) return null
  return {
    id: row.id,
    type: row.actionType,
    priority: toUiPriority(row.priority),
    title: row.title || 'Action',
    subtitle: row.description || '',
    details: row.metadata || {},
    timestamp: new Date(row.createdAt || Date.now()),
    source: 'server',
  }
}

// Helper function to add a new action (can be called from anywhere)
export function addOneTapAction(action: Omit<ActionItem, 'id' | 'timestamp'>): void {
  const newAction: ActionItem = {
    ...action,
    id: `action_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    timestamp: new Date()
  }
  
  const stored = loadPersistedActions()
  stored.unshift(newAction)
  saveActionsToStorage(stored)
  
  // Dispatch event to notify components
  window.dispatchEvent(new CustomEvent('onetap_action_added', { detail: newAction }))
}

// Storage keys for persisted actions
const ACTIONS_STORAGE_KEY = 'wineops_pending_actions'
const SHADOW_STOCK_KEY = 'wineops_shadow_stock'
const PENDING_ORDERS_KEY = 'wineops_orders_history'
const SNOOZED_STORAGE_KEY = 'wineops_onetap_snoozed_v1'

function loadSnoozedIds(): Record<string, number> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SNOOZED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, number>
    const now = Date.now()
    const active: Record<string, number> = {}
    for (const [id, until] of Object.entries(parsed)) {
      if (typeof until === 'number' && until > now) active[id] = until
    }
    if (Object.keys(active).length !== Object.keys(parsed).length) {
      localStorage.setItem(SNOOZED_STORAGE_KEY, JSON.stringify(active))
    }
    return active
  } catch {
    return {}
  }
}

function snoozeActionUntilTomorrow(actionId: string): void {
  const tomorrow = new Date()
  tomorrow.setHours(24, 0, 0, 0)
  const current = loadSnoozedIds()
  current[actionId] = tomorrow.getTime()
  try {
    localStorage.setItem(SNOOZED_STORAGE_KEY, JSON.stringify(current))
  } catch {
    /* ignore */
  }
}

/**
 * Maps an action to the in-app route "Open related page" navigates to.
 *
 * Exported for tests: every string here must match a real `<Route path>` in
 * App.tsx or the click silently falls through to the `*` catch-all redirect.
 */
export function openRouteForAction(action: ActionItem): string {
  switch (action.type) {
    case 'low_stock':
    case 'stock_receipt':
    case 'inequality':
      return action.wine?.id ? `/inventory?highlight=${encodeURIComponent(action.wine.id)}` : '/inventory'
    case 'delivery_confirm':
    case 'price_change':
    case 'vintage_sub':
      return action.details?.orderId
        ? `/orders?orderId=${encodeURIComponent(action.details.orderId)}`
        : '/orders'
    case 'gmail_send':
    case 'gmail_contextual':
      // `/emails` is not a route; the comms surface is `/communications`. No id is
      // passed: `gmail_send` carries only `{ templates }` and `gmail_contextual`
      // only `{ recipient, subject }`, and Communications has no thread- or
      // compose-from-query-string entry point to hand them to.
      return '/communications'
    default:
      return '/'
  }
}

// Hard cap: never persist more than this many actions.
const MAX_PERSISTED_ACTIONS = 50

// Load persisted actions from localStorage.
// If the stored list is clearly corrupted (> MAX_PERSISTED_ACTIONS), wipe it.
function loadPersistedActions(): ActionItem[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(ACTIONS_STORAGE_KEY)
    if (!stored) return []
    const actions = JSON.parse(stored)
    if (!Array.isArray(actions)) { localStorage.removeItem(ACTIONS_STORAGE_KEY); return [] }
    if (actions.length > MAX_PERSISTED_ACTIONS) {
      localStorage.removeItem(ACTIONS_STORAGE_KEY)
      return []
    }
    // Deduplicate by id — prevents legacy duplicate entries from re-inflating
    const seen = new Set<string>()
    return actions
      .filter((a: any) => { if (!a?.id || seen.has(a.id)) return false; seen.add(a.id); return true })
      .map((a: any) => ({ ...a, timestamp: new Date(a.timestamp) }))
  } catch {
    localStorage.removeItem(ACTIONS_STORAGE_KEY)
    return []
  }
}

// Save actions to localStorage — deduplicate by id and cap to MAX_PERSISTED_ACTIONS.
function saveActionsToStorage(actions: ActionItem[]): void {
  if (typeof window === 'undefined') return
  try {
    const seen = new Set<string>()
    const deduped = actions.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true })
    localStorage.setItem(ACTIONS_STORAGE_KEY, JSON.stringify(deduped.slice(0, MAX_PERSISTED_ACTIONS)))
  } catch {
    /* ignore localStorage read failures */
  }
}

// Generate real actions from data sources
function generateRealActions(
  wines: WineType[],
  lowStockItems: Array<{ wineId?: string; wineName?: string; stockLive?: number; shadowStock?: number; thresholdMin?: number; thresholdMax?: number; providerName?: string }>,
  apiOrders: Order[] = [],
): ActionItem[] {
  const actions: ActionItem[] = []
  const now = new Date()

  // 1. Low Stock Alerts — only fire when stockLive + shadowStock <= threshold.
  //    Multiple wines are collapsed into a single combined notification to prevent spam.
  const eligibleLowStock = lowStockItems.filter((item) => {
    const combined = (item.stockLive ?? 0) + (item.shadowStock ?? 0)
    const threshold = item.thresholdMin ?? 6
    return combined <= threshold
  })

  if (eligibleLowStock.length === 1) {
    const item = eligibleLowStock[0]
    const combined = (item.stockLive ?? 0) + (item.shadowStock ?? 0)
    const threshold = item.thresholdMin ?? 6
    const isCritical = combined <= threshold * 0.5
    const wine = wines.find(w => w.id === item.wineId)
    actions.push({
      id: `low_stock_${item.wineId || item.wineName || 0}`,
      type: 'low_stock',
      priority: isCritical ? 'critical' : 'high',
      title: wine?.name || item.wineName || 'Low stock wine',
      subtitle: `${combined} bottles total (live + on-order) • Threshold: ${threshold}`,
      wine,
      details: {
        currentStock: combined,
        threshold,
        suggestedOrder: Math.max(threshold * 2 - combined, 6),
        estimatedPrice: (wine?.price || 0) * Math.max(threshold * 2 - combined, 6),
      },
      timestamp: new Date(now.getTime() - 1000 * 60 * 5),
    })
  } else if (eligibleLowStock.length > 1) {
    // Combine all below-threshold wines into one action
    const hasCritical = eligibleLowStock.some((item) => {
      const combined = (item.stockLive ?? 0) + (item.shadowStock ?? 0)
      return combined <= (item.thresholdMin ?? 6) * 0.5
    })
    const preview = eligibleLowStock.slice(0, 3).map((item) => {
      const wine = wines.find(w => w.id === item.wineId)
      return wine?.name || item.wineName || 'Unknown wine'
    })
    const rest = eligibleLowStock.length - 3
    const subtitle = preview.join(' · ') + (rest > 0 ? ` +${rest} more` : '')
    const totalSuggested = eligibleLowStock.reduce((sum, item) => {
      const combined = (item.stockLive ?? 0) + (item.shadowStock ?? 0)
      const threshold = item.thresholdMin ?? 6
      return sum + Math.max(threshold * 2 - combined, 6)
    }, 0)
    actions.push({
      id: 'low_stock_combined',
      type: 'low_stock',
      priority: hasCritical ? 'critical' : 'high',
      title: `${eligibleLowStock.length} Wines Need Restocking`,
      subtitle,
      wine: undefined,
      details: {
        currentStock: 0,
        threshold: 0,
        suggestedOrder: totalSuggested,
        estimatedPrice: 0,
        items: eligibleLowStock.map((item) => {
          const combined = (item.stockLive ?? 0) + (item.shadowStock ?? 0)
          const threshold = item.thresholdMin ?? 6
          const wine = wines.find(w => w.id === item.wineId)
          return {
            wineId: item.wineId,
            wineName: wine?.name || item.wineName,
            stock: combined,
            threshold,
            isCritical: combined <= threshold * 0.5,
          }
        }),
      },
      timestamp: new Date(now.getTime() - 1000 * 60 * 5),
    })
  }
  
  // 2. Shadow Stock Reconciliation - check for wines with shadow stock > 0
  try {
    const shadowStockData = localStorage.getItem(SHADOW_STOCK_KEY)
    if (shadowStockData) {
      const shadowItems = JSON.parse(shadowStockData)
      Object.entries(shadowItems).slice(0, 3).forEach(([wineId, data]: [string, any], index) => {
        if (data.quantity > 0) {
          const wine = wines.find(w => w.id === wineId)
          actions.push({
            id: `stock_receipt_${wineId}`,
            type: 'stock_receipt',
            priority: 'high',
            title: 'Confirm Stock Receipt',
            subtitle: `${wine?.name || 'Wine'} • ${data.quantity} bottles in Shadow Stock`,
            wine,
            details: { 
              quantity: data.quantity, 
              cost: data.cost || (wine?.price || 0) * data.quantity, 
              supplier: data.provider || 'Unknown Supplier',
              orderId: data.orderId || 'N/A'
            },
            timestamp: new Date(data.timestamp || now.getTime() - (index + 1) * 1000 * 60 * 10),
          })
        }
      })
    }
  } catch {
    /* ignore localStorage read failures */
  }
  
  // 3. Pending Orders - from API (passed in) or fallback to localStorage
  const ordersToProcess = apiOrders.length > 0 ? apiOrders : []
  
  // If API orders are available, use them
  if (ordersToProcess.length > 0) {
    /*
     * TWO DEFECTS, BOTH MEASURED 2026-09-05, BOTH FIXED HERE.
     *
     * (a) The filter compared the WIRE status to lowercase UI literals.
     *     `OrderResponseDto.status` is `ProcurementOrderStatus` in
     *     SCREAMING_SNAKE, so `o.status === 'approved'` was false for every
     *     order ever fetched and this branch produced no cards at all.
     *     `canonicalStatus` is the repo's one wire-to-UI mapper
     *     (`lib/mudavym/status.ts`) and is what the comparison now goes
     *     through. It does NOT arm anything new: the two fetches above ask
     *     for PENDING/APPROVAL_NEEDED and CONFIRMED, which canonicalise to
     *     'pending', 'pending_approval' and 'ordered' — still none of them
     *     'approved' or 'in_transit'. The card is now correctly written and
     *     still unreachable; widening the fetch is a founder's call, filed in
     *     `.planning/v3.0-TECH-DEBT.md`.
     *
     * (b) `totalPrice`, `unitPrice`, `providerName`, `wineId` and `createdAt`
     *     are names the route has never sent. `order.totalPrice ||
     *     order.quantity * (order.unitPrice || 0)` was therefore `0`, so the
     *     card printed "$0" as the invoice price AND "$0" as the negotiated
     *     price — and `negotiatedPrice` is dispatched as `cost` on the
     *     inventory-update event when the delivery is confirmed, so a zero
     *     was being WRITTEN, not merely shown. The figures are now the DTO's
     *     own `totalCost` / `finalPrice`, and `null` when the route did not
     *     carry them, which the card renders as words rather than as a
     *     number.
     */
    ordersToProcess
      .filter((o) => {
        const s = canonicalStatus(o.status)
        return s === 'approved' || s === 'in_transit'
      })
      .slice(0, 3)
      .forEach((order, index: number) => {
        const wine = wines.find(w => w.id === order.inventoryId)
        const invoicePrice =
          order.totalCost ??
          (order.finalPrice != null && order.quantity != null
            ? order.finalPrice * order.quantity
            : null)
        actions.push({
          id: `delivery_${order.id}`,
          type: 'delivery_confirm',
          priority: 'high',
          title: `${order.wineName || wine?.name || 'Wine'} Delivery`,
          subtitle: `${order.quantity} bottles • Verify & Confirm`,
          wine,
          details: { 
            expectedQty: order.quantity, 
            invoicePrice, 
            negotiatedPrice: invoicePrice == null ? null : invoicePrice * 0.97,
            supplier: 'Not named by this route',
            orderId: order.id
          },
          timestamp: new Date(order.requestedAt || now.getTime() - (index + 1) * 1000 * 60 * 15),
        })
      })
  } else {
    // Fallback to localStorage for offline/demo mode
    try {
      const ordersData = localStorage.getItem(PENDING_ORDERS_KEY)
      if (ordersData) {
        const localOrders = JSON.parse(ordersData)
        localOrders
          .filter((o: any) => o.status === 'approved' || o.status === 'ordered')
          .slice(0, 3)
          .forEach((order: any, index: number) => {
            const wine = wines.find(w => w.name === order.wineName)
            actions.push({
              id: `delivery_${order.id}`,
              type: 'delivery_confirm',
              priority: 'high',
              title: `${order.wineName} Delivery`,
              subtitle: `${order.quantity} bottles • Verify & Confirm`,
              wine,
              details: { 
                expectedQty: order.quantity, 
                invoicePrice: order.totalPrice, 
                negotiatedPrice: order.totalPrice * 0.97,
                supplier: order.providerName
              },
              timestamp: new Date(order.createdAt || now.getTime() - (index + 1) * 1000 * 60 * 15),
            })
          })
      }
    } catch {
    /* ignore localStorage read failures */
  }
  }
  
  // 4. Always include Gmail quick action
  actions.push({
    id: 'action_gmail_001',
    type: 'gmail_send',
    priority: 'medium',
    title: 'Send Email Report',
    subtitle: 'Quick access to saved templates',
    details: { templates: [] },
    timestamp: new Date(now.getTime() - 1000 * 60 * 1),
  })
  
  // Sort by priority and timestamp
  const priorityOrder = { critical: 0, high: 1, medium: 2 }
  actions.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
    if (priorityDiff !== 0) return priorityDiff
    return b.timestamp.getTime() - a.timestamp.getTime()
  })
  
  return actions
}

// Initial actions - load from storage first, generate with empty API orders if no persisted
function getInitialActions(wines: WineType[], lowStockItems: Array<{ wineId?: string; wineName?: string; stockLive?: number; thresholdMin?: number }>): ActionItem[] {
  const persisted = loadPersistedActions()
  if (persisted.length > 0) return persisted
  // Generate actions without API orders initially - they'll be updated when API data loads
  return generateRealActions(wines, lowStockItems, [])
}

export function OneTapActionCenter() {
  const navigate = useNavigate()
  const actionMenu = useContextMenu<ActionItem>()
  const { data: apiWines = [] } = useWines({ limit: 500 })
  const libraryWines = useMemo(() => mapApiWinesToUiWines(apiWines), [apiWines])
  const { lowStockItems = [] } = useInventoryData()
  const initialActions = useMemo(
    () => getInitialActions(libraryWines, lowStockItems),
    [libraryWines, lowStockItems],
  )
  // On mount: prune oversized / duplicate localStorage entries immediately.
  // The deduped result is discarded here because initialActions (from useMemo) is used
  // as the authoritative starting point; fetchOrders will reconcile everything once data loads.
  const [actions, setActions] = useState<ActionItem[]>(() => {
    const persisted = loadPersistedActions() // side-effect: prunes & deduplicates store
    saveActionsToStorage(persisted)          // write the cleaned list back immediately
    return initialActions
  })
  const [expandedAction, setExpandedAction] = useState<string | null>(null)
  const [processingAction, setProcessingAction] = useState<string | null>(null)
  const [_ordersLoading, setOrdersLoading] = useState(false)
  const [snoozedIds, setSnoozedIds] = useState<Record<string, number>>(() => loadSnoozedIds())
  
  // Get restaurant ID from auth store
  const restaurantId = useAuthStore(state => state.activeRestaurantId)
  
  // Realtime dispatch for cross-page sync
  // `dispatchOrderUpdate` was used to announce an order that had never been
  // created — it broadcast a fabricated `ORD-<timestamp>` id to every listening
  // page. Nothing here creates orders any more, so nothing announces them.
  const { dispatchInventoryUpdate } = useRealtimeDispatch()

  // The poll effect below must not key off `libraryWines` / `lowStockItems`
  // directly: both are rebuilt on every render (`mapApiWinesToUiWines(...)` and
  // `lowStockQuery.data || []` each return a fresh array), so an effect that
  // depends on their identity re-subscribes every render, and its own
  // `setActions` — which always produces a new array — schedules the next
  // render. That is an unbounded fetch loop, not a 60-second poll. Depend on
  // stable primitives derived from the data; read the data itself off refs.
  const winesRef = useRef(libraryWines)
  winesRef.current = libraryWines
  const lowStockRef = useRef(lowStockItems)
  lowStockRef.current = lowStockItems
  const winesKey = libraryWines.length
  const lowStockKey = useMemo(
    () => lowStockItems.map((i: any) => `${i.wineId}:${i.stockLive}:${i.shadowStock ?? 0}`).join('|'),
    [lowStockItems],
  )

  // Fetch orders and server-side one-tap actions, then regenerate the list.
  //
  // `getOneTapActions` had no callers anywhere in the app, so the gateway's
  // `one_tap_actions` rows were invisible and the only cards on screen were the
  // ones this component derived locally. Those derived cards have no server row,
  // which is why approving them could not be recorded — see `commitApproval`.
  useEffect(() => {
    if (!restaurantId) return

    const fetchOrders = async () => {
      setOrdersLoading(true)
      try {
        // Fetch pending orders, recent in-transit orders, and server actions
        const [pendingOrders, allOrders, serverRows] = await Promise.all([
          getOrdersNeedingApproval(restaurantId).catch(() => [] as Order[]),
          getOrders({ status: 'ordered' as OrderStatus }, restaurantId).catch(() => [] as Order[]),
          getOneTapActions(restaurantId).catch(() => [] as any[]),
        ])

        // Combine and dedupe
        const combinedOrders = [...pendingOrders, ...allOrders]
        const uniqueOrders = combinedOrders.filter(
          (order, index, self) => self.findIndex(o => o.id === order.id) === index
        )

        const serverActions = (serverRows || [])
          .filter((row: any) => row?.status === 'pending' || row?.status === 'in_progress')
          .map(mapServerAction)
          .filter((a): a is ActionItem => a !== null)

        // Always regenerate from real data — this also clears any duplicated entries
        // that may have accumulated in localStorage across sessions.
        const derivedActions = generateRealActions(winesRef.current, lowStockRef.current, uniqueOrders)
        const newActions = [...serverActions, ...derivedActions]
        setActions(prev => {
          const autoIds = new Set(newActions.map(a => a.id))
          // Drop stale server cards: a row the server no longer lists as open
          // was executed or cancelled elsewhere and must not linger here.
          const userCreatedActions = prev.filter(a => !autoIds.has(a.id) && a.source !== 'server')
          return [...newActions, ...userCreatedActions].slice(0, MAX_PERSISTED_ACTIONS)
        })
      } catch (error) {
        console.warn('[OneTapActions] Failed to fetch actions from API:', error)
        // Keep using existing actions (localStorage fallback already happened)
      } finally {
        setOrdersLoading(false)
      }
    }

    fetchOrders()

    // Refresh every 60 seconds
    const interval = setInterval(fetchOrders, 60000)
    return () => clearInterval(interval)
  }, [restaurantId, winesKey, lowStockKey])
  
  // **NEW: Efficiency Features**
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'critical' | 'high' | 'medium'>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | ActionItem['type']>('all')
  const [showKeyboardHints, setShowKeyboardHints] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  
  // Gmail Modal
  const [showGmailModal, setShowGmailModal] = useState(false)
  const [gmailRecipient, setGmailRecipient] = useState('')
  const [gmailSubject, setGmailSubject] = useState('')
  
  // Merge auto-generated actions into state only when the set of IDs actually changes.
  // Using a serialised key prevents the effect running on every render cycle.
  const initialActionKey = useMemo(
    () => initialActions.map((a) => a.id).join(','),
    [initialActions],
  )
  useEffect(() => {
    setActions(prev => {
      // Deduplicate initialActions by id before merging (guards against duplicate entries
      // that can come from localStorage before the dedup fix was applied).
      const seen = new Set<string>()
      const dedupedInitial = initialActions.filter(a => {
        if (seen.has(a.id)) return false
        seen.add(a.id)
        return true
      })
      const autoIds = new Set(dedupedInitial.map(a => a.id))
      // If every auto-id is already present, skip the update to break the loop.
      const allPresent = dedupedInitial.every(a => prev.some(p => p.id === a.id))
      if (allPresent) return prev
      const preserved = prev.filter(a => !autoIds.has(a.id))
      return [...dedupedInitial, ...preserved].slice(0, MAX_PERSISTED_ACTIONS)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialActionKey])

  // Persist actions when they change, but debounce to avoid write-storms.
  useEffect(() => {
    const timer = setTimeout(() => saveActionsToStorage(actions), 500)
    return () => clearTimeout(timer)
  }, [actions])
  
  useEffect(() => {
    const handleNewAction = (event: Event) => {
      const customEvent = event as CustomEvent<ActionItem>
      if (customEvent.detail) {
        setActions(prev =>
          prev.some(a => a.id === customEvent.detail.id)
            ? prev
            : [customEvent.detail, ...prev].slice(0, MAX_PERSISTED_ACTIONS)
        )
      }
    }
    window.addEventListener('onetap_action_added', handleNewAction)
    return () => window.removeEventListener('onetap_action_added', handleNewAction)
  }, [])

  const getPriorityColor = (priority: ActionItem['priority']) => {
    switch (priority) {
      case 'critical': return 'bg-rose-500'
      case 'high': return 'bg-amber-500'
      case 'medium': return 'bg-blue-500'
      default: return 'bg-gray-400'
    }
  }

  const getTypeIcon = (type: ActionItem['type']) => {
    switch (type) {
      case 'low_stock': return AlertTriangle
      case 'price_change': return DollarSign
      case 'delivery_confirm': return Truck
      case 'inequality': return RefreshCw
      case 'vintage_sub': return Wine
      default: return Bell
    }
  }

  /** Put an optimistically-removed card back, preserving list order rules. */
  const restoreAction = (action: ActionItem) => {
    setActions(prev =>
      prev.some(a => a.id === action.id) ? prev : [action, ...prev].slice(0, MAX_PERSISTED_ACTIONS)
    )
  }

  const failureMessage = (error: unknown, fallback: string) => {
    const status = (error as { response?: { status?: number } })?.response?.status
    if (status === 401 || status === 403) return 'Your session no longer has access to this action.'
    if (status === 404) return 'That action no longer exists on the server.'
    return (error as Error)?.message || fallback
  }

  /**
   * Perform the approval against the server and report what actually happened.
   *
   * Every branch here either calls a real endpoint or throws. There is no path
   * that returns success without a server write — the previous implementation
   * had exactly that, fabricating `ORD-<timestamp>` ids into localStorage and
   * resolving a 300ms timer, so the card vanished and the user believed an order
   * had been placed when nothing had left the browser.
   */
  const commitApproval = async (action: ActionItem): Promise<string> => {
    // Cards backed by a real `one_tap_actions` row: the gateway records the
    // execution against the authenticated user and broadcasts it.
    if (action.source === 'server') {
      await executeOneTapAction(action.id, restaurantId || undefined)
      return 'Action executed'
    }

    // Locally-derived delivery cards carry the real procurement order id
    // (`details.orderId` is only set on the branch fed by the orders API), so
    // confirming receipt maps onto POST /procurement/orders/:id/deliver.
    if (action.type === 'delivery_confirm' && typeof action.details?.orderId === 'string' && action.details.orderId) {
      await markOrderDelivered(action.details.orderId, undefined, restaurantId || undefined)
      if (action.wine) {
        dispatchInventoryUpdate({
          type: 'stock_change',
          wineId: action.wine.id,
          wineName: action.wine.name,
          quantity: action.details.expectedQty,
          source: 'order_delivery',
          timestamp: new Date().toISOString(),
          metadata: {
            stockType: 'shadow',
            orderId: action.details.orderId,
            cost: action.details.negotiatedPrice,
            provider: action.details.supplier,
          },
        })
      }
      return 'Delivery confirmed'
    }

    // Everything below is derived client-side and has no endpoint that performs
    // what the button says, so refusing is the honest outcome.
    //
    // `low_stock` would need POST /procurement/orders, which requires a
    // `providerId` and a real `unitPrice`. Neither exists on this card: the UI
    // wine's `provider` is a name-only object synthesised from the static
    // `providerData` list when the record has no `provider_info`, and
    // `details.estimatedPrice` is derived from that same synthetic price.
    //
    // `stock_receipt` is generated purely from the `wineops_shadow_stock`
    // localStorage key, so there is no server-side lot to move; the real
    // shadow-to-live path is POST /procurement/orders/:id/verify-receipt, which
    // needs an invoice and lives in Receiving.
    if (action.type === 'low_stock') {
      throw new UnsupportedActionError(
        'Reorders cannot be placed from here — this card carries no vendor id or agreed price. Create the order in Orders.'
      )
    }
    if (action.type === 'stock_receipt') {
      throw new UnsupportedActionError(
        'Moving shadow stock to live stock is a receiving step — do it in Receiving so the invoice is matched.'
      )
    }
    throw new UnsupportedActionError('This action has no server-side counterpart yet.')
  }

  /**
   * Cancel/dismiss. Server-backed cards are cancelled on the server so the
   * rejection is auditable; derived cards are only ever a local dismissal and
   * say so, rather than implying something was sent to a vendor.
   */
  const commitRejection = async (action: ActionItem): Promise<string> => {
    if (action.source === 'server') {
      await cancelOneTapAction(action.id, restaurantId || undefined)
      return 'Action cancelled'
    }
    if (action.type === 'delivery_confirm') {
      throw new UnsupportedActionError(
        'There is no endpoint that reports a delivery problem. Open the order and record the discrepancy in Receiving.'
      )
    }
    return 'Dismissed here — nothing was sent'
  }

  const runAction = async (
    action: ActionItem,
    commit: (a: ActionItem) => Promise<string>,
    fallbackError: string,
  ) => {
    if (processingAction) return
    setProcessingAction(action.id)
    // Optimistic: the card goes immediately, and comes straight back if the
    // server refuses. A failed call must never look like a success.
    setActions(prev => prev.filter(a => a.id !== action.id))

    try {
      const message = await commit(action)
      toast.success(message)
    } catch (error) {
      restoreAction(action)
      if (error instanceof UnsupportedActionError) {
        toast.error(error.message)
      } else {
        console.error('[OneTapActions] action failed:', error)
        toast.error(failureMessage(error, fallbackError))
      }
    } finally {
      setProcessingAction(null)
    }
  }

  const handleApprove = (action: ActionItem) => {
    // A Gmail card is a launcher, not an approval — its "tick" opens the
    // composer. It must not be routed through the server-commit path, which
    // would (correctly) refuse it.
    if (action.type === 'gmail_send' || action.type === 'gmail_contextual') {
      handleGmailAction(action)
      return Promise.resolve()
    }
    return runAction(action, commitApproval, 'Could not complete that action.')
  }

  const handleReject = (action: ActionItem) =>
    runAction(action, commitRejection, 'Could not dismiss that action.')

  const handleGmailAction = (action: ActionItem) => {
    if (action.type === 'gmail_send') {
      // Open Gmail modal with template selector
      setGmailRecipient('')
      setGmailSubject('')
      setShowGmailModal(true)
    } else if (action.type === 'gmail_contextual') {
      // Open Gmail modal with pre-filled data
      setGmailRecipient(action.details.recipient || '')
      setGmailSubject(action.details.subject || '')
      setShowGmailModal(true)
    }
  }

  /**
   * "+6 bottles" / "+1 case" on an inequality card.
   *
   * A server-backed card records the chosen correction as the action's
   * `execution_result`, which is what `ExecuteActionDto.result` is for. Note
   * this does NOT move stock — the gateway's `triggerWorkflow` is a log line for
   * every action type — so the toast says "recorded", not "applied".
   *
   * A derived card has nowhere to record it at all and is refused.
   */
  const handleStockCorrection = (action: ActionItem, correction: number) =>
    runAction(
      action,
      async (a) => {
        if (a.source !== 'server') {
          throw new UnsupportedActionError(
            'This count correction has no server record to write to. Adjust the count in Inventory.'
          )
        }
        await executeOneTapAction(a.id, restaurantId || undefined, {
          correctionBottles: correction,
        })
        return `Correction of +${correction} recorded`
      },
      'Could not record that correction.',
    )

  const formatTimeAgo = (date: Date) => {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    return `${Math.floor(mins / 60)}h ago`
  }

  // **NEW: Filtered Actions**
  const filteredActions = useMemo(() => {
    const now = Date.now()
    let filtered = actions.filter((a) => !snoozedIds[a.id] || snoozedIds[a.id] <= now)
    
    if (priorityFilter !== 'all') {
      filtered = filtered.filter(a => a.priority === priorityFilter)
    }
    
    if (typeFilter !== 'all') {
      filtered = filtered.filter(a => a.type === typeFilter)
    }
    
    // Sort by priority and timestamp
    return filtered.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2 }
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return b.timestamp.getTime() - a.timestamp.getTime()
    })
  }, [actions, priorityFilter, typeFilter, snoozedIds])

  // **NEW: Batch Actions**
  //
  // This used to sleep 1500ms and then delete every selected card, which was the
  // single-card fabrication multiplied by the selection size. It now approves
  // each card through the same server path and reports the real split; cards
  // that failed stay on screen.
  const handleBatchApprove = async () => {
    if (selectedActions.size === 0 || processingAction) return
    setProcessingAction('batch')

    const targets = actions.filter(a => selectedActions.has(a.id))
    const succeeded: string[] = []
    const failures: string[] = []

    for (const action of targets) {
      try {
        await commitApproval(action)
        succeeded.push(action.id)
      } catch (error) {
        failures.push(
          error instanceof UnsupportedActionError
            ? `${action.title}: ${error.message}`
            : `${action.title}: ${failureMessage(error, 'failed')}`,
        )
      }
    }

    // Only the cards the server actually accepted leave the list.
    setActions(prev => prev.filter(a => !succeeded.includes(a.id)))
    setSelectedActions(new Set(failures.length > 0 ? targets.filter(t => !succeeded.includes(t.id)).map(t => t.id) : []))
    setProcessingAction(null)
    if (failures.length === 0) {
      setBatchMode(false)
      toast.success(`${succeeded.length} action${succeeded.length === 1 ? '' : 's'} executed`)
    } else {
      if (succeeded.length > 0) toast.success(`${succeeded.length} executed`)
      toast.error(
        failures.length === 1 ? failures[0] : `${failures.length} could not be completed — see the remaining cards`,
      )
    }
  }

  const toggleActionSelection = (actionId: string) => {
    setSelectedActions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(actionId)) {
        newSet.delete(actionId)
      } else {
        newSet.add(actionId)
      }
      return newSet
    })
  }

  const selectAllFiltered = () => {
    setSelectedActions(new Set(filteredActions.map(a => a.id)))
  }

  const deselectAll = () => {
    setSelectedActions(new Set())
  }

  // **NEW: Smart Suggestions** 
  const smartSuggestions = useMemo(() => {
    const suggestions: { text: string; action: () => void }[] = []
    
    const lowStockActions = filteredActions.filter(a => a.type === 'low_stock')
    if (lowStockActions.length >= 3) {
      suggestions.push({
        text: `Approve all ${lowStockActions.length} low stock reorders`,
        action: () => {
          setSelectedActions(new Set(lowStockActions.map(a => a.id)))
          setBatchMode(true)
        }
      })
    }
    
    const deliveryActions = filteredActions.filter(a => a.type === 'delivery_confirm')
    if (deliveryActions.length >= 2) {
      suggestions.push({
        text: `Confirm all ${deliveryActions.length} deliveries`,
        action: () => {
          setSelectedActions(new Set(deliveryActions.map(a => a.id)))
          setBatchMode(true)
        }
      })
    }
    
    return suggestions
  }, [filteredActions])

  // **NEW: Keyboard Shortcuts**
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K: Toggle filters
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowFilters(prev => !prev)
      }
      
      // Cmd/Ctrl + B: Toggle batch mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault()
        setBatchMode(prev => !prev)
      }
      
      // Cmd/Ctrl + A: Select all
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && batchMode) {
        e.preventDefault()
        selectAllFiltered()
      }
      
      // Cmd/Ctrl + ?: Show keyboard hints
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        setShowKeyboardHints(prev => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [batchMode, filteredActions])

  const criticalCount = actions.filter(a => a.priority === 'critical').length

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-wine-50 to-transparent">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 bg-wine-100 rounded-xl flex items-center justify-center">
              <Zap className="w-5 h-5 text-wine-600" />
            </div>
            {criticalCount > 0 && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white text-xs font-bold rounded-full flex items-center justify-center animate-pulse">
                {criticalCount}
              </span>
            )}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">One-Tap Actions</h3>
            <p className="text-sm text-gray-500">{filteredActions.length} pending • {selectedActions.size} selected</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-lg transition-colors ${showFilters ? 'bg-wine-100 text-wine-600' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Filters (⌘K)"
          >
            <Filter className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setBatchMode(!batchMode)}
            className={`p-2 rounded-lg transition-colors ${batchMode ? 'bg-emerald-100 text-emerald-600' : 'text-gray-500 hover:bg-gray-100'}`}
            title="Batch Mode (⌘B)"
          >
            <CheckSquare className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setShowKeyboardHints(!showKeyboardHints)}
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            title="Keyboard Shortcuts (⌘/)"
          >
            <Command className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-gray-100 overflow-hidden"
          >
            <div className="px-6 py-3 flex items-center gap-4">
              <span className="text-sm font-medium text-gray-600">Filters:</span>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as any)}
                className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
              >
                <option value="all">All Priorities</option>
                <option value="critical">Critical Only</option>
                <option value="high">High Only</option>
                <option value="medium">Medium Only</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
                className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-wine-500"
              >
                <option value="all">All Types</option>
                <option value="low_stock">Low Stock</option>
                <option value="delivery_confirm">Delivery</option>
                <option value="price_change">Price</option>
                <option value="inequality">Inequality</option>
                <option value="vintage_sub">Vintage Sub</option>
                <option value="stock_receipt">Stock Receipt</option>
              </select>
              {(priorityFilter !== 'all' || typeFilter !== 'all') && (
                <button
                  onClick={() => {
                    setPriorityFilter('all')
                    setTypeFilter('all')
                  }}
                  className="text-sm text-wine-600 hover:text-wine-700 font-medium"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Smart Suggestions */}
      <AnimatePresence>
        {smartSuggestions.length > 0 && !batchMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-gray-100 overflow-hidden bg-gradient-to-r from-purple-50 to-indigo-50"
          >
            <div className="px-6 py-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <Sparkles className="w-4 h-4 text-purple-600" />
                AI Suggestions
              </div>
              {smartSuggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={suggestion.action}
                  className="w-full text-left px-3 py-2 bg-white hover:bg-purple-50 border border-purple-100 rounded-lg text-sm text-gray-700 transition-colors"
                >
                  {suggestion.text}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Batch Action Bar */}
      <AnimatePresence>
        {batchMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-gray-100 overflow-hidden bg-emerald-50"
          >
            <div className="px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-gray-900">
                  {selectedActions.size} action(s) selected
                </span>
                {selectedActions.size > 0 && (
                  <button
                    onClick={deselectAll}
                    className="text-xs text-gray-600 hover:text-gray-900"
                  >
                    Deselect All
                  </button>
                )}
                <button
                  onClick={selectAllFiltered}
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  Select All Visible
                </button>
              </div>
              <button
                onClick={handleBatchApprove}
                disabled={selectedActions.size === 0 || processingAction === 'batch'}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center gap-2"
              >
                {processingAction === 'batch' ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Approve Selected ({selectedActions.size})
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keyboard Shortcuts Hint */}
      <AnimatePresence>
        {showKeyboardHints && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-b border-gray-100 overflow-hidden bg-gray-50"
          >
            <div className="px-6 py-3 grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Toggle Filters</span>
                <kbd className="px-2 py-1 bg-white border border-gray-200 rounded">⌘K</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Batch Mode</span>
                <kbd className="px-2 py-1 bg-white border border-gray-200 rounded">⌘B</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Select All</span>
                <kbd className="px-2 py-1 bg-white border border-gray-200 rounded">⌘A</kbd>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Shortcuts</span>
                <kbd className="px-2 py-1 bg-white border border-gray-200 rounded">⌘/</kbd>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action List */}
      <div className="divide-y divide-gray-50 max-h-[500px] overflow-y-auto">
        <AnimatePresence>
          {filteredActions.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="p-8 text-center"
            >
              <div className="w-16 h-16 bg-emerald-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="font-medium text-gray-900">All caught up!</p>
              <p className="text-sm text-gray-500 mt-1">No pending actions require your attention</p>
            </motion.div>
          ) : (
            filteredActions.map((action) => {
              const Icon = getTypeIcon(action.type)
              const isExpanded = expandedAction === action.id
              const isProcessing = processingAction === action.id
              const typeColors = action.wine ? getWineTypeColor(action.wine.type) : null
              const isSelected = selectedActions.has(action.id)

              return (
                <motion.div
                  key={action.id}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  className="overflow-hidden"
                >
                  <div
                    onClick={() => !batchMode && setExpandedAction(isExpanded ? null : action.id)}
                    onDoubleClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (!batchMode && !isProcessing) {
                        void handleApprove(action)
                      }
                    }}
                    onContextMenu={(e) => {
                      if (batchMode) return
                      actionMenu.onContextMenu(e, action)
                    }}
                    title={!batchMode ? 'Double-click to approve' : undefined}
                    className={`px-6 py-4 ${batchMode ? 'cursor-default' : 'cursor-pointer'} transition-colors ${
                      isExpanded ? 'bg-gray-50' : batchMode && isSelected ? 'bg-emerald-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      {/* Batch Mode Checkbox */}
                      {batchMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleActionSelection(action.id)
                          }}
                          className="p-1 hover:bg-gray-100 rounded transition-colors"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <Square className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                      )}

                      {/* Priority Indicator */}
                      <div className={`w-1.5 h-full min-h-[60px] rounded-full ${getPriorityColor(action.priority)}`} />

                      {/* Icon */}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        action.priority === 'critical' ? 'bg-rose-100' :
                        action.priority === 'high' ? 'bg-amber-100' : 'bg-blue-100'
                      }`}>
                        <Icon className={`w-5 h-5 ${
                          action.priority === 'critical' ? 'text-rose-600' :
                          action.priority === 'high' ? 'text-amber-600' : 'text-blue-600'
                        }`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold text-gray-900 truncate">{action.title}</h4>
                          {typeColors && (
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors.bg} ${typeColors.text}`}>
                              {action.wine?.type}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">{action.subtitle}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          <span className="text-xs text-gray-400">{formatTimeAgo(action.timestamp)}</span>
                        </div>
                      </div>

                      {/* Quick Actions (when collapsed) */}
                      {!isExpanded && !isProcessing && (
                        <div className="flex items-center gap-2">
                          <button
                            aria-label={`Approve: ${action.title}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleApprove(action)
                            }}
                            className="p-2 bg-emerald-100 text-emerald-600 rounded-lg hover:bg-emerald-200 transition-colors"
                          >
                            <Check className="w-5 h-5" />
                          </button>
                          <button
                            aria-label={`Dismiss: ${action.title}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              void handleReject(action)
                            }}
                            className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      )}

                      {isProcessing && (
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 border-2 border-wine-600 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}

                      {!isProcessing && (
                        <ChevronRight className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      )}
                    </div>
                  </div>

                  {/* Expanded Details */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="px-6 pb-4 bg-gray-50"
                      >
                        <div className="ml-14 pt-2 border-t border-gray-200">
                          {/* Low Stock Action */}
                          {action.type === 'low_stock' && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Current Stock</p>
                                  <p className="text-xl font-bold text-rose-600">{action.details.currentStock} bottles</p>
                                </div>
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Suggested Order</p>
                                  <p className="text-xl font-bold text-gray-900">{action.details.suggestedOrder} bottles</p>
                                </div>
                              </div>
                              <div className="p-3 bg-white rounded-xl">
                                <p className="text-xs text-gray-500 mb-1">Estimated Cost</p>
                                <p className="text-2xl font-bold text-gray-900">
                                  ${action.details.estimatedPrice.toLocaleString()}
                                </p>
                              </div>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleApprove(action)}
                                  disabled={isProcessing}
                                  className="flex-1 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                                >
                                  <Check className="w-5 h-5" />
                                  Approve Reorder
                                </button>
                                <button
                                  onClick={() => handleReject(action)}
                                  disabled={isProcessing}
                                  className="px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Stock Receipt Confirmation */}
                          {action.type === 'stock_receipt' && (
                            <div className="space-y-4">
                              <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-100">
                                <div className="flex items-center gap-3 mb-3">
                                  <div className="p-2 bg-blue-600 rounded-lg">
                                    <Package className="w-5 h-5 text-white" />
                                  </div>
                                  <div>
                                    <p className="font-semibold text-gray-900">Shadow Stock → Live Stock</p>
                                    <p className="text-xs text-gray-600">Verify received quantity and approve transfer</p>
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <div className="p-3 bg-white rounded-lg">
                                    <p className="text-xs text-gray-500 mb-1">Quantity</p>
                                    <p className="text-lg font-bold text-gray-900">{action.details.quantity} bottles</p>
                                  </div>
                                  <div className="p-3 bg-white rounded-lg">
                                    <p className="text-xs text-gray-500 mb-1">Cost</p>
                                    <p className="text-lg font-bold text-gray-900">${action.details.cost}</p>
                                  </div>
                                </div>
                              </div>
                              <p className="text-sm text-gray-600">
                                Supplier: <span className="font-medium">{action.details.supplier}</span> • Order: <span className="font-mono text-xs">{action.details.orderId}</span>
                              </p>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleApprove(action)}
                                  disabled={isProcessing}
                                  className="flex-1 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
                                >
                                  <Check className="w-5 h-5" />
                                  Approve & Move to Live Stock
                                </button>
                                <button
                                  onClick={() => handleReject(action)}
                                  disabled={isProcessing}
                                  className="px-4 py-3 bg-rose-100 text-rose-700 font-semibold rounded-xl hover:bg-rose-200 transition-colors"
                                  title="Report discrepancy"
                                >
                                  <AlertTriangle className="w-5 h-5" />
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Delivery Confirmation */}
                          {action.type === 'delivery_confirm' && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-3 gap-3">
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Expected</p>
                                  <p className="text-lg font-bold text-gray-900">{action.details.expectedQty} btls</p>
                                </div>
                                {/* Never `$` + a null: the route may not carry a total at all. */}
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Invoice Price</p>
                                  <p className="text-lg font-bold text-gray-900">
                                    {typeof action.details.invoicePrice === 'number'
                                      ? `$${action.details.invoicePrice}`
                                      : 'no total on this order'}
                                  </p>
                                </div>
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Negotiated</p>
                                  <p className="text-lg font-bold text-emerald-600">
                                    {typeof action.details.negotiatedPrice === 'number'
                                      ? `$${action.details.negotiatedPrice}`
                                      : 'nothing to negotiate from'}
                                  </p>
                                </div>
                              </div>
                              <p className="text-sm text-gray-600">
                                Supplier: <span className="font-medium">{action.details.supplier}</span>
                              </p>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleApprove(action)}
                                  disabled={isProcessing}
                                  className="flex-1 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2"
                                >
                                  <Truck className="w-5 h-5" />
                                  Confirm Received
                                </button>
                                <button
                                  onClick={() => handleReject(action)}
                                  disabled={isProcessing}
                                  className="px-6 py-3 bg-rose-100 text-rose-700 font-medium rounded-xl hover:bg-rose-200 transition-colors"
                                >
                                  Report Issue
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Price Change */}
                          {action.type === 'price_change' && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Your Price</p>
                                  <p className="text-xl font-bold text-gray-900">${action.details.originalPrice}</p>
                                </div>
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Counter Offer</p>
                                  <p className="text-xl font-bold text-amber-600">${action.details.counterPrice}</p>
                                  <p className="text-xs text-amber-500">+{action.details.deviation}% deviation</p>
                                </div>
                              </div>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleApprove(action)}
                                  disabled={isProcessing}
                                  className="flex-1 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
                                >
                                  Accept ${action.details.counterPrice}
                                </button>
                                <button
                                  onClick={() => handleReject(action)}
                                  disabled={isProcessing}
                                  className="px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Inequality Detection - ONE TAP CORRECTION */}
                          {action.type === 'inequality' && (
                            <div className="space-y-4">
                              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                                <p className="text-sm text-amber-800">
                                  <strong>Inequality Detected:</strong> Sales exceed recorded stock. 
                                  Did you make a manual purchase?
                                </p>
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">DB Stock</p>
                                  <p className="text-xl font-bold text-gray-900">{action.details.dbStock}</p>
                                </div>
                                <div className="p-3 bg-white rounded-xl">
                                  <p className="text-xs text-gray-500 mb-1">Sales Count</p>
                                  <p className="text-xl font-bold text-gray-900">{action.details.salesCount}</p>
                                </div>
                              </div>
                              
                              {/* ONE-TAP CORRECTION BUTTONS */}
                              <div className="space-y-2">
                                <p className="text-sm font-medium text-gray-700">Quick Correction:</p>
                                <div className="grid grid-cols-2 gap-3">
                                  <button
                                    onClick={() => handleStockCorrection(action, 6)}
                                    className="py-3 bg-blue-100 text-blue-700 font-semibold rounded-xl hover:bg-blue-200 transition-colors flex items-center justify-center gap-2"
                                  >
                                    <Plus className="w-5 h-5" />
                                    +6 bottles
                                  </button>
                                  <button
                                    onClick={() => handleStockCorrection(action, 12)}
                                    className="py-3 bg-blue-100 text-blue-700 font-semibold rounded-xl hover:bg-blue-200 transition-colors flex items-center justify-center gap-2"
                                  >
                                    <Plus className="w-5 h-5" />
                                    +1 case (12)
                                  </button>
                                </div>
                                <button
                                  onClick={() => handleReject(action)}
                                  className="w-full py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors"
                                >
                                  Investigate Later
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Vintage Substitution */}
                          {action.type === 'vintage_sub' && (
                            <div className="space-y-4">
                              <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 bg-white rounded-xl border-2 border-dashed border-gray-200">
                                  <p className="text-xs text-gray-500 mb-1">Requested</p>
                                  <p className="text-xl font-bold text-gray-400 line-through">{action.details.requestedVintage}</p>
                                  <p className="text-xs text-rose-500">Unavailable</p>
                                </div>
                                <div className="p-3 bg-emerald-50 rounded-xl border-2 border-emerald-200">
                                  <p className="text-xs text-emerald-600 mb-1">Offered</p>
                                  <p className="text-xl font-bold text-emerald-700">{action.details.offeredVintage}</p>
                                  <p className="text-xs text-emerald-600">${action.details.priceChange} price diff</p>
                                </div>
                              </div>
                              <div className="flex gap-3">
                                <button
                                  onClick={() => handleApprove(action)}
                                  disabled={isProcessing}
                                  className="flex-1 py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
                                >
                                  Accept {action.details.offeredVintage}
                                </button>
                                <button
                                  onClick={() => handleReject(action)}
                                  disabled={isProcessing}
                                  className="px-6 py-3 bg-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-300 transition-colors"
                                >
                                  Decline
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Gmail Send Action */}
                          {action.type === 'gmail_send' && (
                            <div className="space-y-4">
                              <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                                <div className="flex items-center gap-3 mb-3">
                                  <Mail className="w-6 h-6 text-blue-600" />
                                  <div>
                                    <p className="font-semibold text-gray-900">Quick Email Access</p>
                                    <p className="text-sm text-gray-600">Send reports, alerts, or updates using saved templates</p>
                                  </div>
                                </div>
                              </div>
                              <button
                                onClick={() => handleGmailAction(action)}
                                className="w-full py-3 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 transition-colors flex items-center justify-center gap-2"
                              >
                                <Send className="w-5 h-5" />
                                Open Gmail Composer
                              </button>
                            </div>
                          )}

                          {/* Gmail Contextual Action */}
                          {action.type === 'gmail_contextual' && (
                            <div className="space-y-4">
                              <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                  <div>
                                    <p className="text-xs text-amber-700 mb-1">To</p>
                                    <p className="text-sm font-semibold text-gray-900">{action.details.recipient}</p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-amber-700 mb-1">Subject</p>
                                    <p className="text-sm font-semibold text-gray-900">{action.details.subject}</p>
                                  </div>
                                </div>
                                {action.details.prefilledData && (
                                  <div className="pt-3 border-t border-amber-200 space-y-1">
                                    <p className="text-xs text-amber-700 font-medium">Pre-filled Data:</p>
                                    {Object.entries(action.details.prefilledData).map(([key, value]) => (
                                      <p key={key} className="text-xs text-gray-600">
                                        <span className="font-medium">{key}:</span> {String(value)}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button
                                onClick={() => handleGmailAction(action)}
                                className="w-full py-3 bg-wine-600 text-white font-semibold rounded-xl hover:bg-wine-700 transition-colors flex items-center justify-center gap-2"
                              >
                                <Send className="w-5 h-5" />
                                Review & Send Email
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )
            })
          )}
        </AnimatePresence>
      </div>

      {/* Gmail Modal */}
      {showGmailModal && (
        <QuickGmailModal
          onClose={() => {
            setShowGmailModal(false)
            setGmailRecipient('')
            setGmailSubject('')
          }}
          prefilledRecipient={gmailRecipient}
          prefilledSubject={gmailSubject}
        />
      )}

      {actionMenu.open && actionMenu.menu && actionMenu.target && (
        <ContextMenu
          x={actionMenu.menu.x}
          y={actionMenu.menu.y}
          onClose={actionMenu.close}
          items={[
            {
              id: 'approve',
              label: 'Approve',
              icon: Check,
              onClick: () => {
                void handleApprove(actionMenu.target!)
              },
            },
            {
              id: 'reject',
              label: 'Reject / Dismiss',
              icon: X,
              danger: true,
              onClick: () => {
                void handleReject(actionMenu.target!)
              },
            },
            {
              id: 'snooze',
              label: 'Snooze until tomorrow',
              icon: Moon,
              onClick: () => {
                snoozeActionUntilTomorrow(actionMenu.target!.id)
                setSnoozedIds(loadSnoozedIds())
                toast.success('Snoozed until tomorrow')
              },
            },
            {
              id: 'copy',
              label: 'Copy summary',
              icon: Copy,
              onClick: () => {
                const t = actionMenu.target!
                void navigator.clipboard?.writeText(`${t.title} — ${t.subtitle}`)
                toast.success('Copied')
              },
            },
            {
              id: 'open',
              label: 'Open related page',
              icon: ExternalLink,
              dividerBefore: true,
              onClick: () => navigate(openRouteForAction(actionMenu.target!)),
            },
          ]}
        />
      )}
    </div>
  )
}

