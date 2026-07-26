/**
 * Register the PWA service worker with a safe update path.
 * Skips registration in Vite dev (HMR conflicts) unless explicitly forced.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const isDev = import.meta.env.DEV
  if (isDev && import.meta.env.VITE_FORCE_SW !== '1') return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing
          if (!worker) return
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              // New content available — next refresh picks it up (skipWaiting in sw.js)
              console.info('[sw] Update ready')
            }
          })
        })
      })
      .catch((err) => {
        console.warn('[sw] Registration failed', err)
      })
  })
}
