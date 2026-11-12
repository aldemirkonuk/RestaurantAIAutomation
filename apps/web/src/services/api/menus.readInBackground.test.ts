/**
 * The client half of "a menu read runs in the background" (founder,
 * 2026-11-07: "Background job"). The gateway answers a scan at once with the
 * version it is reading; the page waits on GET /menu-versions/:id/read in
 * short polls, so no read is cut off by the client's 30-second timeout, and a
 * failed read reaches every caller shaped like the gateway's own 422.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { importMenu, MAX_MISSED_POLLS, MenuReadFailed, readRefusalWords, waitForRead } from './menus'
import { apiClient } from './client'

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...actual,
    getActiveRestaurantId: () => 'r1',
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  }
})

const get = vi.mocked(apiClient.get)
const post = vi.mocked(apiClient.post)
const noSleep = async () => {}

beforeEach(() => {
  get.mockReset()
  post.mockReset()
})

function status(state: 'reading' | 'done' | 'failed', over: Record<string, unknown> = {}) {
  return { data: { menuId: 'm1', state, failure: null, warnings: [], reply: null, ...over } }
}

describe('waitForRead', () => {
  it('waits while reading and returns the reply the read kept', async () => {
    const reply = { menuId: 'm1', current: false, itemsExtracted: 7, submissionsCreated: 0, items: [], warnings: [] }
    get
      .mockResolvedValueOnce(status('reading'))
      .mockResolvedValueOnce(status('reading'))
      .mockResolvedValueOnce(status('done', { reply }))
    await expect(waitForRead('m1', { sleep: noSleep })).resolves.toEqual(reply)
    expect(get).toHaveBeenCalledTimes(3)
    expect(get).toHaveBeenCalledWith('/menu-versions/m1/read')
  })

  it('a failed read throws the gateway words and its warnings, shaped like a 422', async () => {
    const warnings = [{ kind: 'chunk_failed', pages: { first: 2, last: 2 } }]
    get.mockResolvedValueOnce(status('failed', { failure: 'No menu line could be read from this file.', warnings }))
    const err = await waitForRead('m1', { sleep: noSleep }).catch((e) => e)
    expect(err).toBeInstanceOf(MenuReadFailed)
    expect(err.response.status).toBe(422)
    expect(err.response.data.message).toBe('No menu line could be read from this file.')
    expect(readRefusalWords(err, 'x')).toBe(
      'No menu line could be read from this file. Page 2 could not be read; send it again.',
    )
  })

  it('a missed poll is not a failure; a vanished read is', async () => {
    const reply = { menuId: 'm1', itemsExtracted: 1, submissionsCreated: 0, items: [] }
    get.mockRejectedValueOnce({ response: { status: 502 } }).mockResolvedValueOnce(status('done', { reply }))
    await expect(waitForRead('m1', { sleep: noSleep })).resolves.toEqual(reply)
    get.mockReset()
    get.mockRejectedValueOnce({ response: { status: 404 } })
    await expect(waitForRead('m1', { sleep: noSleep })).rejects.toEqual({ response: { status: 404 } })
  })

  it('a refused poll (session ended, role lost) ends the wait at once; a throttle or timeout is retried', async () => {
    get.mockRejectedValueOnce({ response: { status: 401 } })
    await expect(waitForRead('m1', { sleep: noSleep })).rejects.toEqual({ response: { status: 401 } })
    get.mockReset()
    get.mockRejectedValueOnce({ response: { status: 403 } })
    await expect(waitForRead('m1', { sleep: noSleep })).rejects.toEqual({ response: { status: 403 } })
    expect(get).toHaveBeenCalledTimes(1)
    get.mockReset()
    const reply = { menuId: 'm1', itemsExtracted: 1, submissionsCreated: 0, items: [] }
    get
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockRejectedValueOnce({ response: { status: 408 } })
      .mockResolvedValueOnce(status('done', { reply }))
    await expect(waitForRead('m1', { sleep: noSleep })).resolves.toEqual(reply)
  })

  it('a server that keeps failing ends the wait after MAX_MISSED_POLLS in a row, saying the read goes on', async () => {
    get.mockRejectedValue({ response: { status: 503 } })
    const err = await waitForRead('m1', { sleep: noSleep }).catch((e) => e)
    expect(err).toBeInstanceOf(MenuReadFailed)
    expect(err.response.status).toBe(202)
    expect(err.message).toMatch(/Lost touch with the read/)
    expect(get).toHaveBeenCalledTimes(MAX_MISSED_POLLS)
    get.mockReset()
    // One answer in between starts the count again.
    const failures = Array.from({ length: MAX_MISSED_POLLS - 1 }, () => ({ response: { status: 503 } }))
    const reply = { menuId: 'm1', itemsExtracted: 1, submissionsCreated: 0, items: [] }
    for (const f of failures) get.mockRejectedValueOnce(f)
    get.mockResolvedValueOnce(status('reading'))
    for (const f of failures) get.mockRejectedValueOnce(f)
    get.mockResolvedValueOnce(status('done', { reply }))
    await expect(waitForRead('m1', { sleep: noSleep })).resolves.toEqual(reply)
  })

  it('after twenty minutes it stops waiting and says the read goes on (202, not a failure)', async () => {
    let t = 0
    get.mockImplementation(async () => {
      t += 6 * 60 * 1000
      return status('reading')
    })
    const err = await waitForRead('m1', { sleep: noSleep, now: () => t }).catch((e) => e)
    expect(err).toBeInstanceOf(MenuReadFailed)
    expect(err.response.status).toBe(202)
    expect(err.message).toMatch(/The read goes on/)
  })
})

describe('importMenu', () => {
  it('a csv answer is returned as it came, with no poll', async () => {
    post.mockResolvedValueOnce({ data: { menuId: 'm2', current: false, itemsExtracted: 3, submissionsCreated: 0, items: [] } })
    const r = await importMenu('csv', { csvContent: 'a,b' })
    expect(r.itemsExtracted).toBe(3)
    expect(get).not.toHaveBeenCalled()
  })

  it('a scan being read says so once, waits, and keeps the page count; readAgain is sent only when asked', async () => {
    post.mockResolvedValueOnce({ data: { menuId: 'm3', current: false, reading: true, pages: 3, itemsExtracted: 0, submissionsCreated: 0, items: [] } })
    get.mockResolvedValueOnce(status('done', { menuId: 'm3', reply: { menuId: 'm3', itemsExtracted: 40, submissionsCreated: 0, items: [] } }))
    const onReading = vi.fn()
    vi.useFakeTimers()
    const p = importMenu('scan', { images: ['a', 'b', 'c'] }, { readAgain: true, onReading })
    await vi.runAllTimersAsync()
    const r = await p
    vi.useRealTimers()
    expect(onReading).toHaveBeenCalledWith('m3')
    expect(r).toMatchObject({ menuId: 'm3', itemsExtracted: 40, pages: 3 })
    expect(post.mock.calls[0][1]).toMatchObject({ method: 'scan', data: { images: ['a', 'b', 'c'] }, readAgain: true })
    expect(post.mock.calls[0][1]).not.toHaveProperty('onReading')
  })
})

describe('readRefusalWords', () => {
  it('falls back in order and skips a null warning', () => {
    expect(readRefusalWords({ response: { data: { message: ['first', 'second'], warnings: [null] } } }, 'x')).toBe('first')
    expect(readRefusalWords({ message: 'net down' }, 'x')).toBe('net down')
    expect(readRefusalWords({}, 'fallback')).toBe('fallback')
  })
})
