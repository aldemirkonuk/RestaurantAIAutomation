export type PageTourId = 'dashboard' | 'inventory' | 'orders' | 'providers'

export type TipStatus = 'unseen' | 'snoozed' | 'dismissed' | 'completed'
export type TourStatus = 'unseen' | 'in_progress' | 'completed' | 'skipped'

export interface PageGuidanceState {
  tip: TipStatus
  tour: TourStatus
  snooze_until?: string
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
}

export const PAGE_TOUR_IDS: PageTourId[] = [
  'dashboard',
  'inventory',
  'orders',
  'providers',
]

export const ROUTE_TO_PAGE_TOUR: Record<string, PageTourId> = {
  '/': 'dashboard',
  '/inventory': 'inventory',
  '/orders': 'orders',
  '/providers': 'providers',
}
