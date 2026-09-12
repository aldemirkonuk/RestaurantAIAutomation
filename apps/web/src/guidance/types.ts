export type PageTourId =
  | 'dashboard'
  | 'inventory'
  | 'orders'
  | 'providers'
  | 'orders-create'
  | 'communications'
  | 'reports'
  | 'sommelier'
  | 'settings-services'
  | 'calendar'

export type TipStatus = 'unseen' | 'snoozed' | 'dismissed' | 'completed'
export type TourStatus = 'unseen' | 'in_progress' | 'completed' | 'skipped'

export interface PageGuidanceState {
  tip: TipStatus
  tour: TourStatus
  snooze_until?: string
}

/**
 * Finish-setup nudge cadence state — persisted under
 * `user_preferences.preferences.guidance.setup_nudge`, so it follows the
 * user across devices (no new table). See `isSetupNudgeDue` for cadence.
 */
export interface SetupNudgeState {
  last_shown_at?: string
  session_count: number
  snooze_count: number
  dismissed_forever: boolean
}

export const DEFAULT_SETUP_NUDGE: SetupNudgeState = {
  session_count: 0,
  snooze_count: 0,
  dismissed_forever: false,
}

export interface GuidanceState {
  global: {
    hide_all_tips: boolean
    tips_snoozed_until?: string
    /** Preference: render FAB when unlocked/activated */
    show_wine_agent_fab: boolean
    /** Explicit unlock from Learn (invitees / skip-import) */
    wine_agent_fab_unlocked?: boolean
  }
  pages: Partial<Record<PageTourId, PageGuidanceState>>
  guide: {
    use_cards_seen: string[]
  }
  setup_nudge: SetupNudgeState
}

export const DEFAULT_GUIDANCE_STATE: GuidanceState = {
  global: {
    hide_all_tips: false,
    show_wine_agent_fab: true,
  },
  pages: {},
  guide: {
    use_cards_seen: [],
  },
  setup_nudge: DEFAULT_SETUP_NUDGE,
}

/**
 * Escalating backoff: every session for the first 3 offers, then at most
 * every 3 days for the next few, then at most weekly. Session-level "only
 * once per login" is enforced separately via sessionStorage in
 * GuidanceProvider — this only governs the multi-day cadence.
 */
export function isSetupNudgeDue(nudge: SetupNudgeState, now: number = Date.now()): boolean {
  if (nudge.dismissed_forever) return false
  if (!nudge.last_shown_at) return true

  // "Later" clicks earn escalating quiet periods (1d → 3d → 7d).
  const laterBackoffDays =
    nudge.snooze_count <= 0 ? 0 : nudge.snooze_count === 1 ? 1 : nudge.snooze_count === 2 ? 3 : 7

  // Passive cadence after repeated sessions without finishing setup.
  const cadenceDays = nudge.session_count < 3 ? 0 : nudge.session_count < 6 ? 3 : 7

  const intervalDays = Math.max(laterBackoffDays, cadenceDays)
  if (intervalDays === 0) return true

  const elapsedMs = now - new Date(nudge.last_shown_at).getTime()
  return elapsedMs >= intervalDays * 24 * 60 * 60 * 1000
}

export const PAGE_TOUR_IDS: PageTourId[] = [
  'dashboard',
  'inventory',
  'orders',
  'providers',
  'orders-create',
  'communications',
  'reports',
  'sommelier',
  'settings-services',
  'calendar',
]

/**
 * Routes that map 1:1 to a page tour via exact pathname match.
 * `settings-services` (query-param tab) and `orders-create` (in-page modal,
 * no dedicated route) are resolved separately — see `resolveGuidancePageId`.
 */
export const ROUTE_TO_PAGE_TOUR: Record<string, PageTourId> = {
  '/': 'dashboard',
  '/inventory': 'inventory',
  '/orders': 'orders',
  '/providers': 'providers',
  '/communications': 'communications',
  '/reports': 'reports',
  '/sommelier': 'sommelier',
  '/calendar': 'calendar',
}

/**
 * Canonical navigable URL for each tour, used by the Learn panel to jump to
 * the right page before replaying a tour. `orders-create` is intentionally
 * omitted — it's a modal on `/orders`, not an independently navigable page,
 * so it's only ever started from inside Orders.tsx on first open.
 */
export const PAGE_TOUR_ROUTES: Partial<Record<PageTourId, string>> = {
  dashboard: '/',
  inventory: '/inventory',
  orders: '/orders',
  providers: '/providers',
  communications: '/communications',
  reports: '/reports',
  sommelier: '/sommelier',
  calendar: '/calendar',
  'settings-services': '/settings?tab=services',
}

/**
 * Resolves the active page tour id from a full location (pathname + search).
 * Exists alongside `ROUTE_TO_PAGE_TOUR` because a couple of tours key off a
 * query param on a shared route (`/settings?tab=services`) rather than a
 * unique pathname — plain pathname lookup can't distinguish those.
 */
export function resolveGuidancePageId(
  pathname: string,
  search?: string,
): PageTourId | null {
  if (pathname === '/settings') {
    const tab = new URLSearchParams(search ?? '').get('tab')
    return tab === 'services' ? 'settings-services' : null
  }
  return ROUTE_TO_PAGE_TOUR[pathname] ?? null
}
