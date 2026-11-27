import { describe, expect, it, vi } from 'vitest'
import { captureInstallPrompt, hasInstallPrompt, showInstallPrompt } from './installPrompt'

describe('installPrompt', () => {
  it('keeps the event, stops the mini-infobar, and shows it once', async () => {
    captureInstallPrompt()
    expect(hasInstallPrompt()).toBe(false)
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: vi.fn().mockResolvedValue(undefined) })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(hasInstallPrompt()).toBe(true)
    expect(await showInstallPrompt()).toBe(true)
    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(hasInstallPrompt()).toBe(false)
    expect(await showInstallPrompt()).toBe(false)
  })
})
