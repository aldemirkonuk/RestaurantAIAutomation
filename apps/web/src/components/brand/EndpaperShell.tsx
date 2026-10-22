import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Seal } from '../mudavym/Seal'
import { MarkDraws } from '../mudavym/MarkDraws'
import { animate, ink, prefersReducedMotion, turn, type MotionToken } from '../../lib/mudavym/motion'
import { FrontMatterPoem, InsideCover } from './FrontMatter'
import { cn } from '../../lib/utils'
import './endpaper.css'

/**
 * The mark draws once per page load, not once per mount: `/login` and
 * `/register` are two routes of one book, and walking between them is turning
 * to another leaf, not opening the book again.
 */
let markHasDrawn = false

/**
 * A whole leaf turning over is twice the arc of a screen change, so it takes
 * the house `turn` curve at a longer reach (the motion canvas's own "The page
 * turns" rotates 92°; a full leaf is 180°).
 */
const LEAF_TURN: MotionToken = { easing: turn.easing, ms: 760 }

/** Under 700px the endpaper is a band above the leaf (endpaper.css). */
function isNarrow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 700px)').matches
}

export interface EndpaperShellProps {
  /**
   * Small-caps line above the wordmark. One per page ("The house" on sign-in,
   * "A new set of books" on register): the endpaper stays still while the
   * leaf changes, so this never carries a step.
   */
  kicker: string
  /**
   * The endpaper's one line of house voice. Static copy until the form knows
   * the house's name (register step 2, a resolved invite), then that name:
   * the one place the endpaper changes with identity.
   */
  houseLine: string
  /** The caption under `houseLine`. Dropped on the <700px band. */
  tag?: string
  /** Top-right label on the leaf, and the only place a step count is shown. */
  folio?: string
  /**
   * Which leaf is showing. A change turns the page: the new leaf swings down
   * from the gutter on the `turn` token while the endpaper holds still.
   * Omitted, the leaf never turns.
   */
  pageKey?: string
  /** The recto — every field, message and control for this screen. */
  children: ReactNode
  /** 680px+ leaf for the wider restaurant-details screen (register step 2). */
  wide?: boolean
  /**
   * Design/QA escape only — production leaves this unset. A public, pre-auth
   * page has no house preference to read, so the book defaults to paper.
   */
  ground?: 'paper' | 'charcoal'
  className?: string
  /**
   * The Easter egg (founder, 2026-09-19, on `/login`; 2026-10-09, on
   * `/register` as well): the endpaper becomes a page you can turn back, to
   * the inside cover and a short poem about the book the house keeps. Nothing
   * on the page advertises it — no dog-ear, no hint (his words: "not intrigued
   * by that") — but it is a real button, reachable and named for keyboard and
   * screen-reader users. The leaf's own content stays mounted underneath, so
   * whatever was typed survives.
   */
  frontMatter?: boolean
  /**
   * The front matter's way back, in the door's own words: "Turn back to sign
   * in" on `/login` (the default), "Turn back to register" on `/register`. It
   * names the hidden endpaper button while the poem is open and the poem's
   * own link; the arrow is added by the poem.
   */
  backLabel?: string
}

/**
 * The endpaper shell — sketch 118 Direction B. The founder chose it on
 * 2026-09-19 ("B, the endpaper") over the sketch README's recommendation of
 * Direction A; recorded in ADR 0149 row 35 and ADR 0143's bracket.
 *
 * A permanent left panel (the endpaper) pressed with the house seal — the same
 * die `Seal.tsx` strikes when something is approved — carrying the wordmark,
 * which draws itself once ("The mark draws", `MarkDraws.tsx`), and one still
 * line of house voice. The working page sits beside it on the recto and turns
 * when the screen changes. Under 700px the endpaper becomes a band above the
 * leaf.
 *
 * Reused by `/login`, `/register` and, per ADR 0164, the sign-in house
 * chooser. The leaf's ledger look (mono labels, fields drawn as a rule, square
 * buttons) is `endpaper.css`, scoped to this shell, so a caller keeps its own
 * fields and flow and only the dress changes.
 */
export function EndpaperShell({
  kicker,
  houseLine,
  tag,
  folio,
  pageKey,
  children,
  wide = false,
  ground = 'paper',
  className,
  frontMatter = false,
  backLabel = 'Turn back to sign in',
}: EndpaperShellProps) {
  const tileId = useId()
  const playRef = useRef<boolean | null>(null)
  if (playRef.current === null) playRef.current = !markHasDrawn
  const play = playRef.current

  const kickerRef = useRef<HTMLSpanElement>(null)
  const voiceRef = useRef<HTMLSpanElement>(null)
  const leafRef = useRef<HTMLDivElement>(null)
  const lastPage = useRef(pageKey)

  // ── the leaf's length ───────────────────────────────────────────────────
  // Pages of this book are not all the same length: the sign-in address step,
  // its method step, the front matter and each register step are each their
  // own height, and the leaf (so the book, and the colophon under it) takes
  // the length of the page that is on it. A turn therefore changes the book's
  // height, and until 2026-10-09 it did so in one frame, at the instant the
  // new page was on the DOM — the book and the footer under it jumped 67px
  // when the front matter opened, 112px from address to methods (measured
  // on production at 1512×982). Now the leaf eases from the old length to
  // the new one through the turn itself, on the turn's own curve, and lets
  // go when the page has landed, so the book never snaps.
  const leafBoxRef = useRef<HTMLDivElement>(null)
  /** The leaf's last settled height, kept by the observer below. */
  const leafHeight = useRef<number | null>(null)
  const heightRun = useRef<Animation | null>(null)

  /** Lets a height run go, if it is still the live one; the leaf is its natural length again. */
  const letGo = useCallback((run: Animation) => {
    if (heightRun.current === run) {
      heightRun.current = null
      run.cancel()
      if (leafBoxRef.current) leafHeight.current = leafBoxRef.current.offsetHeight
    } else {
      run.cancel()
    }
  }, [])

  /**
   * Eases the leaf from one length to another on `token`'s curve. A run that
   * is still live is taken over from where it is, never from the recorded
   * height. `hold` keeps the old length until that fraction of the run — the
   * closing turn holds until the leaf is edge-on, while the poem is still
   * wholly on the page. `settles` ends the run by itself when it finishes;
   * the front-matter turn is let go by the landing instead.
   */
  const easeHeight = useCallback(
    (from: number | null, to: number, token: MotionToken, options: { hold?: number; settles?: boolean } = {}) => {
      const leaf = leafBoxRef.current
      if (!leaf) return
      const live = heightRun.current ? parseFloat(getComputedStyle(leaf).height) : from
      if (heightRun.current) letGo(heightRun.current)
      // jsdom measures nothing (0); a page the same length as the last needs no run
      if (live === null || !(live > 0) || !(to > 0) || Math.abs(live - to) < 1) return
      const frames: Keyframe[] = options.hold
        ? [{ height: `${live}px` }, { height: `${live}px`, offset: options.hold }, { height: `${to}px` }]
        : [{ height: `${live}px` }, { height: `${to}px` }]
      const run = animate(leaf, frames, token)
      if (!run) return
      heightRun.current = run
      if (options.settles && run.finished && typeof run.finished.then === 'function') {
        run.finished.then(
          () => letGo(run),
          () => undefined, // cancelled by a later run or a landing: nothing to do
        )
      }
    },
    [letGo],
  )

  // ── the front matter ────────────────────────────────────────────────────
  // closed → opening → open → closing → closed. While turning, both spreads
  // are mounted, and every swap is keyed to the leaf's own progress, never to
  // the clock — so it stays hidden whatever the curve:
  //   - the inside cover is what lies UNDER the endpaper, so it is there from
  //     the first frame and the lifting leaf reveals it (and is covered again
  //     only as the leaf lands back on it);
  //   - the right page changes at the instant the leaf is edge-on (47%–53%),
  //     a cut, not a dissolve (sketch 118 front-matter.html crossfades there).
  const poemId = useId()
  const voiceId = useId()
  const [phase, setPhase] = useState<'closed' | 'opening' | 'open' | 'closing'>('closed')
  const front = phase === 'open'
  const shown = phase !== 'closed'
  const sheetRef = useRef<HTMLDivElement>(null)
  const versoRef = useRef<HTMLSpanElement>(null)
  const turnRef = useRef<HTMLButtonElement>(null)
  const coverRef = useRef<HTMLSpanElement>(null)
  const poemTitleRef = useRef<HTMLHeadingElement>(null)
  const poemRef = useRef<HTMLDivElement>(null)
  const settledOnce = useRef(false)
  const turnRuns = useRef<(Animation | null)[]>([])
  const phaseNow = useRef(phase)
  phaseNow.current = phase

  const turnTo = useCallback((toFront: boolean) => {
    setPhase((now) => {
      if (now === 'opening' || now === 'closing') return now
      if (toFront === (now === 'open')) return now
      // Reduced motion and the phone band change the page in place; the band
      // drops the poem over the form in the effect below instead of a leaf.
      if (prefersReducedMotion() || isNarrow()) return toFront ? 'open' : 'closed'
      return toFront ? 'opening' : 'closing'
    })
  }, [])

  useLayoutEffect(() => {
    if (phase !== 'opening' && phase !== 'closing') return
    const opening = phase === 'opening'
    const OUT = [{ opacity: 1 }, { opacity: 1, offset: 0.47 }, { opacity: 0, offset: 0.53 }, { opacity: 0 }]
    const IN = [{ opacity: 0 }, { opacity: 0, offset: 0.47 }, { opacity: 1, offset: 0.53 }, { opacity: 1 }]
    // under the leaf: shown throughout the lift, gone only as the leaf lands on it
    const UNDER = opening ? [{ opacity: 1 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 1, offset: 0.97 }, { opacity: 0 }]
    const OVER = opening ? [{ opacity: 0 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 0, offset: 0.97 }, { opacity: 1 }]
    const pairs: [Element | null, Keyframe[]][] = [
      [
        sheetRef.current,
        opening
          ? [{ transform: 'perspective(2400px) rotateY(0deg)' }, { transform: 'perspective(2400px) rotateY(-180deg)' }]
          : [{ transform: 'perspective(2400px) rotateY(-180deg)' }, { transform: 'perspective(2400px) rotateY(0deg)' }],
      ],
      // the leaf's back fades as it lands on the page it is turning onto
      [versoRef.current, opening ? [{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1 }]],
      [leafRef.current, opening ? OUT : IN],
      [poemRef.current, opening ? IN : OUT],
      [turnRef.current, OVER],
      [coverRef.current, UNDER],
    ]
    const runs = pairs.flatMap(([el, frames]) => (el ? [animate(el, frames, LEAF_TURN)] : []))
    turnRuns.current = runs
    // The leaf's length follows the turn: out to the poem's, back to the page's.
    // Both pages sit in one grid cell, each at its own height (endpaper.css),
    // so the cell is the longer of the two while the poem is mounted and the
    // page's own length is the leaf-inner plus the leaf's padding.
    const box = leafBoxRef.current
    const inner = leafRef.current
    if (box && inner) {
      const style = getComputedStyle(box)
      const pageLength = inner.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      if (opening) easeHeight(pageLength, box.offsetHeight, LEAF_TURN)
      else easeHeight(box.offsetHeight, pageLength, LEAF_TURN, { hold: 0.53 })
    }
    // The runs hold their last frame (fill both) until the settled page has
    // committed; they are cancelled in the layout effect below, after React
    // has written the settled state and before the browser paints it, so no
    // frame ever shows the half-turned book or the uncovered form.
    const settle = () => setPhase(opening ? 'open' : 'closed')
    if (runs.length === 0 || runs.some((run) => !run)) {
      settle()
      return
    }
    const done = window.setTimeout(settle, LEAF_TURN.ms)
    return () => window.clearTimeout(done)
  }, [phase, easeHeight])

  useLayoutEffect(() => {
    if (phase !== 'open' && phase !== 'closed') return
    for (const run of turnRuns.current) run?.cancel()
    turnRuns.current = []
    if (heightRun.current) letGo(heightRun.current)
  }, [phase, letGo])

  // The band and reduced motion change the page in place (closed → open in
  // one commit); the leaf still eases to the new page's length, on the same
  // curve as the poem dropping over the form.
  const lastPhase = useRef(phase)
  useLayoutEffect(() => {
    const was = lastPhase.current
    lastPhase.current = phase
    const inPlace = (was === 'closed' && phase === 'open') || (was === 'open' && phase === 'closed')
    if (!inPlace || !leafBoxRef.current) return
    easeHeight(leafHeight.current, leafBoxRef.current.offsetHeight, turn, { settles: true })
  }, [phase, easeHeight])
  useEffect(
    () => () => {
      for (const run of turnRuns.current) run?.cancel()
    },
    [],
  )

  // The leaf under the poem is inert while it is covered, so nothing hidden
  // can take focus; focus follows the page — the poem's title when the front
  // matter lands, the endpaper again when the book turns back.
  useEffect(() => {
    const leafContent = leafRef.current
    if (leafContent) {
      if (shown) leafContent.setAttribute('inert', '')
      else leafContent.removeAttribute('inert')
    }
    if (phase !== 'open' && phase !== 'closed') return
    if (!settledOnce.current && phase === 'closed') return
    settledOnce.current = true
    if (phase === 'open') {
      if (isNarrow() && poemRef.current) {
        animate(
          poemRef.current,
          [
            { transform: 'perspective(1400px) rotateX(-70deg)', opacity: 0.2 },
            { transform: 'perspective(1400px) rotateX(0deg)', opacity: 1 },
          ],
          turn,
          { fill: 'none' },
        )
      }
      poemTitleRef.current?.focus({ preventScroll: true })
    } else {
      turnRef.current?.focus({ preventScroll: true })
    }
  }, [phase, shown])

  useEffect(() => {
    if (!front) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        turnTo(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [front, turnTo])

  useEffect(() => {
    markHasDrawn = true
    // The kicker and the house voice follow the mark in, on ink, once it has
    // been ruled off — never before the name exists.
    if (!play) return
    for (const el of [kickerRef.current, voiceRef.current]) {
      if (el) animate(el, [{ opacity: 0 }, { opacity: 1 }], ink, { delay: 560 })
    }
    // Mount-only: the entrance happens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The page turn. Layout effect, so the new leaf never paints flat first.
  useLayoutEffect(() => {
    if (lastPage.current === pageKey) return
    lastPage.current = pageKey
    // The new page is already on the DOM, so the leaf is its length; ease to
    // it from the length the observer recorded before this commit. This holds
    // under the poem too — the book's edge is seen even when the page is not.
    if (leafBoxRef.current) easeHeight(leafHeight.current, leafBoxRef.current.offsetHeight, turn, { settles: true })
    // A sign-in step that lands while the front matter is open (or turning)
    // changes under the poem, unseen; it must not animate over it.
    if (phaseNow.current !== 'closed') return
    const leaf = leafRef.current
    if (!leaf) return
    animate(
      leaf,
      [
        { transform: 'perspective(1600px) rotateY(9deg)', opacity: 0.2 },
        { transform: 'perspective(1600px) rotateY(0deg)', opacity: 1 },
      ],
      turn,
      { fill: 'none' },
    )
  }, [pageKey, easeHeight])

  // The leaf's settled length, after every commit and on every resize (a
  // validation line appearing, the address picker, the window), never while
  // a height run is live — that would record a frame of the run.
  useLayoutEffect(() => {
    if (leafBoxRef.current && !heightRun.current) leafHeight.current = leafBoxRef.current.offsetHeight
  })
  useEffect(() => {
    const leaf = leafBoxRef.current
    if (!leaf || typeof ResizeObserver !== 'function') return
    const watch = new ResizeObserver(() => {
      if (!heightRun.current) leafHeight.current = leaf.offsetHeight
    })
    if (typeof watch.observe !== 'function') return // a test double without one
    watch.observe(leaf)
    return () => watch.disconnect()
  }, [])

  const endpaperFace = (
    <>
      <span className="mdv-ep-top">
        <span className="mdv-ep-kicker" ref={kickerRef}>
          {kicker}
        </span>
        <MarkDraws size={26} play={play} className="mdv-ep-wordmark" />
      </span>
      <span className="mdv-ep-body" ref={voiceRef} id={voiceId}>
        <span className="mdv-ep-house">{houseLine}</span>
        {/* a real space, so the two lines read as two sentences when this
            span describes the turn; a flex column never renders it */}
        {tag && ' '}
        {tag && <span className="mdv-ep-tagline">{tag}</span>}
      </span>
    </>
  )

  return (
    <div
      className="mdv-auth mudavym mdv-endpaper"
      data-ground={ground}
    >
      <div className={cn('mdv-ep-stage', wide && 'mdv-ep-stage--wide')}>
        <div className={cn('mdv-ep-book', wide && 'mdv-ep-book--wide', className)}>
          <div className="mdv-ep-endpaper" data-front={front ? '' : undefined}>
            <svg className="mdv-ep-tile" aria-hidden="true">
              <defs>
                <pattern id={tileId} width="112" height="112" patternUnits="userSpaceOnUse">
                  <g transform="rotate(-7 30 32)">
                    <Seal size={40} pressed x={10} y={12} color="var(--mdv-ep-wax)" />
                  </g>
                  <g transform="rotate(5 84 84)">
                    <Seal size={40} pressed x={64} y={64} color="var(--mdv-ep-wax)" />
                  </g>
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#${tileId})`} />
            </svg>
            {frontMatter ? (
              <button
                type="button"
                ref={turnRef}
                className="mdv-ep-turn"
                aria-label={front ? backLabel : 'Turn back to the front of the book'}
                aria-expanded={front}
                aria-controls={poemId}
                aria-describedby={voiceId}
                data-endpaper-chrome=""
                onClick={() => turnTo(!front)}
              >
                {endpaperFace}
              </button>
            ) : (
              endpaperFace
            )}
            {frontMatter && shown && (
              <span className="mdv-ep-cover-in" ref={coverRef}>
                <InsideCover />
              </span>
            )}
          </div>
          <div ref={leafBoxRef} className={cn('mdv-ep-leaf', frontMatter && 'mdv-ep-leaf--front-matter')} data-front={front ? '' : undefined}>
            {(phase === 'opening' || front ? 'Front matter' : folio) && (
              <span className="mdv-ep-folio">{phase === 'opening' || front ? 'Front matter' : folio}</span>
            )}
            <div className="mdv-ep-leaf-inner" ref={leafRef}>
              {children}
            </div>
            {frontMatter && shown && (
              <div id={poemId} ref={poemRef} className="mdv-ep-poem-page" data-endpaper-chrome="">
                <FrontMatterPoem id={poemId} ref={poemTitleRef} backLabel={backLabel} onBack={() => turnTo(false)} />
              </div>
            )}
          </div>
          {(phase === 'opening' || phase === 'closing') && (
            <div ref={sheetRef} className="mdv-ep-sheet" aria-hidden="true">
              {/* The leaf's recto is the endpaper as it stands, so the turn
                  starts from exactly what was on the page. */}
              <span className="mdv-ep-sheet-face mdv-ep-sheet-face--recto">
                <svg className="mdv-ep-tile">
                  <rect width="100%" height="100%" fill={`url(#${tileId})`} />
                </svg>
                <span className="mdv-ep-top">
                  <span className="mdv-ep-kicker">{kicker}</span>
                  <MarkDraws size={26} play={false} className="mdv-ep-wordmark" />
                </span>
                <span className="mdv-ep-body">
                  <span className="mdv-ep-house">{houseLine}</span>
                  {tag && <span className="mdv-ep-tagline">{tag}</span>}
                </span>
              </span>
              <span className="mdv-ep-sheet-face mdv-ep-sheet-face--verso" ref={versoRef} />
            </div>
          )}
        </div>
        <p className="mdv-ep-colophon">© 2026 Mudavym. All rights reserved.</p>
      </div>
    </div>
  )
}
