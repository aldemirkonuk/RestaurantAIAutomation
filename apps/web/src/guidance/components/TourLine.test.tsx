/**
 * The tour offer is one 44 px line, "Take the tour · Later", shown for the first
 * three views of a page and then no more (design critic round 3, need 9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TourLine, TOUR_LINE_VIEWS } from './TourLine'

const line = () => document.querySelector('[data-guidance="tip-strip"]')

function mount(pageId = 'inventory', handlers = { onTour: vi.fn(), onLater: vi.fn() }) {
  const r = render(
    <TourLine pageId={pageId} body="Stock, alerts and reorder points." bodyId={`b-${pageId}`} {...handlers} />,
  )
  return { ...r, ...handlers }
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('TourLine', () => {
  it('[REVERT-FAILS] is one 44 px line that reads "Take the tour · Later", the sentence kept for a screen reader', () => {
    mount()
    const row = line()!.querySelector('.h-11')
    expect(row).not.toBeNull()
    expect(row!.querySelectorAll('button')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Take the tour' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Later' })).toBeInTheDocument()
    const visible = Array.from(row!.children)
      .filter((c) => !c.classList.contains('sr-only'))
      .map((c) => c.textContent)
      .join('')
    expect(visible).toBe('Take the tour·Later')
    expect(document.getElementById('b-inventory')).toHaveTextContent('Stock, alerts and reorder points.')
    // each action is a 44 px target
    for (const b of row!.querySelectorAll('button')) expect(b.className).toMatch(/min-h-\[44px\]/)
  })

  it('[REVERT-FAILS] shows for the first three views of a page and hides itself from the fourth', () => {
    for (let view = 1; view <= TOUR_LINE_VIEWS; view++) {
      const { unmount } = mount()
      expect(line(), `view ${view}`).not.toBeNull()
      unmount()
    }
    mount()
    expect(line()).toBeNull()
  })

  it('counts each page on its own', () => {
    for (let i = 0; i < TOUR_LINE_VIEWS; i++) mount('inventory').unmount()
    mount('reports')
    expect(line()).not.toBeNull()
  })

  it('still shows when storage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    mount()
    expect(line()).not.toBeNull()
    spy.mockRestore()
    set.mockRestore()
  })

  it('takes the tour at once', () => {
    const { onTour } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Take the tour' }))
    expect(onTour).toHaveBeenCalledTimes(1)
  })

  it('[REVERT-FAILS] folds away on "Later" (grid rows and opacity only), then hands the snooze on', () => {
    vi.useFakeTimers()
    const { onLater } = mount()
    act(() => {
      vi.advanceTimersByTime(50)
    })
    const el = line() as HTMLElement
    expect(el.style.transition).toMatch(/grid-template-rows 200ms cubic-bezier\(0\.16, 1, 0\.3, 1\)/)
    expect(el.style.transition).not.toMatch(/all/)
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(el.style.gridTemplateRows).toBe('0fr')
    expect(onLater).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onLater).toHaveBeenCalledTimes(1)
  })

  it('[REVERT-FAILS] honours reduced motion: no transition, and "Later" snoozes at once', () => {
    const mql = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
    const mm = vi.spyOn(window, 'matchMedia').mockImplementation(() => mql as never)
    const { onLater } = mount()
    const el = line() as HTMLElement
    expect(el.style.transition).toBe('none')
    expect(el.style.gridTemplateRows).toBe('1fr')
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(onLater).toHaveBeenCalledTimes(1)
    mm.mockRestore()
  })
})
