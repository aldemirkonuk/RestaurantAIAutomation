/**
 * F-1081: a route chunk that fails to load offline is "not on this device
 * yet", not a stale deploy. Reloading then lands on the browser's "No
 * internet" page and the app is gone, so offline the page says so in place
 * and opens itself once the signal is back.
 */
import { Suspense } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lazyWithRefresh, prefetchWhenOnline } from './lazyWithRefresh'

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/DoorNext-abc.js')

let online = true
let reload: ReturnType<typeof vi.fn>

beforeEach(() => {
  online = true
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  sessionStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function Door({ who }: { who: string }) {
  return <p>door for {who}</p>
}

describe('lazyWithRefresh offline (F-1081)', () => {
  it('offline, a missing chunk shows the in-app note and never reloads', async () => {
    online = false
    const Page = lazyWithRefresh(() => Promise.reject(chunkError()))
    render(
      <Suspense fallback={null}>
        <Page />
      </Suspense>,
    )
    expect(await screen.findByText('You are offline.')).toBeInTheDocument()
    expect(screen.getByText(/This page is not on this phone yet/)).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('chunk_reload')).toBeNull()
  })

  it('opens the page by itself when the signal comes back', async () => {
    online = false
    const factory = vi
      .fn<() => Promise<{ default: typeof Door }>>()
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValue({ default: Door })
    const Page = lazyWithRefresh(factory)
    render(
      <Suspense fallback={null}>
        <Page who="Ayse" />
      </Suspense>,
    )
    await screen.findByText('You are offline.')
    online = true
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByText('door for Ayse')).toBeInTheDocument()
  })

  it('Try again loads the page once it can', async () => {
    online = false
    const factory = vi
      .fn<() => Promise<{ default: typeof Door }>>()
      .mockRejectedValueOnce(chunkError())
      .mockRejectedValueOnce(chunkError())
      .mockResolvedValue({ default: Door })
    const Page = lazyWithRefresh(factory)
    render(
      <Suspense fallback={null}>
        <Page who="Ayse" />
      </Suspense>,
    )
    await screen.findByText('You are offline.')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    expect(screen.getByText('You are offline.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    expect(await screen.findByText('door for Ayse')).toBeInTheDocument()
  })

  it('online, a stale chunk still reloads once (the deploy case)', async () => {
    const Page = lazyWithRefresh(() => Promise.reject(chunkError()))
    render(
      <Suspense fallback={null}>
        <Page />
      </Suspense>,
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('chunk_reload')).toBe('1')
  })
})

describe('prefetchWhenOnline (F-1081)', () => {
  it('fetches now when there is signal', () => {
    const load = vi.fn(() => Promise.resolve())
    prefetchWhenOnline(load)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('without signal, fetches when the signal comes back, once', () => {
    online = false
    const load = vi.fn(() => Promise.resolve())
    prefetchWhenOnline(load)
    expect(load).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('online'))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a failed prefetch is swallowed', async () => {
    const load = vi.fn(() => Promise.reject(chunkError()))
    expect(() => prefetchWhenOnline(load)).not.toThrow()
    await Promise.resolve()
  })
})
