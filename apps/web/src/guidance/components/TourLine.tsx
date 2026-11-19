import { useEffect, useRef, useState } from 'react'
import { cn } from '../../lib/utils'
import { useReducedMotion } from '../../lib/mudavym/motion'

/** How many times a page's tour line is shown before it stops asking. */
export const TOUR_LINE_VIEWS = 3

const viewsKey = (pageId: string) => `mdv.tourLine.views.${pageId}`

/** Views already spent on this page in this browser; 0 when storage is not there. */
function readViews(pageId: string): number {
  try {
    const n = Number.parseInt(window.localStorage.getItem(viewsKey(pageId)) ?? '0', 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

function writeViews(pageId: string, n: number) {
  try {
    window.localStorage.setItem(viewsKey(pageId), String(n))
  } catch {
    // Private window or blocked storage: the line then shows every visit,
    // which is the old behaviour, never a broken page.
  }
}

const action =
  'inline-flex min-h-[44px] items-center px-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wine-600/30 rounded-md'

/**
 * The page's tour offer, one 44 px line: "Take the tour · Later" (design critic
 * round 3, need 9: the old banner was four lines, 160 px, above the H1 of every
 * phone page). It is shown for the first three views of a page and then stops
 * asking for good; "Later" still snoozes it through the guidance provider.
 *
 * The page's own tip sentence is not painted, but a screen reader still gets
 * it through `aria-describedby`.
 */
export function TourLine({
  pageId,
  body,
  bodyId,
  className,
  onTour,
  onLater,
}: {
  pageId: string
  body: string
  bodyId: string
  className?: string
  onTour: () => void
  onLater: () => void
}) {
  const reduced = useReducedMotion()
  // Read once at mount: this visit is view `seen + 1`, and it is shown only
  // while that is one of the first three.
  const [seen] = useState(() => readViews(pageId))
  const [leaving, setLeaving] = useState(false)
  const [entered, setEntered] = useState(reduced)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = seen < TOUR_LINE_VIEWS

  useEffect(() => {
    if (show) writeViews(pageId, seen + 1)
  }, [pageId, seen, show])

  useEffect(() => {
    if (!show) return
    if (reduced) {
      setEntered(true)
      return
    }
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [show, reduced])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  if (!show) return null

  const later = () => {
    if (reduced) {
      onLater()
      return
    }
    // The line folds away (grid rows, not height) and then hands the snooze on.
    setLeaving(true)
    timer.current = setTimeout(onLater, 200)
  }

  const open = entered && !leaving

  return (
    <div
      role="region"
      aria-label="Page tip"
      aria-live="polite"
      data-guidance="tip-strip"
      data-open={open}
      style={{
        display: 'grid',
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        transition: reduced
          ? 'none'
          : 'grid-template-rows 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
      className={cn('mdv-guidance-strip mx-3 sm:mx-4 mt-1', className)}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex h-11 items-center gap-1 px-1">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-wine-500/80" aria-hidden />
          <button
            type="button"
            aria-describedby={bodyId}
            onClick={onTour}
            className={cn(action, 'mdv-guidance-primary text-wine-700 hover:text-wine-800')}
          >
            Take the tour
          </button>
          <span className="text-gray-400" aria-hidden>
            ·
          </span>
          <button
            type="button"
            aria-describedby={bodyId}
            onClick={later}
            className={cn(action, 'mdv-guidance-quiet font-medium text-gray-500 hover:text-gray-700')}
          >
            Later
          </button>
          <span id={bodyId} className="sr-only">
            {body}
          </span>
        </div>
      </div>
    </div>
  )
}
