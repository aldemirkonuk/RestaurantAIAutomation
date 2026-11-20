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
import { useQueryClient } from '@tanstack/react-query'
import { useUserPreferences, type UserPreferences } from '../hooks/useUserPreferences'
import { useAuthStore } from '../stores'
import { queryKeys } from '../lib/query-keys'
import {
  DEFAULT_GUIDANCE_STATE,
  DEFAULT_SETUP_NUDGE,
  PAGE_TOUR_IDS,
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

/**
 * Where the signed-in person's account copy of guidance stands, read from the
 * preferences query. `'read'` once a read of it has succeeded, and still
 * `'read'` if a later refetch fails (the last good copy is kept). Before any
 * read has succeeded: `'failed'` when the last one failed, `'loading'`
 * otherwise (one under way, waiting for a connection, or held back until a
 * preferences save settles). Signed out, it is `'read'`: there is no account
 * copy to wait for.
 */
export type AccountCopy = 'loading' | 'failed' | 'read'

interface GuidanceContextValue {
  state: GuidanceState
  /**
   * Until this is `'read'`, no read of the account's copy has succeeded and
   * `state` is this browser's copy over an empty stand-in. Then no tip
   * shows, the setup nudge is not due, and `persistGuidance` drops every
   * guidance save, here and to the account. Help's "Page tips" card reads it
   * to hold its on/off and button.
   */
  accountCopy: AccountCopy
  /**
   * Two tips or tours turned away in this tab (`snoozeTip`, `dismissTip`, a
   * tour's `onSkipped`) stop tips in this tab until it is closed or
   * `resetTips` runs. Help's "Page tips" card reads it to say so and offer
   * "Turn tips back on".
   */
  tipsPausedInThisTab: boolean
  tipVisibleFor: PageTourId | null
  isTourRunning: boolean
  startTour: (pageId: PageTourId) => void
  snoozeTip: (pageId: PageTourId) => void
  dismissTip: (pageId: PageTourId) => void
  completeTipViaTour: (pageId: PageTourId) => void
  hideAllTips: () => void
  resetTips: () => void
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
const LOCAL_GUIDANCE_KEY = 'wineops_guidance_v1'

/**
 * What one guidance save sets: the keys that one action changed, and nothing
 * read from a copy that may be stale. The gateway deep-merges a save into
 * what it holds, so every key a save leaves out keeps the value the latest
 * save of it set, from any device. A `null` takes a snooze away.
 */
type GuidanceSave = {
  global?: Partial<GuidanceState['global']>
  pages?: Partial<Record<PageTourId, Partial<PageGuidanceState>>>
  guide?: GuidanceState['guide']
  setup_nudge?: Partial<SetupNudgeState>
}

/**
 * This browser's own copy: the saves made here, merged, stamped with the
 * latest one's time. It keeps an unsent save's effect here only until this
 * copy starts again (`persist`), and it is all there is when no one is signed in.
 */
type LocalGuidance = Omit<GuidanceSave, 'guide'> & { saved_at?: string }

function readLocalGuidance(): LocalGuidance | null {
  try {
    const raw = localStorage.getItem(LOCAL_GUIDANCE_KEY)
    return raw ? (JSON.parse(raw) as LocalGuidance) : null
  } catch {
    return null
  }
}

function writeLocalGuidance(copy: LocalGuidance) {
  try {
    localStorage.setItem(
      LOCAL_GUIDANCE_KEY,
      JSON.stringify({
        global: copy.global,
        pages: copy.pages,
        setup_nudge: copy.setup_nudge,
        saved_at: copy.saved_at,
      }),
    )
  } catch {
    // ignore quota / private mode
  }
}

/** `save` laid over `copy` the way the gateway merges it, page by page. */
function addSave(copy: LocalGuidance, save: GuidanceSave, saved_at: string): LocalGuidance {
  const pages = { ...copy.pages }
  for (const [id, page] of Object.entries(save.pages ?? {}) as [PageTourId, Partial<PageGuidanceState>][]) {
    pages[id] = { ...pages[id], ...page }
  }
  return {
    global: { ...copy.global, ...save.global },
    pages,
    setup_nudge: { ...copy.setup_nudge, ...save.setup_nudge },
    saved_at,
  }
}

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

function savedAt(copy: { saved_at?: unknown } | null | undefined): number | null {
  const t = typeof copy?.saved_at === 'string' ? Date.parse(copy.saved_at) : NaN
  return Number.isFinite(t) ? t : null
}

/**
 * True when the account's copy carries a readable stamp and this browser's
 * copy carries none or an earlier one, or with `orTie`, the same one.
 */
function accountIsLater(
  account: { saved_at?: unknown } | undefined,
  local: LocalGuidance,
  orTie = false,
): boolean {
  const accountAt = savedAt(account)
  const localAt = savedAt(local)
  if (accountAt === null) return false
  return localAt === null || accountAt > localAt || (orTie && accountAt === localAt)
}

/**
 * The account's copy (`raw`) and this browser's own copy, made into one.
 *
 * The account's copy stands alone when this browser holds no readable copy,
 * or when the account's stamp is readable and this browser's is not, or is
 * earlier: "Turn tips back on" saved later elsewhere is not undone by an
 * older "Don't show tips again" kept here. Otherwise (this browser's copy is
 * later, ties, or the account's carries no readable stamp) this browser's
 * `global`, `pages` and `setup_nudge` are laid over the account's, key by key
 * and page by page, so a save that has not reached the account keeps its
 * effect here until this copy starts again (`persist`). A copy `persist` writes
 * holds only saves made here, so on a tie (normally this browser's own
 * latest save, read back from the account) it lays over the account's copy
 * only what was set in this browser. The phone app sets no time, so a save
 * made there does not by itself win over this copy.
 */
function mergeGuidance(raw: unknown): GuidanceState {
  const g = (raw && typeof raw === 'object' ? raw : {}) as Partial<GuidanceState>
  const kept = readLocalGuidance()
  const local = kept && !accountIsLater(g, kept) ? kept : null
  // A save names only the page keys it changed, so a page can arrive with
  // some of its keys; the rest read as never seen.
  const pages: GuidanceState['pages'] = {}
  const ids = new Set([...Object.keys(g.pages ?? {}), ...Object.keys(local?.pages ?? {})])
  for (const id of ids as Set<PageTourId>) {
    pages[id] = { ...defaultPageState(), ...g.pages?.[id], ...local?.pages?.[id] }
  }
  return {
    global: { ...DEFAULT_GUIDANCE_STATE.global, ...g.global, ...local?.global },
    pages,
    guide: {
      use_cards_seen: g.guide?.use_cards_seen ?? [],
    },
    setup_nudge: { ...DEFAULT_SETUP_NUDGE, ...g.setup_nudge, ...local?.setup_nudge },
    saved_at: local?.saved_at ?? g.saved_at,
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
  const queryClient = useQueryClient()
  const userId = useAuthStore((s) => s.user?.userId) ?? null
  const { preferences, isAccountRead, error, updatePreferences } = useUserPreferences()
  // Signed in, and no read of the account's copy has succeeded yet (the first
  // is loading, or it failed): `preferences` is an empty stand-in, the
  // placeholder or `{}`, so this browser would decide from its own copy
  // alone and could flash a tip the person turned off in another browser.
  // Tips wait, the setup nudge waits (showing it saves), and no save is made:
  // one built from the stand-in, setup-nudge counts included, would be
  // deep-merged over the account's copy. Once a read has succeeded, a failed
  // refetch changes nothing here: TanStack keeps that copy beside the error,
  // and guidance goes on from it.
  const accountCopy: AccountCopy = !userId || isAccountRead
    ? 'read'
    : error
      ? 'failed'
      : 'loading'
  const accountCopyRead = accountCopy === 'read'
  // `localTick` re-reads the local mirror after every write, so a tip the
  // person dismissed leaves at once even when the server copy has not come
  // back (or there is no person id to cache it under) — "make sure they
  // disappear every time" (founder, 2026-10-01).
  const [localTick, setLocalTick] = useState(0)
  const state = useMemo(
    () => mergeGuidance(preferences.guidance),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preferences.guidance, localTick],
  )
  const [tourRunning, setTourRunning] = useState(false)
  const sessionRef = useRef(readSession())
  const [sessionTick, setSessionTick] = useState(0)
  const [nudgeDismissedThisSession, setNudgeDismissedThisSession] = useState(
    readNudgeSessionDismissed,
  )

  const cachedGuidance = useCallback(
    () =>
      userId
        ? (queryClient.getQueryData<UserPreferences>(queryKeys.user.preferences(userId))?.guidance as
            | Partial<GuidanceState>
            | undefined)
        : undefined,
    [queryClient, userId],
  )

  const persist = useCallback(
    (save: GuidanceSave) => {
      // Both copies carry the time of this save, so `mergeGuidance` can tell
      // which is newer, in this browser and in any other.
      const saved_at = new Date(Date.now()).toISOString()
      // This browser's copy gathers the saves made here until the account's
      // copy holds one as late as the latest of them; from then it starts
      // again with this save. So it does not keep a key from an older save
      // that another device has changed since, to lay back over that change.
      // A copy with no readable stamp was written before stamps, from a
      // read, so it is not carried into this one either.
      const kept = readLocalGuidance()
      const from =
        kept && savedAt(kept) !== null && !accountIsLater(cachedGuidance(), kept, true) ? kept : {}
      writeLocalGuidance(addSave(from, save, saved_at))
      setLocalTick((n) => n + 1)
      // Only what this action changed goes to the account. A copy built from
      // this browser's read would carry every other key as that read had it,
      // so a read made before another device's save would put back what that
      // save changed: "Not now" here undoing "Don't show tips again" there.
      // The hook lays the save over the cached copy the way the gateway does.
      if (userId) updatePreferences({ guidance: { ...save, saved_at } })
    },
    [cachedGuidance, updatePreferences, userId],
  )

  /**
   * Save what `change` returns. It is handed the guidance as this browser
   * sees it, for the few saves that build on a value (a count, the list of
   * cards seen); every other save names its keys outright.
   */
  const persistGuidance = useCallback(
    (change: (prev: GuidanceState) => GuidanceSave) => {
      // Nothing is saved, in this browser or to the account, until the
      // account's copy has been read (see `accountCopy`).
      if (!accountCopyRead) return
      const prev = mergeGuidance(cachedGuidance() ?? preferences.guidance)
      persist(change(prev))
    },
    [accountCopyRead, cachedGuidance, persist, preferences.guidance],
  )

  const patchPage = useCallback(
    (pageId: PageTourId, patch: Partial<PageGuidanceState>) => {
      persistGuidance(() => ({ pages: { [pageId]: patch } }))
    },
    [persistGuidance],
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

  // Read from the ref on every render. Each skip also changes state, so the
  // provider re-renders with the new count: `snoozeTip` and `dismissTip` bump
  // `sessionTick`, and a tour's `onSkipped` ends `tourRunning`, which
  // `startTour` set.
  const tipsPausedInThisTab = sessionRef.current.skips >= 2

  const tipVisibleFor = useMemo((): PageTourId | null => {
    if (!accountCopyRead) return null
    if (state.global.hide_all_tips) return null
    if (tourRunning) return null

    const snoozedUntil = state.global.tips_snoozed_until
    if (snoozedUntil && new Date(snoozedUntil).getTime() > Date.now()) return null

    // A genuine first-visit tutorial should show on every unseen page, so this
    // fatigue guard only kicks in once the user has actively snoozed/dismissed
    // a couple of tips this session — it does not cap the *number of distinct
    // pages* offered, only repeat nagging after explicit rejection.
    if (tipsPausedInThisTab) return null

    const pageId = resolveGuidancePageId(location.pathname, location.search)
    if (!pageId) return null

    const page = state.pages[pageId] ?? defaultPageState()
    // "Not now" is a four-hour snooze, not a goodbye (ADR 0251 D2): a snoozed
    // tip may come back on a later visit once its snooze has run out.
    if (page.tip !== 'unseen' && page.tip !== 'snoozed') return null
    if (page.snooze_until && new Date(page.snooze_until).getTime() > Date.now()) {
      return null
    }

    return pageId
    // sessionTick forces recompute after skip/offer mutations
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountCopyRead, state, tipsPausedInThisTab, tourRunning, location.pathname, location.search, sessionTick])

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

  // "Don't show tips again" turns EVERY page's tip off, not this page's alone,
  // until the person turns them back on (/help, "Page tips"). The founder,
  // 2026-10-01: "if I say don't ever show again then I don't want to see it
  // again until I press or check for it." A tour the person starts on
  // purpose still plays; only the unasked strip stops.
  const dismissTip = useCallback(
    (pageId: PageTourId) => {
      sessionRef.current.skips += 1
      writeSession(sessionRef.current)
      setSessionTick((n) => n + 1)
      trackGuidance('tip_dismissed', { pageId })
      persistGuidance(() => ({
        global: { hide_all_tips: true },
        pages: { [pageId]: { tip: 'dismissed' } },
      }))
    },
    [persistGuidance],
  )

  const completeTipViaTour = useCallback(
    (pageId: PageTourId) => {
      trackGuidance('tip_take_tour', { pageId })
      startTour(pageId)
    },
    [startTour],
  )

  const hideAllTips = useCallback(() => {
    persistGuidance(() => ({ global: { hide_all_tips: true } }))
  }, [persistGuidance])

  const resetTips = useCallback(() => {
    persistGuidance((prev) => {
      // Every page's tip, and not only the pages this browser's read holds:
      // that read can be older than a tip turned away elsewhere. A page's
      // tour is left as it was, and its snooze is taken away (`null`), so
      // a "Not now" snooze does not stay on the account (the gateway keeps
      // a key a save leaves out).
      const pages: GuidanceSave['pages'] = {}
      for (const id of new Set([...PAGE_TOUR_IDS, ...(Object.keys(prev.pages) as PageTourId[])])) {
        pages[id] = { tip: 'unseen', snooze_until: null }
      }
      sessionRef.current = { offeredPageIds: [], skips: 0 }
      writeSession(sessionRef.current)
      setSessionTick((n) => n + 1)
      try {
        localStorage.removeItem(LOCAL_GUIDANCE_KEY)
      } catch {
        // ignore
      }
      return {
        global: { hide_all_tips: false, tips_snoozed_until: null },
        pages,
      }
    })
  }, [persistGuidance])

  const markUseCardSeen = useCallback(
    (cardId: string) => {
      if (state.guide.use_cards_seen.includes(cardId)) return
      trackGuidance('guide_card_clicked', { cardId })
      // The whole list: the gateway puts an array in place of the one it holds.
      persistGuidance((prev) => ({
        guide: {
          use_cards_seen: [...prev.guide.use_cards_seen, cardId],
        },
      }))
    },
    [persistGuidance, state.guide.use_cards_seen],
  )

  // Fires once per render pass when the banner actually becomes visible —
  // callers gate this behind their own visibility check (role, route,
  // activation status) since GuidanceProvider doesn't know those.
  const markSetupNudgeShown = useCallback(() => {
    trackGuidance('tip_shown', { pageId: 'setup-nudge' })
    persistGuidance((prev) => ({
      setup_nudge: {
        last_shown_at: new Date().toISOString(),
        session_count: prev.setup_nudge.session_count + 1,
      },
    }))
  }, [persistGuidance])

  const snoozeSetupNudge = useCallback(() => {
    writeNudgeSessionDismissed(true)
    setNudgeDismissedThisSession(true)
    trackGuidance('tip_snoozed', { pageId: 'setup-nudge' })
    persistGuidance((prev) => ({
      setup_nudge: {
        snooze_count: prev.setup_nudge.snooze_count + 1,
        last_shown_at: new Date().toISOString(),
      },
    }))
  }, [persistGuidance])

  const dismissSetupNudgeForever = useCallback(() => {
    writeNudgeSessionDismissed(true)
    setNudgeDismissedThisSession(true)
    trackGuidance('tip_dismissed', { pageId: 'setup-nudge' })
    persistGuidance(() => ({
      setup_nudge: {
        dismissed_forever: true,
        last_shown_at: new Date().toISOString(),
      },
    }))
  }, [persistGuidance])

  const value: GuidanceContextValue = {
    state,
    accountCopy,
    tipsPausedInThisTab,
    tipVisibleFor,
    isTourRunning: tourRunning,
    startTour,
    snoozeTip,
    dismissTip,
    completeTipViaTour,
    hideAllTips,
    resetTips,
    markUseCardSeen,
    resolvePageId,
    isSetupNudgeDue: accountCopyRead && isSetupNudgeDue(state.setup_nudge),
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
