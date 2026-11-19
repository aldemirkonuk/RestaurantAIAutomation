import { prefersReducedMotion } from './motion'

/**
 * The page turn: every change of page runs through one View Transition, so the
 * old page lifts away in 90 ms and the new one settles in over 220 ms, while
 * the H1 travels from where it stood to where it lands (one shared element,
 * `page-title`). The numbers live in `page-turn.css`; they are repeated here so
 * a test can hold the two together.
 */
export const PAGE_TURN = {
  outMs: 90,
  inMs: 220,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  titleName: 'page-title',
  /** The longest the old page is held while the next one loads. */
  holdMs: 350,
} as const

interface ViewTransitionLike {
  finished: Promise<unknown>
}
type TransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => ViewTransitionLike
}

/** Whether this browser, in this person's settings, turns pages. */
export function canTurnPage(doc: TransitionDocument = document): boolean {
  return typeof doc.startViewTransition === 'function' && !prefersReducedMotion()
}

type Named = HTMLElement & { style: CSSStyleDeclaration & { viewTransitionName: string } }

function firstTitle(doc: Document): Named | null {
  return doc.querySelector<Named>('h1')
}

function clearTitleNames(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll<Named>('h1'))) {
    if (el.style.viewTransitionName === PAGE_TURN.titleName) el.style.viewTransitionName = ''
  }
}

/**
 * A page turn is two calls. `run(apply)` starts the transition and calls
 * `apply` once the old page has been captured (never before, or the capture
 * would already show the new page); `committed()` is called by the router the
 * moment the new page is on screen, which lets the transition capture it. If
 * the new page is slow (a lazy chunk), the old one is held for `holdMs` and
 * the turn goes ahead anyway. Without the API, or under reduced motion, `run`
 * just calls `apply`.
 */
export function createPageTurn(doc: TransitionDocument = document) {
  let finish: (() => void) | null = null
  let turning = false

  function run(apply: () => void): void {
    if (turning || !canTurnPage(doc)) {
      apply()
      return
    }
    const old = firstTitle(doc)
    if (old) old.style.viewTransitionName = PAGE_TURN.titleName
    turning = true
    const transition = doc.startViewTransition!(
      () =>
        new Promise<void>((resolve) => {
          const timer = setTimeout(() => finish?.(), PAGE_TURN.holdMs)
          finish = () => {
            clearTimeout(timer)
            finish = null
            clearTitleNames(doc)
            const next = firstTitle(doc)
            if (next) next.style.viewTransitionName = PAGE_TURN.titleName
            resolve()
          }
          apply()
        }),
    )
    const done = () => {
      turning = false
      finish = null
      clearTitleNames(doc)
    }
    transition.finished.then(done, done)
  }

  function committed(): void {
    finish?.()
  }

  return { run, committed }
}
