import {
  BarChart3,
  Calendar,
  Package,
  ShoppingCart,
  Wine,
  Zap,
  Truck,
  Users,
  Bell,
  type LucideIcon,
} from 'lucide-react'

export type BuiltinQuickActionKey =
  | 'new_order'
  | 'add_wine'
  | 'stock_check'
  | 'reports'
  | 'add_calendar'

export interface BuiltinQuickActionDef {
  key: BuiltinQuickActionKey
  label: string
  href: string
  icon: LucideIcon
}

export interface CustomQuickAction {
  id: string
  kind: 'custom'
  title: string
  href: string
  icon: string
  color?: string
  description?: string
}

export type ResolvedQuickAction =
  | {
      id: string
      kind: 'builtin'
      builtinKey: BuiltinQuickActionKey
      label: string
      href: string
      icon: LucideIcon
    }
  | {
      id: string
      kind: 'custom'
      label: string
      href: string
      icon: LucideIcon
      iconName: string
      color?: string
      description?: string
    }

export interface QuickActionsState {
  order: string[]
  hiddenBuiltin: string[]
  custom: CustomQuickAction[]
}

export const QUICK_ACTIONS_STORAGE_KEY = 'wineops.dashboard.quick_actions'
export const MAX_CUSTOM_QUICK_ACTIONS = 8

export const BUILTIN_QUICK_ACTIONS: BuiltinQuickActionDef[] = [
  { key: 'new_order', label: 'New Order', href: '/orders', icon: ShoppingCart },
  { key: 'add_wine', label: 'Add Wine', href: '/wines', icon: Wine },
  { key: 'stock_check', label: 'Stock Check', href: '/inventory', icon: Package },
  { key: 'reports', label: 'Reports', href: '/reports', icon: BarChart3 },
  {
    key: 'add_calendar',
    label: 'Add to Calendar',
    href: '/calendar?openModal=true&date=today',
    icon: Calendar,
  },
]

export const QUICK_ACTION_ICON_MAP: Record<string, LucideIcon> = {
  ShoppingCart,
  Wine,
  Package,
  BarChart3,
  Calendar,
  Truck,
  Users,
  Bell,
  Zap,
}

export const QUICK_ACTION_ICON_OPTIONS = Object.keys(QUICK_ACTION_ICON_MAP)

const DEFAULT_ORDER = BUILTIN_QUICK_ACTIONS.map((b) => `builtin:${b.key}`)

export function createDefaultQuickActionsState(): QuickActionsState {
  return {
    order: [...DEFAULT_ORDER],
    hiddenBuiltin: [],
    custom: [],
  }
}

export function loadQuickActionsState(): QuickActionsState {
  if (typeof window === 'undefined') return createDefaultQuickActionsState()
  try {
    const raw = localStorage.getItem(QUICK_ACTIONS_STORAGE_KEY)
    if (!raw) return createDefaultQuickActionsState()
    const parsed = JSON.parse(raw) as Partial<QuickActionsState>
    const base = createDefaultQuickActionsState()
    return {
      order: Array.isArray(parsed.order) && parsed.order.length > 0 ? parsed.order : base.order,
      hiddenBuiltin: Array.isArray(parsed.hiddenBuiltin) ? parsed.hiddenBuiltin : [],
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    }
  } catch {
    return createDefaultQuickActionsState()
  }
}

export function saveQuickActionsState(state: QuickActionsState): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(QUICK_ACTIONS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export function resolveQuickActions(state: QuickActionsState): ResolvedQuickAction[] {
  const customById = new Map(state.custom.map((c) => [c.id, c]))
  const resolved: ResolvedQuickAction[] = []

  for (const id of state.order) {
    if (id.startsWith('builtin:')) {
      const key = id.replace('builtin:', '') as BuiltinQuickActionKey
      if (state.hiddenBuiltin.includes(key)) continue
      const def = BUILTIN_QUICK_ACTIONS.find((b) => b.key === key)
      if (!def) continue
      resolved.push({
        id,
        kind: 'builtin',
        builtinKey: def.key,
        label: def.label,
        href: def.href,
        icon: def.icon,
      })
      continue
    }
    const custom = customById.get(id)
    if (!custom) continue
    const Icon = QUICK_ACTION_ICON_MAP[custom.icon] ?? Zap
    resolved.push({
      id: custom.id,
      kind: 'custom',
      label: custom.title,
      href: custom.href,
      icon: Icon,
      iconName: custom.icon,
      color: custom.color,
      description: custom.description,
    })
  }

  return resolved
}

export function isValidQuickActionHref(href: string): boolean {
  return href.startsWith('/') || href.startsWith('https://') || href.startsWith('http://')
}
