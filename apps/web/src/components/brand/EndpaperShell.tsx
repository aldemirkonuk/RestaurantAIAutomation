import { useId, type ReactNode } from 'react'
import { BrandMark } from './BrandMark'
import { HOUSE_WORDMARK } from './AuthShell'
import { cn } from '../../lib/utils'
import './endpaper.css'

/**
 * The wax-seal glyph, tiled as the endpaper's own pattern — sketch 118
 * Direction B. Path verbatim from the sketch, which reuses sketch 104's
 * "hold to seal" control glyph (`104:242`); geometry only, no meaning is
 * attached to the shape here (it is decoration, never a control).
 */
const SEAL_GLYPH_PATH =
  'M50 6c9 0 14 6 22 8s16-2 21 5-1 15 1 23 8 13 5 21-13 8-18 14-6 15-14 17-14-4-22-4-14 6-22 4-9-11-14-17-15-6-18-14 3-13 5-21-3-16 1-23 13-3 21-5S41 6 50 6z'

export interface EndpaperShellProps {
  /**
   * Small-caps line above the wordmark — the screen's own context, e.g.
   * "The house", "Register · 1 of 2", "Join". Changes per screen.
   */
  kicker: string
  /**
   * The endpaper's one still line of house voice. Static copy by default;
   * becomes the house's own name the moment the form has one (register
   * step 2, joining a house) — the one place the endpaper itself changes
   * with identity rather than with screen.
   */
  houseLine: string
  /**
   * The caption under `houseLine`. Per-screen, occasionally dynamic (the
   * join screen's "X is expecting you, as a Y"). Dropped automatically on
   * the <700px stacked band, which has no room for it.
   */
  tag?: string
  /** Top-right corner label on the leaf, e.g. "Sign in", "Register · 1 of 2". */
  folio?: string
  /** The recto — every field, message and control for this screen. */
  children: ReactNode
  /** 680px+ leaf for the wider restaurant-details screen (register step 2). */
  wide?: boolean
  /**
   * Design/QA escape only — production leaves this unset. Every other
   * rebuilt page owns its own `data-ground` (`lib/mudavym/shellGround.ts`);
   * a public, pre-auth page has no house-level preference to read, so this
   * shell defaults to paper (the book metaphor's own ground) and this prop
   * exists only so the visual sweep can also capture charcoal.
   */
  ground?: 'paper' | 'charcoal'
  className?: string
}

/**
 * The endpaper shell — sketch 118 Direction B. The founder chose it on
 * 2026-09-19 ("B, the endpaper") over the sketch README's recommendation of
 * Direction A; recorded in ADR 0149 row 35 and ADR 0143's bracket.
 *
 * A permanent left panel (the endpaper) tiling the house's wax-seal glyph,
 * carrying the wordmark and one still line of house voice; the working page
 * sits beside it, on the recto, changing per screen (`children`). Under
 * 700px the endpaper collapses to a ~150px band above the leaf rather than
 * dropping — there is no width to spare for both at 390.
 *
 * Reused by `/login`, `/register` and, per ADR 0164, the sign-in house
 * chooser once that PR lands — see this shell's props for exactly what a
 * new caller needs to supply (kicker/houseLine/tag/folio + its own leaf
 * content as children). Field- and button-level styling is NOT reinvented
 * here: callers keep using the app's existing accessible `Button`/field
 * classes inside `children` — this component owns only the book frame and
 * the leaf's heading typography.
 */
export function EndpaperShell({
  kicker,
  houseLine,
  tag,
  folio,
  children,
  wide = false,
  ground = 'paper',
  className,
}: EndpaperShellProps) {
  const tileId = useId()

  return (
    <div
      className={cn(
        'mdv-auth mudavym mdv-endpaper relative min-h-screen flex items-center justify-center px-4 py-10 sm:py-16',
      )}
      data-ground={ground}
      style={{ background: 'var(--paper-1)' }}
    >
      <div className="relative w-full flex flex-col items-center gap-4" style={{ maxWidth: wide ? 1040 : 960 }}>
        <div className={cn('mdv-ep-book', wide && 'mdv-ep-book--wide', className)}>
          <div className="mdv-ep-endpaper">
            <svg className="mdv-ep-tile" aria-hidden="true">
              <defs>
                <pattern id={tileId} width="58" height="58" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">
                  <path style={{ fill: 'var(--seal)', opacity: 0.1 }} transform="translate(9,6) scale(.34)" d={SEAL_GLYPH_PATH} />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill={`url(#${tileId})`} />
            </svg>
            <div className="mdv-ep-top">
              <span className="mdv-ep-kicker">{kicker}</span>
              <span className="mdv-ep-wordmark">
                <BrandMark variant="wordmark" size={26} alt="Mudavym" className={HOUSE_WORDMARK} />
              </span>
            </div>
            <div className="mdv-ep-body">
              <span className="mdv-ep-house">{houseLine}</span>
              {tag && <span className="mdv-ep-tagline">{tag}</span>}
            </div>
          </div>
          <div className="mdv-ep-leaf">
            {folio && <span className="mdv-ep-folio">{folio}</span>}
            <div className="mdv-ep-leaf-inner">{children}</div>
          </div>
        </div>
        <p className="text-center text-xs !text-inkm-3">© 2026 Mudavym. All rights reserved.</p>
      </div>
    </div>
  )
}
