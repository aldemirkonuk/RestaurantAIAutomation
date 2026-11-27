/**
 * Holds the browser's install prompt (Chromium's `beforeinstallprompt`) so a
 * row on /house can offer it later, on a press. The event fires once, early,
 * and only on Chromium; iOS Safari has none (the row says the steps in words).
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
}

let saved: InstallPromptEvent | null = null

export function captureInstallPrompt(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    saved = event as InstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    saved = null
  })
}

export function hasInstallPrompt(): boolean {
  return saved !== null
}

/** Shows the saved prompt once. A prompt can be used one time, so it is dropped. */
export async function showInstallPrompt(): Promise<boolean> {
  const event = saved
  if (!event) return false
  saved = null
  try {
    await event.prompt()
    return true
  } catch {
    return false
  }
}
