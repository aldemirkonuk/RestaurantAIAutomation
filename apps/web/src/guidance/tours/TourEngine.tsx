import { useCallback, useRef } from 'react'
import type { PageTourId } from '../types'
import { TOUR_REGISTRY } from './registry'
import { trackGuidance } from '../analytics'

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

        const shortViewport =
          typeof window !== 'undefined' && window.innerHeight < 700
        const steps = (availableSteps.length ? availableSteps : def.steps).map(
          (s, i, arr) => ({
            element: s.element,
            popover: {
              title: `${i + 1}/${arr.length}  ${s.title}`,
              description: s.description,
              side: (shortViewport ? 'top' : 'bottom') as 'top' | 'bottom',
              align: 'start' as const,
            },
          }),
        )

        let completed = false

        const d = driver({
          showProgress: true,
          animate: !reduceMotion,
          allowClose: true,
          overlayColor: 'rgba(15, 23, 42, 0.55)',
          stagePadding: 6,
          stageRadius: 8,
          popoverOffset: shortViewport ? 12 : 10,
          nextBtnText: 'Next',
          prevBtnText: 'Back',
          doneBtnText: 'Done',
          steps,
          onHighlightStarted: (_el, _step, { state }) => {
            trackGuidance('tour_step', {
              pageId,
              step: state.activeIndex ?? 0,
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
          },
        })

        driverRef.current = d
        d.drive()
      } catch (err) {
        console.warn('[guidance] Tour engine failed to start', err)
        handlersRef.current.onSkipped(pageId)
      }
    },
    [stopTour],
  )

  return { startTour, stopTour }
}
