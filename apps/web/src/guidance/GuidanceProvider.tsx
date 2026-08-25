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
  DEFAULT_SETUP_NUDGE,
  isSetupNudgeDue,
  resolveGuidancePageId,
  type GuidanceState,
  type PageGuidanceState,
  type PageTourId,
  type SetupNudgeState,
} from './types'
import { useTourEngine } from './tours/TourEngine'
import { trackGuidance } from './analytics'
import { announceGuidance, focusTourHelpButton } from './announce'
import { TIP_REGISTRY } from './tours/registry'

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
  resolvePageId: (pathname: string, search?: string) => PageTourId | null
  /** Finish-setup nudge banner — see `isSetupNudgeDue` for the escalating-backoff cadence. */
  isSetupNudgeDue: boolean
  setupNudgeDismissedThisSession: boolean
  markSetupNudgeShown: () => void
  snoozeSetupNudge: () => void
  dismissSetupNudgeForever: () => void
}

const GuidanceContext = createContext<GuidanceContextValue | null>(null)

const SESSION_KEY = 'wineops_guidance_session'

type SessionFatigue = {
  /** Pages whose first-visit tip has already been surfaced this session (dedupes analytics). */
  offeredPageIds: PageTourId[]
  /** Snoozes/dismissals this session — a genuine "stop nagging me" signal, unlike first-visit offers. */
  skips: number
}

function readSession(): SessionFatigue {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return { offeredPageIds: [], skips: 0 }
    const parsed = JSON.parse(raw) as Partial<SessionFatigue> & { offeredPageId?: PageTourId }
    // Back-compat with the previous single-page shape.
    const offeredPageIds =
      parsed.offeredPageIds ?? (parsed.offeredPageId ? [parsed.offeredPageId] : [])
    return { offeredPageIds, skips: parsed.skips ?? 0 }
  } catch {
    return { offeredPageIds: [], skips: 0 }
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
    setup_nudge: { ...DEFAULT_SETUP_NUDGE, ...g.setup_nudge },
  }
}

const NUDGE_SESSION_KEY = 'wineops_nudge_session'

/** True once the user has explicitly dismissed the nudge banner this session (X or "Later"). */
function readNudgeSessionDismissed(): boolean {
  try {
    return sessionStorage.getItem(NUDGE_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function writeNudgeSessionDismissed(dismissed: boolean) {
  try {
    if (dismissed) sessionStorage.setItem(NUDGE_SESSION_KEY, '1')
    else sessionStorage.removeItem(NUDGE_SESSION_KEY)
  } catch {
    // ignore
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
  const [nudgeDismissedThisSession, setNudgeDismissedThisSession] = useState(
    readNudgeSessionDismissed,
  )

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
      // Tip strip unmounts when tourRunning flips — move focus before detach.
      focusTourHelpButton()
      setTourRunning(true)
      patchPage(pageId, { tip: 'completed', tour: 'in_progress' })
      void engineStart(pageId)
    },
    [engineStart, patchPage],
  )

  const resolvePageId = useCallback(
    (pathname: string, search?: string): PageTourId | null =>
      resolveGuidancePageId(pathname, search ?? location.search),
    [location.search],
  )

  const tipVisibleFor = useMemo((): PageTourId | null => {
    if (state.global.hide_all_tips) return null
    if (tourRunning) return null

    const snoozedUntil = state.global.tips_snoozed_until
    if (snoozedUntil && new Date(snoozedUntil).getTime() > Date.now()) return null

    // A genuine first-visit tutorial should show on every unseen page, so this
    // fatigue guard only kicks in once the user has actively snoozed/dismissed
    // a couple of tips this session — it does not cap the *number of distinct
    // pages* offered, only repeat nagging after explicit rejection.
    if (sessionRef.current.skips >= 2) return null

    const pageId = resolveGuidancePageId(location.pathname, location.search)
    if (!pageId) return null

    const page = state.pages[pageId] ?? defaultPageState()
    if (page.tip !== 'unseen') return null
    if (page.snooze_until && new Date(page.snooze_until).getTime() > Date.now()) {
      return null
    }

    return pageId
    // sessionTick forces recompute after skip/offer mutations
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, tourRunning, location.pathname, location.search, sessionTick])

  useEffect(() => {
    if (!tipVisibleFor) return
    const s = readSession()
    if (!s.offeredPageIds.includes(tipVisibleFor)) {
      s.offeredPageIds = [...s.offeredPageIds, tipVisibleFor]
      writeSession(s)
      sessionRef.current = s
      trackGuidance('tip_shown', { pageId: tipVisibleFor })
      const tip = TIP_REGISTRY[tipVisibleFor]
      if (tip) {
        announceGuidance(`Page tip: ${tip.title}. ${tip.body}`)
      }
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
    sessionRef.current = { offeredPageIds: [], skips: 0 }
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

  const patchSetupNudge = useCallback(
    (patch: Partial<SetupNudgeState>) => {
      persist({
        ...state,
        setup_nudge: { ...state.setup_nudge, ...patch },
      })
    },
    [persist, state],
  )

  // Fires once per render pass when the banner actually becomes visible —
  // callers gate this behind their own visibility check (role, route,
  // activation status) since GuidanceProvider doesn't know those.
  const markSetupNudgeShown = useCallback(() => {
    trackGuidance('tip_shown', { pageId: 'setup-nudge' })
    patchSetupNudge({
      last_shown_at: new Date().toISOString(),
      session_count: state.setup_nudge.session_count + 1,
    })
  }, [patchSetupNudge, state.setup_nudge.session_count])

  const snoozeSetupNudge = useCallback(() => {
    writeNudgeSessionDismissed(true)
    setNudgeDismissedThisSession(true)
    trackGuidance('tip_snoozed', { pageId: 'setup-nudge' })
    patchSetupNudge({ snooze_count: state.setup_nudge.snooze_count + 1 })
  }, [patchSetupNudge, state.setup_nudge.snooze_count])

  const dismissSetupNudgeForever = useCallback(() => {
    writeNudgeSessionDismissed(true)
    setNudgeDismissedThisSession(true)
    trackGuidance('tip_dismissed', { pageId: 'setup-nudge' })
    patchSetupNudge({ dismissed_forever: true })
  }, [patchSetupNudge])

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
    isSetupNudgeDue: isSetupNudgeDue(state.setup_nudge),
    setupNudgeDismissedThisSession: nudgeDismissedThisSession,
    markSetupNudgeShown,
    snoozeSetupNudge,
    dismissSetupNudgeForever,
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
