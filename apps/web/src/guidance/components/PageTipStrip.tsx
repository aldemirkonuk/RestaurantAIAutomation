import { useLayoutEffect, useState } from 'react'
import { usePageGuidance } from '../usePageGuidance'
import { stepsOnPage } from '../tours/TourEngine'
import type { PageTourId } from '../types'
import './guidance-note.css'

/**
 * How many of `pageId`'s tour steps the page can show right now — counted by
 * the tour's own `stepsOnPage`, so the button never promises a step the tour
 * would leave out. A page often draws its sections after the tip, so the count
 * is taken again (at most once a frame) whenever the page changes, for as
 * long as the tip is up. `null` means there is no tip to count for.
 */
function useStepsOnPage(pageId: PageTourId | null): number {
  const [count, setCount] = useState(() => (pageId ? stepsOnPage(pageId).length : 0))
  // A layout effect, so the first count is taken once this render's elements
  // are in the page and before the tip is painted. Whatever the page draws
  // later is caught by the observer below.
  useLayoutEffect(() => {
    if (!pageId) return
    let frame = 0
    const recount = () => {
      frame = 0
      setCount(stepsOnPage(pageId).length)
    }
    recount()
    if (typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
      if (!frame) frame = window.requestAnimationFrame(recount)
    })
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    return () => {
      observer.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [pageId])
  return count
}

/**
 * The page tip as a margin note (sketch 125, Tips A — locked by the founder
 * 2026-10-01). One quiet line at the page's left margin, and three verbs:
 *
 *   - "Show me — N steps" rings the real thing on the page, step by step. N
 *     counts only the steps whose element is on the page; with none, the
 *     button is not offered.
 *   - "Not now" hides it; it may come back on a later visit.
 *   - "Don't show tips again" turns every page's tip off until the person
 *     turns them back on in Help (GuidanceProvider `dismissTip`).
 *
 * The region keeps its "Page tip" name so the live region and the tests that
 * find it by role still do.
 */
export function PageTipStrip({ className }: { className?: string }) {
  const { showTip, tipDef, pageId, guidance } = usePageGuidance()
  const steps = useStepsOnPage(showTip ? pageId : null)

  if (!showTip || !tipDef || !pageId || !guidance) return null

  const bodyId = `page-tip-body-${pageId}`

  return (
    <aside
      role="region"
      aria-label="Page tip"
      data-guidance="tip-strip"
      // The note paints no ground of its own; it sits on the shell's light
      // page area, so its tokens resolve as paper even under a charcoal choice.
      data-ground="paper"
      className={['mudavym mdv-tipnote', className].filter(Boolean).join(' ')}
    >
      <p className="mdv-tipnote__line" id={bodyId}>
        <span className="mdv-tipnote__lead">{tipDef.title}</span> {tipDef.body}
      </p>
      <div className="mdv-tipnote__acts">
        {steps > 0 && (
          <button
            type="button"
            className="mdv-tipnote__act mdv-tipnote__act--show"
            aria-describedby={bodyId}
            onClick={() => guidance.completeTipViaTour(pageId)}
          >
            Show me — {steps} {steps === 1 ? 'step' : 'steps'}
          </button>
        )}
        <button
          type="button"
          className="mdv-tipnote__act"
          aria-describedby={bodyId}
          onClick={() => guidance.snoozeTip(pageId)}
        >
          Not now
        </button>
        <button
          type="button"
          className="mdv-tipnote__act"
          aria-describedby={bodyId}
          onClick={() => guidance.dismissTip(pageId)}
        >
          Don't show tips again
        </button>
      </div>
    </aside>
  )
}
