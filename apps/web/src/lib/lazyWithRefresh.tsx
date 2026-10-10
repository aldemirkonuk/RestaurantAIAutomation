import { lazy, useCallback, useEffect, useState, type ComponentType } from 'react'

/**
 * Wraps a dynamic import so that stale-chunk errors (after a new deploy)
 * trigger a one-time page reload instead of crashing the app.
 * Covers Chromium ("Failed to fetch dynamically imported module"),
 * Firefox ("error loading dynamically imported module"), and
 * Safari ("Importing a module script failed").
 *
 * Offline the same error means "this page was never fetched on this device",
 * not "a deploy moved it" — and a reload offline lands on the browser's own
 * "No internet" page, losing the app (F-1081). So offline it renders an
 * in-app note with Retry instead, and loads the page by itself once the
 * signal is back.
 */
export function isStaleChunkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  const lower = message.toLowerCase()
  return (
    lower.includes('text/html') ||
    lower.includes('failed to fetch dynamically imported module') ||
    lower.includes('error loading dynamically imported module') ||
    lower.includes('importing a module script failed') ||
    lower.includes('loading chunk') ||
    lower.includes('chunkloaderror')
  )
}

/** `navigator.onLine === false` only — an unknown state is treated as online. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** The page whose code is not on this device yet, while there is no signal. */
function offlinePage<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): ComponentType<any> {
  return function NotOnThisDeviceYet(props: Record<string, unknown>) {
    const [Loaded, setLoaded] = useState<T | null>(null)
    const [trying, setTrying] = useState(false)

    const tryLoad = useCallback(() => {
      setTrying(true)
      factory()
        .then((mod) => setLoaded(() => mod.default))
        .catch(() => undefined)
        .finally(() => setTrying(false))
    }, [])

    useEffect(() => {
      // Mounted again after the signal came back: open the page straight away.
      if (!isOffline()) tryLoad()
      window.addEventListener('online', tryLoad)
      return () => window.removeEventListener('online', tryLoad)
    }, [tryLoad])

    if (Loaded) {
      const Page = Loaded as ComponentType<any>
      return <Page {...props} />
    }
    return (
      <div role="status" style={{ padding: '48px 16px', maxWidth: 480, margin: '0 auto', color: 'var(--ink-1)' }}>
        <p style={{ fontWeight: 600, margin: '0 0 8px' }}>You are offline.</p>
        <p style={{ margin: '0 0 16px' }}>
          This page is not on this phone yet. It opens when the signal is back.
        </p>
        <button type="button" onClick={tryLoad} disabled={trying}>
          {trying ? 'Trying…' : 'Try again'}
        </button>
      </div>
    )
  }
}

export function lazyWithRefresh<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(() =>
    factory()
      .then((mod) => {
        // Successful load after a deploy-recovery reload — allow future recoveries.
        sessionStorage.removeItem('chunk_reload')
        return mod
      })
      .catch((err: Error) => {
        if (isStaleChunkError(err) && isOffline()) {
          return { default: offlinePage(factory) as unknown as T }
        }
        if (isStaleChunkError(err) && !sessionStorage.getItem('chunk_reload')) {
          sessionStorage.setItem('chunk_reload', '1')
          window.location.reload()
          // Return a never-resolving promise so React doesn't render anything
          return new Promise<never>(() => {})
        }

        throw err
      })
  )
}

/**
 * Fetches a route's code ahead of the tap that needs it: now if there is
 * signal, else the next time the signal comes back. The service worker keeps
 * `/assets/*` once fetched, so the page opens later without signal (F-1081:
 * the door, opened from /receiving in a cellar with no signal). Returns the
 * effect cleanup.
 */
export function prefetchWhenOnline(load: () => Promise<unknown>): () => void {
  const run = () => {
    load().catch(() => undefined)
  }
  if (!isOffline()) {
    run()
    return () => undefined
  }
  window.addEventListener('online', run, { once: true })
  return () => window.removeEventListener('online', run)
}
