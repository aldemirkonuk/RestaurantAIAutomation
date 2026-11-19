import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAGE_TURN, canTurnPage, createPageTurn } from './viewTransition'

type Doc = { startViewTransition?: unknown }

function fakeTransition() {
  let release: () => void = () => {}
  const finished = new Promise<void>((res) => {
    release = res
  })
  let update: () => Promise<void> | void = () => {}
  const start = vi.fn((cb: () => Promise<void> | void): { finished: Promise<void> } => {
    update = cb
    return { finished }
  })
  return { start, release, runUpdate: () => update() }
}

const realMatchMedia = window.matchMedia
function motion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), addEventListener() {}, removeEventListener() {} })) as never
}
beforeEach(() => motion(false))

afterEach(() => {
  window.matchMedia = realMatchMedia
  document.body.innerHTML = ''
  delete (document as unknown as Doc).startViewTransition
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('canTurnPage', () => {
  it('is false without the API', () => {
    expect(canTurnPage(document)).toBe(false)
  })
  it('is true with the API and false under reduced motion', () => {
    ;(document as unknown as Doc).startViewTransition = vi.fn()
    expect(canTurnPage(document)).toBe(true)
    motion(true)
    expect(canTurnPage(document)).toBe(false)
  })
})

describe('createPageTurn', () => {
  it('applies at once when the browser cannot turn pages', () => {
    const apply = vi.fn()
    createPageTurn(document).run(apply)
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('applies only inside the transition, after the old page is captured', async () => {
    const t = fakeTransition()
    ;(document as unknown as Doc).startViewTransition = t.start
    const apply = vi.fn()
    createPageTurn(document).run(apply)
    expect(t.start).toHaveBeenCalledTimes(1)
    expect(apply).not.toHaveBeenCalled()
    void t.runUpdate()
    expect(apply).toHaveBeenCalledTimes(1)
  })

  it('moves the page-title name from the old H1 to the new one when the new page commits', async () => {
    document.body.innerHTML = '<h1 id="a">Sign in</h1>'
    const t = fakeTransition()
    ;(document as unknown as Doc).startViewTransition = t.start
    const turn = createPageTurn(document)
    turn.run(() => {
      document.body.innerHTML = '<h1 id="b">Create your account</h1>'
    })
    expect((document.getElementById('a')!.style as unknown as { viewTransitionName: string }).viewTransitionName).toBe(PAGE_TURN.titleName)
    const settled = t.runUpdate() as Promise<void>
    turn.committed()
    // Settled by the commit itself, not by the holdMs fallback.
    const early = await Promise.race([settled.then(() => 'commit'), new Promise((r) => setTimeout(() => r('timer'), 60))])
    expect(early).toBe('commit')
    expect((document.getElementById('b')!.style as unknown as { viewTransitionName: string }).viewTransitionName).toBe(PAGE_TURN.titleName)
    t.release()
    await Promise.resolve()
    await Promise.resolve()
    expect((document.getElementById('b')!.style as unknown as { viewTransitionName: string }).viewTransitionName).toBe('')
  })

  it('holds the old page no longer than holdMs when the new one is slow', async () => {
    vi.useFakeTimers()
    const t = fakeTransition()
    ;(document as unknown as Doc).startViewTransition = t.start
    createPageTurn(document).run(() => {})
    let done = false
    void (t.runUpdate() as Promise<void>).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(PAGE_TURN.holdMs - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(done).toBe(true)
  })

  it('does not start a second transition while one is turning', () => {
    const t = fakeTransition()
    ;(document as unknown as Doc).startViewTransition = t.start
    const turn = createPageTurn(document)
    turn.run(() => {})
    const second = vi.fn()
    turn.run(second)
    expect(t.start).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })
})
