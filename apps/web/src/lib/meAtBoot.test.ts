import { describe, it, expect, vi, afterEach } from 'vitest'

const refresh = vi.hoisted(() => ({ doRefresh: vi.fn() }))
vi.mock('./sessionRefresh', () => refresh)

import { readMeAtBoot, forgetMeAtBoot, ME_AT_BOOT_REUSE_MS } from './meAtBoot'

/**
 * One `/auth/me` per page load. Two boot clients (authStore and AuthContext,
 * the latter twice under StrictMode) asked three times per load, against a
 * limit of 10 a minute per address on every `/auth/` path.
 */

const ok = (who: string) => ({ data: { user: { userId: who } } })
const refused = (status: number) => Object.assign(new Error(`status ${status}`), { response: { status } })

afterEach(() => {
  vi.useRealTimers()
  forgetMeAtBoot()
  localStorage.clear()
  refresh.doRefresh.mockReset()
})

describe('readMeAtBoot', () => {
  it('three boot readers of one token make one request', async () => {
    const ask = vi.fn(async () => ok('u1'))
    const answers = await Promise.all([
      readMeAtBoot('t1', ask),
      readMeAtBoot('t1', ask),
      readMeAtBoot('t1', ask),
    ])
    expect(ask).toHaveBeenCalledTimes(1)
    expect(answers.map((a) => a.data.user.userId)).toEqual(['u1', 'u1', 'u1'])
  })

  it('a reader that arrives after the answer, within the window, shares it', async () => {
    vi.useFakeTimers()
    const ask = vi.fn(async () => ok('u1'))
    await readMeAtBoot('t1', ask)
    vi.advanceTimersByTime(ME_AT_BOOT_REUSE_MS - 1)
    await readMeAtBoot('t1', ask)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('after the window, or for another token, it asks again', async () => {
    vi.useFakeTimers()
    const ask = vi.fn(async () => ok('u1'))
    await readMeAtBoot('t1', ask)
    await readMeAtBoot('t2', ask)
    expect(ask).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(ME_AT_BOOT_REUSE_MS)
    await readMeAtBoot('t2', ask)
    expect(ask).toHaveBeenCalledTimes(3)
  })

  it('a 429 is shared: the second reader does not ask a busy gateway again', async () => {
    const first = vi.fn(async () => {
      throw refused(429)
    })
    const second = vi.fn(async () => ok('u1'))
    await expect(readMeAtBoot('t1', first)).rejects.toMatchObject({ response: { status: 429 } })
    await expect(readMeAtBoot('t1', second)).rejects.toMatchObject({ response: { status: 429 } })
    expect(second).not.toHaveBeenCalled()
  })

  it('a 401 refreshes once and every reader shares the read under the new token', async () => {
    localStorage.setItem('accessToken', 'old')
    refresh.doRefresh.mockImplementation(async () => {
      localStorage.setItem('accessToken', 'new')
      return 'new'
    })
    const ask = vi.fn(async (t: string) => {
      if (t === 'old') throw refused(401)
      return ok('u1')
    })
    const answers = await Promise.all([
      readMeAtBoot('old', ask),
      readMeAtBoot('old', ask),
      readMeAtBoot('old', ask),
    ])
    expect(answers.map((a) => a.data.user.userId)).toEqual(['u1', 'u1', 'u1'])
    expect(ask.mock.calls.map(([t]) => t)).toEqual(['old', 'new'])
  })

  it('a reader that comes after the refresh, with the stored token, shares the read and does not refresh again', async () => {
    localStorage.setItem('accessToken', 'old')
    refresh.doRefresh.mockImplementation(async () => {
      localStorage.setItem('accessToken', 'new')
      return 'new'
    })
    const ask = vi.fn(async (t: string) => {
      if (t === 'old') throw refused(401)
      return ok('u1')
    })
    await readMeAtBoot('old', ask)
    // A boot client reads the token from storage when it starts.
    await readMeAtBoot(localStorage.getItem('accessToken') as string, ask)
    expect(refresh.doRefresh).toHaveBeenCalledTimes(1)
    expect(ask.mock.calls.map(([t]) => t)).toEqual(['old', 'new'])
  })

  it('when the refresh gives no token, the 401 reaches the client (it decides sign-out)', async () => {
    localStorage.setItem('accessToken', 'old')
    refresh.doRefresh.mockResolvedValue(null)
    const ask = vi.fn(async () => {
      throw refused(401)
    })
    await expect(readMeAtBoot('old', ask)).rejects.toMatchObject({ response: { status: 401 } })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('makes one hop only: a 401 under the new token is not refreshed again', async () => {
    localStorage.setItem('accessToken', 'old')
    refresh.doRefresh.mockImplementation(async () => {
      localStorage.setItem('accessToken', 'new')
      return 'new'
    })
    const ask = vi.fn(async () => {
      throw refused(401)
    })
    await expect(readMeAtBoot('old', ask)).rejects.toMatchObject({ response: { status: 401 } })
    expect(refresh.doRefresh).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledTimes(2)
  })
})
