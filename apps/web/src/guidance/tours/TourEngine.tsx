import { useCallback, useRef } from 'react'
import type { PageTourId } from '../types'
import { TOUR_REGISTRY } from './registry'
import { trackGuidance } from '../analytics'
import { announceGuidance, focusTourHelpButton } from '../announce'
import '../components/guidance-note.css'

export interface TourEngineApi {
  startTour: (pageId: PageTourId) => Promise<void>
  stopTour: () => void
}

/**
 * Adapter over driver.js. Loads the library dynamically so Phase-1 bundles
 * stay light when tours are unused.
 */
export function useTourEngine(handlers: {
  onCompleted: (pageId: PageTourId) => void
  onSkipped: (pageId: PageTourId) => void
}): TourEngineApi {
  const driverRef = useRef<{ destroy: () => void } | null>(null)
  const activePageRef = useRef<PageTourId | null>(null)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  const stopTour = useCallback(() => {
    try {
      driverRef.current?.destroy()
    } catch {
      // ignore
    }
    driverRef.current = null
    activePageRef.current = null
  }, [])

  const startTour = useCallback(
    async (pageId: PageTourId) => {
      const def = TOUR_REGISTRY[pageId]
      if (!def?.steps?.length) return

      stopTour()
      activePageRef.current = pageId
      trackGuidance('tour_started', { pageId })
      // Tip strip unmounts when tour starts — park focus on a stable control.
      focusTourHelpButton()

      const reduceMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches

      try {
        const { driver } = await import('driver.js')
        await import('driver.js/dist/driver.css')

        const availableSteps = def.steps.filter((s) => {
          try {
            return !!document.querySelector(s.element)
          } catch {
            return false
          }
        })

        if (!availableSteps.length) {
          announceGuidance('Tour unavailable — page sections not ready yet.')
          handlersRef.current.onSkipped(pageId)
          activePageRef.current = null
          focusTourHelpButton()
          return
        }

        const shortViewport =
          typeof window !== 'undefined' && window.innerHeight < 700
        const steps = availableSteps.map((s) => ({
          element: s.element,
          popover: {
            title: s.title,
            description: s.description,
            side: (shortViewport ? 'top' : 'bottom') as 'top' | 'bottom',
            align: 'start' as const,
          },
        }))

        let completed = false

        const restoreFocus = () => {
          // Defer past driver teardown so focus isn't stolen back to overlay.
          window.requestAnimationFrame(() => focusTourHelpButton())
        }

        // Sketch 125, Tips A (locked 2026-10-01): a ring on the real thing and
        // a small card beside it — no dark veil. The overlay stays (it is what
        // lets a click elsewhere end the tour) but draws nothing; the ring is
        // guidance-note.css's outline on `.driver-active-element`, which stays
        // clickable.
        const d = driver({
          showProgress: true,
          progressText: 'Step {{current}} of {{total}}',
          animate: !reduceMotion,
          allowClose: true,
          overlayOpacity: 0,
          popoverClass: 'mudavym mdv-tourcard',
          stagePadding: 6,
          stageRadius: 10,
          popoverOffset: shortViewport ? 14 : 12,
          nextBtnText: 'Next',
          prevBtnText: 'Back',
          doneBtnText: 'Done',
          steps,
          onPopoverRender: (popover, { driver: drv }) => {
            // "Step 2 of 4" reads as an eyebrow above the title, not a footnote.
            popover.wrapper.insertBefore(popover.progress, popover.title)
            // "Stop", in words, beside Back and Next — not a bare × in the corner.
            popover.closeButton.textContent = 'Stop'
            popover.closeButton.setAttribute('aria-label', 'Stop the tour')
            popover.footerButtons.appendChild(popover.closeButton)
            // "Try it": end the tour and put the person on the real control,
            // so the next key press does the step itself.
            const idx = drv.getActiveIndex() ?? 0
            const selector = availableSteps[idx]?.element
            const tryIt = document.createElement('button')
            tryIt.type = 'button'
            tryIt.className = 'driver-popover-footer-btn mdv-tourcard__try'
            tryIt.textContent = 'Try it'
            tryIt.addEventListener('click', () => {
              completed = true
              trackGuidance('tour_tried', { pageId, step: idx })
              handlersRef.current.onCompleted(pageId)
              drv.destroy()
              driverRef.current = null
              activePageRef.current = null
              window.requestAnimationFrame(() => {
                const target = selector ? document.querySelector<HTMLElement>(selector) : null
                if (!target) {
                  focusTourHelpButton()
                  return
                }
                target.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
                // A ring may sit on a group, not one control; give the group a
                // focus stop so focus lands on the ringed thing, not the page.
                if (!target.hasAttribute('tabindex') && target.tabIndex < 0) {
                  target.setAttribute('tabindex', '-1')
                }
                target.focus({ preventScroll: true })
              })
            })
            popover.footerButtons.prepend(tryIt)
          },
          onHighlightStarted: (_el, _step, { state }) => {
            const idx = state.activeIndex ?? 0
            const total = steps.length
            const title = availableSteps[idx]?.title ?? ''
            const description = availableSteps[idx]?.description ?? ''
            announceGuidance(
              `Step ${idx + 1} of ${total}: ${title}. ${description}`,
            )
            trackGuidance('tour_step', {
              pageId,
              step: idx,
            })
          },
          onNextClick: (_el, _step, { driver: drv }) => {
            if (drv.isLastStep()) {
              completed = true
              trackGuidance('tour_completed', { pageId })
              handlersRef.current.onCompleted(pageId)
              drv.destroy()
              driverRef.current = null
              activePageRef.current = null
              restoreFocus()
              return
            }
            drv.moveNext()
          },
          onCloseClick: (_el, _step, { driver: drv }) => {
            if (!completed) {
              trackGuidance('tour_skipped', { pageId })
              handlersRef.current.onSkipped(pageId)
            }
            drv.destroy()
            driverRef.current = null
            activePageRef.current = null
            restoreFocus()
          },
          onDestroyStarted: (_el, _step, { driver: drv }) => {
            if (!drv.isActive()) return
            if (!completed) {
              const idx = drv.getActiveIndex()
              const total = steps.length
              const finished = typeof idx === 'number' && idx >= total - 1
              if (finished) {
                completed = true
                trackGuidance('tour_completed', { pageId })
                handlersRef.current.onCompleted(pageId)
              } else {
                trackGuidance('tour_skipped', { pageId })
                handlersRef.current.onSkipped(pageId)
              }
            }
            drv.destroy()
            driverRef.current = null
            activePageRef.current = null
            restoreFocus()
          },
        })

        driverRef.current = d
        d.drive()
      } catch (err) {
        console.warn('[guidance] Tour engine failed to start', err)
        handlersRef.current.onSkipped(pageId)
        activePageRef.current = null
        focusTourHelpButton()
      }
    },
    [stopTour],
  )

  return { startTour, stopTour }
}
