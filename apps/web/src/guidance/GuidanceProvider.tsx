import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import { useUserPreferences } from '../hooks/useUserPreferences'
import {
  DEFAULT_GUIDANCE_STATE,
  ROUTE_TO_PAGE_TOUR,
  type GuidanceState,
  type PageGuidanceState,
  type PageTourId,
} from './types'
import { useTourEngine } from './tours/TourEngine'
import { trackGuidance } from './analytics'

interface GuidanceContextValue {
  state: GuidanceState
  tipVisibleFor: PageTourId | null
  tipOffsetFab: boolean
  isTourRunning: boolean
  startTour: (pageId: PageTourId) => void
  snoozeTip: (pageId: PageTourId) => void
  dismissTip: (pageId: PageTourId) => void
  completeTipViaTour: (pageId: PageTourId) => void
  hideAllTips: () => void
  resetTips: () => void
  setShowWineAgentFab: (show: boolean) => void
  markUseCardSeen: (cardId: string) => void
  resolvePageId: (pathname: string) => PageTourId | null
}

const GuidanceContext = createContext<GuidanceContextValue | null>(null)

const SESSION_KEY = 'wineops_guidance_session'

type SessionFatigue = {
  offers: number
  skips: number
  offeredPageId?: PageTourId
}

function readSession(): SessionFatigue {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return { offers: 0, skips: 0 }
    return JSON.parse(raw) as SessionFatigue
  } catch {
    return { offers: 0, skips: 0 }
  }
}

function writeSession(s: SessionFatigue) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

function mergeGuidance(raw: unknown): GuidanceState {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Partial<GuidanceState>
  return {
    global: { ...DEFAULT_GUIDANCE_STATE.global, ...g.global },
    pages: { ...DEFAULT_GUIDANCE_STATE.pages, ...g.pages },
    guide: {
      use_cards_seen: g.guide?.use_cards_seen ?? [],
    },
  }
}

function defaultPageState(): PageGuidanceState {
  return { tip: 'unseen', tour: 'unseen' }
}

export function GuidanceProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { preferences, updatePreferences } = useUserPreferences()
  const state = useMemo(
    () => mergeGuidance(preferences.guidance),
    [preferences.guidance],
  )
  const [tourRunning, setTourRunning] = useState(false)
  const sessionRef = useRef(readSession())
  const [sessionTick, setSessionTick] = useState(0)

  const persist = useCallback(
    (next: GuidanceState) => {
      updatePreferences({ guidance: next })
    },
    [updatePreferences],
  )

  const patchPage = useCallback(
    (pageId: PageTourId, patch: Partial<PageGuidanceState>) => {
      const prev = state.pages[pageId] ?? defaultPageState()
      persist({
        ...state,
        pages: {
          ...state.pages,
          [pageId]: { ...prev, ...patch },
        },
      })
    },
    [persist, state],
  )

  const tourHandlers = useMemo(
    () => ({
      onCompleted: (pageId: PageTourId) => {
        setTourRunning(false)
        patchPage(pageId, { tip: 'completed', tour: 'completed' })
      },
      onSkipped: (pageId: PageTourId) => {
        setTourRunning(false)
        sessionRef.current.skips += 1
        writeSession(sessionRef.current)
        patchPage(pageId, { tour: 'skipped' })
      },
    }),
    [patchPage],
  )

  const { startTour: engineStart, stopTour } = useTourEngine(tourHandlers)

  const startTour = useCallback(
    (pageId: PageTourId) => {
      setTourRunning(true)
      patchPage(pageId, { tip: 'completed', tour: 'in_progress' })
      void engineStart(pageId)
    },
    [engineStart, patchPage],
  )

  const resolvePageId = useCallback((pathname: string): PageTourId | null => {
    return ROUTE_TO_PAGE_TOUR[pathname] ?? null
  }, [])

  const tipVisibleFor = useMemo((): PageTourId | null => {
    if (state.global.hide_all_tips) return null
    if (tourRunning) return null

    const snoozedUntil = state.global.tips_snoozed_until
    if (snoozedUntil && new Date(snoozedUntil).getTime() > Date.now()) return null

    if (sessionRef.current.skips >= 2) return null

    const pageId = ROUTE_TO_PAGE_TOUR[location.pathname]
    if (!pageId) return null

    const page = state.pages[pageId] ?? defaultPageState()
    if (page.tip !== 'unseen') return null
    if (page.snooze_until && new Date(page.snooze_until).getTime() > Date.now()) {
      return null
    }

    // At most one auto tip page per session
    if (
      sessionRef.current.offers >= 1 &&
      sessionRef.current.offeredPageId &&
      sessionRef.current.offeredPageId !== pageId
    ) {
      return null
    }

    return pageId
    // sessionTick forces recompute after skip/offer mutations
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, tourRunning, location.pathname, sessionTick])

  useEffect(() => {
    if (!tipVisibleFor) return
    const s = readSession()
    if (s.offers < 1 || s.offeredPageId !== tipVisibleFor) {
      s.offers = 1
      s.offeredPageId = tipVisibleFor
      writeSession(s)
      sessionRef.current = s
      trackGuidance('tip_shown', { pageId: tipVisibleFor })
      setSessionTick((n) => n + 1)
    }
  }, [tipVisibleFor])

  const snoozeTip = useCallback(
    (pageId: PageTourId) => {
      sessionRef.current.skips += 1
      writeSession(sessionRef.current)
      setSessionTick((n) => n + 1)
      trackGuidance('tip_snoozed', { pageId })
      const until = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
      patchPage(pageId, { tip: 'snoozed', snooze_until: until })
    },
    [patchPage],
  )

  const dismissTip = useCallback(
    (pageId: PageTourId) => {
      sessionRef.current.skips += 1
      writeSession(sessionRef.current)
      setSessionTick((n) => n + 1)
      trackGuidance('tip_dismissed', { pageId })
      patchPage(pageId, { tip: 'dismissed' })
    },
    [patchPage],
  )

  const completeTipViaTour = useCallback(
    (pageId: PageTourId) => {
      trackGuidance('tip_take_tour', { pageId })
      startTour(pageId)
    },
    [startTour],
  )

  const hideAllTips = useCallback(() => {
    persist({
      ...state,
      global: { ...state.global, hide_all_tips: true },
    })
  }, [persist, state])

  const resetTips = useCallback(() => {
    const pages = { ...state.pages }
    for (const key of Object.keys(pages) as PageTourId[]) {
      pages[key] = { tip: 'unseen', tour: pages[key]?.tour ?? 'unseen' }
    }
    sessionRef.current = { offers: 0, skips: 0, offeredPageId: undefined }
    writeSession(sessionRef.current)
    setSessionTick((n) => n + 1)
    persist({
      ...state,
      global: {
        ...state.global,
        hide_all_tips: false,
        tips_snoozed_until: undefined,
      },
      pages,
    })
  }, [persist, state])

  const setShowWineAgentFab = useCallback(
    (show: boolean) => {
      persist({
        ...state,
        global: {
          ...state.global,
          show_wine_agent_fab: show,
          // Unlock when user explicitly enables from Learn
          wine_agent_fab_unlocked: show
            ? true
            : state.global.wine_agent_fab_unlocked,
        },
      })
    },
    [persist, state],
  )

  const markUseCardSeen = useCallback(
    (cardId: string) => {
      if (state.guide.use_cards_seen.includes(cardId)) return
      trackGuidance('guide_card_clicked', { cardId })
      persist({
        ...state,
        guide: {
          use_cards_seen: [...state.guide.use_cards_seen, cardId],
        },
      })
    },
    [persist, state],
  )

  const value: GuidanceContextValue = {
    state,
    tipVisibleFor,
    tipOffsetFab: !!tipVisibleFor,
    isTourRunning: tourRunning,
    startTour,
    snoozeTip,
    dismissTip,
    completeTipViaTour,
    hideAllTips,
    resetTips,
    setShowWineAgentFab,
    markUseCardSeen,
    resolvePageId,
  }

  // stopTour available for unmount scenarios
  void stopTour

  return (
    <GuidanceContext.Provider value={value}>{children}</GuidanceContext.Provider>
  )
}

export function useGuidance() {
  const ctx = useContext(GuidanceContext)
  if (!ctx) {
    throw new Error('useGuidance must be used within GuidanceProvider')
  }
  return ctx
}

/** Safe variant for components that may render outside the provider. */
export function useGuidanceOptional() {
  return useContext(GuidanceContext)
}
