/**
 * A tour that cannot start says so on screen as well as to a screen reader
 * (ADR 0020): the offer line used to vanish and leave focus on BODY.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { announceGuidanceVisibly, GUIDANCE_LINE_MS, GuidanceLiveRegion } from './announce'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('announceGuidanceVisibly', () => {
  it('[REVERT-FAILS] draws the failure as a line, then takes it away', () => {
    vi.useFakeTimers()
    render(<GuidanceLiveRegion />)
    act(() => announceGuidanceVisibly('This tour could not start.'))
    expect(document.querySelector('[data-guidance="tour-line-said"]')).toHaveTextContent('This tour could not start.')
    act(() => void vi.advanceTimersByTime(GUIDANCE_LINE_MS + 10))
    expect(document.querySelector('[data-guidance="tour-line-said"]')).toBeNull()
  })

  it('says it to a screen reader once, without a second live region on the visible line', () => {
    vi.useFakeTimers()
    render(<GuidanceLiveRegion />)
    act(() => announceGuidanceVisibly('Nope.'))
    act(() => void vi.advanceTimersByTime(50))
    expect(document.querySelector('[role="status"]')).toHaveTextContent('Nope.')
    expect(document.querySelector('[data-guidance="tour-line-said"]')).toHaveAttribute('aria-hidden', 'true')
  })
})
