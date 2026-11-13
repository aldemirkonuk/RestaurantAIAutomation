import { afterEach, describe, expect, it, vi } from 'vitest'
import { lockBodyScroll, whenBodyScrollUnlocked } from './overlayState'

/** r26 walk: a ?tab= scroll asked for under the theme prompt waits for it to close. */
describe('whenBodyScrollUnlocked', () => {
  const releases: Array<() => void> = []
  afterEach(() => {
    while (releases.length) releases.pop()!()
  })

  it('runs at once when nothing holds the body', () => {
    const fn = vi.fn()
    whenBodyScrollUnlocked(fn)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('waits for the last of two locks, then runs once, after the body scrolls again', () => {
    const a = lockBodyScroll()
    const b = lockBodyScroll()
    releases.push(a, b)
    let overflowWhenRun: string | null = null
    const fn = vi.fn(() => {
      overflowWhenRun = document.body.style.overflow
    })
    whenBodyScrollUnlocked(fn)
    expect(fn).not.toHaveBeenCalled()
    a()
    expect(fn).not.toHaveBeenCalled()
    b()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(overflowWhenRun).not.toBe('hidden')
    lockBodyScroll()()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('a cancelled wait never runs', () => {
    const release = lockBodyScroll()
    const fn = vi.fn()
    const cancel = whenBodyScrollUnlocked(fn)
    cancel()
    release()
    expect(fn).not.toHaveBeenCalled()
  })
})
