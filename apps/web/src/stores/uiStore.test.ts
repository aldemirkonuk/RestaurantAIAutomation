import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `ui-storage` is the second writer of `html.dark` (ADR 0169 batch 4): the
 * store re-applies its persisted theme on every load. With the theme control
 * gone, version 2 resets a stored dark or system to light exactly once —
 * alongside ThemeContext's `wineops-theme-v3`.
 */
async function loadStoreWith(persisted: unknown) {
  localStorage.setItem('ui-storage', JSON.stringify(persisted))
  vi.resetModules()
  const { useUIStore } = await import('./uiStore')
  return useUIStore
}

describe('ui-storage version 2 resets the legacy theme once', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })
  afterEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
  })

  it.each(['dark', 'system'] as const)(
    'a v1 browser that stored %s comes back light, keeping its sidebar',
    async (theme) => {
      document.documentElement.classList.add('dark')
      const store = await loadStoreWith({ state: { theme, sidebarCollapsed: true }, version: 1 })

      expect(store.getState().theme).toBe('light')
      expect(store.getState().sidebarCollapsed).toBe(true)
      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(JSON.parse(localStorage.getItem('ui-storage') ?? '{}').version).toBe(2)
    },
  )

  it('a browser already on v2 is not reset again', async () => {
    const store = await loadStoreWith({ state: { theme: 'dark', sidebarCollapsed: false }, version: 2 })

    expect(store.getState().theme).toBe('dark')
  })
})
