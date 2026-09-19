import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Seal } from '../mudavym/Seal'
import { MarkDraws } from '../mudavym/MarkDraws'
import { animate, ink, turn } from '../../lib/mudavym/motion'
import { cn } from '../../lib/utils'
import './endpaper.css'

/**
 * The mark draws once per page load, not once per mount: `/login` and
 * `/register` are two routes of one book, and walking between them is turning
 * to another leaf, not opening the book again.
 */
let markHasDrawn = false

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
}: EndpaperShellProps) {
  const tileId = useId()
  const playRef = useRef<boolean | null>(null)
  if (playRef.current === null) playRef.current = !markHasDrawn
  const play = playRef.current

  const kickerRef = useRef<HTMLSpanElement>(null)
  const voiceRef = useRef<HTMLDivElement>(null)
  const leafRef = useRef<HTMLDivElement>(null)
  const lastPage = useRef(pageKey)

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
  }, [pageKey])

  return (
    <div
      className="mdv-auth mudavym mdv-endpaper"
      data-ground={ground}
    >
      <div className={cn('mdv-ep-stage', wide && 'mdv-ep-stage--wide')}>
        <div className={cn('mdv-ep-book', wide && 'mdv-ep-book--wide', className)}>
          <div className="mdv-ep-endpaper">
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
            <div className="mdv-ep-top">
              <span className="mdv-ep-kicker" ref={kickerRef}>
                {kicker}
              </span>
              <MarkDraws size={26} play={play} className="mdv-ep-wordmark" />
            </div>
            <div className="mdv-ep-body" ref={voiceRef}>
              <span className="mdv-ep-house">{houseLine}</span>
              {tag && <span className="mdv-ep-tagline">{tag}</span>}
            </div>
          </div>
          <div className="mdv-ep-leaf">
            {folio && <span className="mdv-ep-folio">{folio}</span>}
            <div className="mdv-ep-leaf-inner" ref={leafRef}>
              {children}
            </div>
          </div>
        </div>
        <p className="mdv-ep-colophon">© 2026 Mudavym. All rights reserved.</p>
      </div>
    </div>
  )
}
