import { useEffect, useRef } from 'react'
import { animate, settle, stamp, turn } from '../../lib/mudavym/motion'

/**
 * "The mark draws" — the logo's signature motion, from the founder's own
 * curation of the motion canvas (sketch 087 `founder-curation.dc.html`,
 * family "Entrances & reveals"; its brief: "App launch: the double rule and
 * the full stop, which is part of the wordmark").
 *
 * The wordmark is a name, a full stop and a double rule. In bookkeeping a
 * double rule under a figure means the account is ruled off (sketch 087
 * notes, "The find that unifies the brand"), so the mark arrives in the order
 * a clerk would write it: the name is written left to right (`turn`), the
 * full stop is struck (`stamp`, from 300ms), and the two rules are drawn under
 * it (`settle`, from 340ms and 400ms). The timings are the curation's own.
 *
 * `play` false renders the end state with no motion; reduced motion collapses
 * every step to its end state through `animate()` itself. The component never
 * hides anything from a screen reader: it is one labelled image either way.
 */
export interface MarkDrawsProps {
  /** Font size of the name in px. The rules scale with it. Default 26. */
  size?: number
  /** Run the draw on mount. False renders the finished mark, still. */
  play?: boolean
  /** Delay before the first stroke, in ms. Default 0. */
  delay?: number
  className?: string
}

export function MarkDraws({ size = 26, play = true, delay = 0, className }: MarkDrawsProps) {
  const nameRef = useRef<HTMLSpanElement>(null)
  const stopRef = useRef<HTMLSpanElement>(null)
  const ruleRefs = useRef<(HTMLSpanElement | null)[]>([])

  useEffect(() => {
    if (!play) return
    const name = nameRef.current
    const stop = stopRef.current
    const [r1, r2] = ruleRefs.current
    if (!name || !stop || !r1 || !r2) return
    // Onboarding walk 2026-11-12: at 375 px the register's band read "Mudavy",
    // with no full stop and no rules. The layout had room (the name is 120 px
    // in a 349 px band); the draw had started and the page then drew no more
    // frames (a hidden pane, a background tab, a capture), so `fill: both` held
    // the half-written mark. The mark's resting state is the whole mark:
    //  - the draw starts on the first frame the page actually paints, so a page
    //    that paints none keeps the whole mark;
    //  - a page that is hidden mid-draw finishes the draw at once;
    //  - and when the draw's own length has passed, it is finished whatever the
    //    frames did (a pane can stop painting and still report itself visible:
    //    the walk's capture showed the draw stopped part-way through "Mudavym").
    let runs: (Animation | null)[] = []
    const finish = () => {
      for (const a of runs) {
        try {
          a?.finish()
        } catch {
          // an animation the engine already dropped has nothing to finish
        }
      }
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') finish()
    }
    const draw = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      runs = [
        animate(name, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], turn, { delay }),
        animate(stop, [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], stamp, { delay: delay + 300 }),
        animate(r1, [{ transform: 'scaleX(0)' }, { transform: 'none' }], settle, { delay: delay + 340 }),
        animate(r2, [{ transform: 'scaleX(0)' }, { transform: 'none' }], settle, { delay: delay + 400 }),
      ]
    }
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(draw) : (draw(), 0)
    const drawn = delay + Math.max(turn.ms, 300 + stamp.ms, 400 + settle.ms) + 250
    const backstop = setTimeout(finish, drawn)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
      clearTimeout(backstop)
      document.removeEventListener('visibilitychange', onHide)
      finish()
    }
    // Mount-only by design: the mark draws once, when it first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The rule runs three quarters of the name, as in the curation (78px
  // under a 26px name), and never past it.
  const rule = Math.round(size * 3)
  return (
    <span
      role="img"
      aria-label="Mudavym"
      translate="no"
      className={className}
      style={{ display: 'inline-flex', flexDirection: 'column', gap: Math.max(3, Math.round(size * 0.22)) }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          fontFamily: 'Fraunces, Georgia, serif',
          fontWeight: 600,
          fontSize: size,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          color: 'var(--ink-1)',
        }}
      >
        <span ref={nameRef} style={{ display: 'inline-block' }}>
          Mudavym
        </span>
        <span ref={stopRef} style={{ display: 'inline-block', color: 'var(--seal)', transformOrigin: '50% 80%' }}>
          .
        </span>
      </span>
      <span aria-hidden="true" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {[0, 1].map((i) => (
          <span
            key={i}
            ref={(el) => {
              ruleRefs.current[i] = el
            }}
            style={{
              display: 'block',
              width: rule,
              borderTop: '1px solid var(--ink-3)',
              transformOrigin: 'left center',
            }}
          />
        ))}
      </span>
    </span>
  )
}

export default MarkDraws
