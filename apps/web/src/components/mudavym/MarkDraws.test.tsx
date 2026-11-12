/**
 * The mark's resting state is the whole mark (onboarding walk 2026-11-12: the
 * register band at 375 px read "Mudavy", the draw held part-way by a page that
 * stopped painting frames).
 */
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkDraws } from './MarkDraws'

type Fake = { finish: ReturnType<typeof vi.fn>; keyframes: unknown }

let runs: Fake[]
let frames: FrameRequestCallback[]
const realAnimate = Element.prototype.animate

beforeEach(() => {
  vi.useFakeTimers()
  runs = []
  frames = []
  Element.prototype.animate = vi.fn(function (this: Element, keyframes: unknown) {
    const a = { finish: vi.fn(), keyframes } as Fake
    runs.push(a)
    return a as unknown as Animation
  }) as unknown as typeof Element.prototype.animate
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  Element.prototype.animate = realAnimate
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const paintAFrame = () => act(() => frames.splice(0).forEach((cb) => cb(0)))

describe('MarkDraws keeps the whole mark when the page stops painting', () => {
  it('a page that paints no frame never starts the draw, so the name is never clipped', () => {
    render(<MarkDraws />)
    act(() => vi.advanceTimersByTime(5000))
    expect(runs).toHaveLength(0)
  })

  it('draws on the first painted frame, and finishes once the draw’s length has passed', () => {
    render(<MarkDraws />)
    paintAFrame()
    expect(runs).toHaveLength(4)
    act(() => vi.advanceTimersByTime(900))
    expect(runs.every((r) => r.finish.mock.calls.length === 0)).toBe(true)
    act(() => vi.advanceTimersByTime(200))
    expect(runs.every((r) => r.finish.mock.calls.length > 0)).toBe(true)
  })

  it('finishes at once when the page is hidden mid-draw', () => {
    render(<MarkDraws />)
    paintAFrame()
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(runs.every((r) => r.finish.mock.calls.length > 0)).toBe(true)
    visibility.mockRestore()
  })

  it('a still mark never animates', () => {
    render(<MarkDraws play={false} />)
    paintAFrame()
    expect(runs).toHaveLength(0)
  })
})
