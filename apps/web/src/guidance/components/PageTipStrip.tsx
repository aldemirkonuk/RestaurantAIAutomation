import { usePageGuidance } from '../usePageGuidance'
import { TOUR_REGISTRY } from '../tours/registry'
import './guidance-note.css'

/**
 * The page tip as a margin note (sketch 125, Tips A — locked by the founder
 * 2026-10-01). One quiet line at the page's left margin, and three verbs:
 *
 *   - "Show me — N steps" rings the real thing on the page, step by step.
 *   - "Not now" hides it; it may come back on a later visit.
 *   - "Don't show tips again" turns every page's tip off until the person
 *     turns them back on in Help (GuidanceProvider `dismissTip`).
 *
 * The region keeps its "Page tip" name so the live region and the tests that
 * find it by role still do.
 */
export function PageTipStrip({ className }: { className?: string }) {
  const { showTip, tipDef, pageId, guidance } = usePageGuidance()

  if (!showTip || !tipDef || !pageId || !guidance) return null

  const bodyId = `page-tip-body-${pageId}`
  const steps = TOUR_REGISTRY[pageId]?.steps.length ?? 0

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
