import { lazy, type ComponentType } from 'react'

/**
 * Wraps a dynamic import so that stale-chunk errors (after a new deploy)
 * trigger a one-time page reload instead of crashing the app.
 * Covers Chromium ("Failed to fetch dynamically imported module"),
 * Firefox ("error loading dynamically imported module"), and
 * Safari ("Importing a module script failed").
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
