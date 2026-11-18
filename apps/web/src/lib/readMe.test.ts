import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ME_REUSE_MS, ME_RETRY_DELAYS_MS, readMe, resetReadMe } from './readMe'

const refusal = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } })

beforeEach(() => {
  vi.useFakeTimers()
  resetReadMe()
  localStorage.setItem('accessToken', 't1')
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('readMe', () => {
  it('shares one read between callers asking for the same session at once', async () => {
    const get = vi.fn().mockResolvedValue({ data: { user: { id: 1 } } })
    const [a, b, c] = await Promise.all([readMe({ get }), readMe({ get }), readMe({ get })])
    expect(get).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('reuses a read that just succeeded, then asks again once the window has passed', async () => {
    const get = vi.fn().mockResolvedValue({ data: {} })
    await readMe({ get })
    await readMe({ get })
    expect(get).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(ME_REUSE_MS + 1)
    await readMe({ get })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('a different token is a different session and is read again', async () => {
    const get = vi.fn().mockResolvedValue({ data: {} })
    await readMe({ get })
    localStorage.setItem('accessToken', 't2')
    await readMe({ get })
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('waits out a 429 on 400, 800, 1600 ms and says it is settling', async () => {
    expect(ME_RETRY_DELAYS_MS).toEqual([400, 800, 1600])
    const get = vi
      .fn()
      .mockRejectedValueOnce(refusal(429))
      .mockRejectedValueOnce(refusal(429))
      .mockRejectedValueOnce(refusal(429))
      .mockResolvedValue({ data: { ok: true } })
    const told: boolean[] = []
    const p = readMe({ get }, { onSettling: (v) => told.push(v) })
    await vi.advanceTimersByTimeAsync(0)
    expect(get).toHaveBeenCalledTimes(1)
    expect(told).toEqual([true])
    await vi.advanceTimersByTimeAsync(399)
    expect(get).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(get).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(800)
    expect(get).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1600)
    await expect(p).resolves.toEqual({ data: { ok: true } })
    expect(get).toHaveBeenCalledTimes(4)
    expect(told).toEqual([true, false])
  })

  it('gives up after the last delay and passes the 429 on', async () => {
    const get = vi.fn().mockRejectedValue(refusal(429))
    const p = readMe({ get })
    const caught = p.catch((e) => e)
    await vi.advanceTimersByTimeAsync(400 + 800 + 1600)
    expect((await caught).response.status).toBe(429)
    expect(get).toHaveBeenCalledTimes(4)
  })

  it('never retries a 401 or a 500, and never reuses a failed read', async () => {
    for (const status of [401, 500]) {
      resetReadMe()
      const get = vi.fn().mockRejectedValue(refusal(status))
      await expect(readMe({ get })).rejects.toMatchObject({ response: { status } })
      expect(get).toHaveBeenCalledTimes(1)
      await expect(readMe({ get })).rejects.toBeTruthy()
      expect(get).toHaveBeenCalledTimes(2)
    }
  })

  it('callers on the same client share a refusal too: one read, not one each', async () => {
    const get = vi.fn().mockRejectedValue(refusal(500))
    const api = { get }
    const results = await Promise.allSettled([readMe(api), readMe(api)])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("another client's refusal is not inherited: the second client asks again with its own", async () => {
    const first = vi.fn().mockRejectedValue(refusal(401))
    const second = vi.fn().mockResolvedValue({ data: { mended: true } })
    const a = readMe({ get: first }).catch(() => 'refused')
    const b = readMe({ get: second })
    expect(await a).toBe('refused')
    expect(await b).toEqual({ data: { mended: true } })
    expect(second).toHaveBeenCalledTimes(1)
  })
})
