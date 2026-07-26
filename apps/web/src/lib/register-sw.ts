/**
 * Register the PWA service worker with a safe update path.
 * Skips registration in Vite dev (HMR conflicts) unless explicitly forced.
 *
 * When a new SW takes over an existing controller, reload once so the page
 * picks up fresh index.html / asset hashes instead of a stale document shell.
 */
export function registerServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return

  const isDev = import.meta.env.DEV
  if (isDev && import.meta.env.VITE_FORCE_SW !== '1') return

  // Only auto-reload on *updates* (page already had a controlling SW)
  if (navigator.serviceWorker.controller) {
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return
      refreshing = true
      window.location.reload()
    })
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        void reg.update()

        reg.addEventListener('updatefound', () => {
          const worker = reg.installing
          if (!worker) return
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              console.info('[sw] Update ready — reloading')
            }
          })
        })
      })
      .catch((err) => {
        console.warn('[sw] Registration failed', err)
      })
  })
}
