import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { ThemeProvider, useTheme } from './ThemeContext'
import { ReactNode } from 'react'

describe('ThemeContext', () => {
  const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  }

  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    })

    // Mock matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('provides theme context', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      ),
    })

    expect(result.current.theme).toBeDefined()
    expect(result.current.resolvedTheme).toBeDefined()
    expect(typeof result.current.setTheme).toBe('function')
    expect(typeof result.current.toggleTheme).toBe('function')
  })

  it('defaults to light theme', () => {
    localStorageMock.getItem.mockReturnValue(null)

    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      ),
    })

    expect(result.current.theme).toBe('light')
    expect(result.current.resolvedTheme).toBe('light')
  })

  it('allows setting theme', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      ),
    })

    act(() => {
      result.current.setTheme('dark')
    })

    waitFor(() => {
      expect(result.current.theme).toBe('dark')
      expect(result.current.resolvedTheme).toBe('dark')
      expect(localStorageMock.setItem).toHaveBeenCalledWith('wineops-theme', 'dark')
    })
  })

  it('toggles theme between light and dark', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ThemeProvider>{children}</ThemeProvider>
      ),
    })

    // Set to light first
    act(() => {
      result.current.setTheme('light')
    })

    // Toggle to dark
    act(() => {
      result.current.toggleTheme()
    })

    waitFor(() => {
      expect(result.current.theme).toBe('dark')
    })
  })

  // ADR 0169 amendment 2026-10-01 (batch 4) — founder: "Reset once, Mudavym
  // only". #576 removed the last control for this theme, so a browser holding
  // dark/system here (even one that already ran the v2 reset) goes back to
  // light exactly once, and a later choice is then left alone.
  describe('the v3 reset', () => {
    function backedBy(initial: Record<string, string>) {
      const store = new Map(Object.entries(initial))
      localStorageMock.getItem.mockImplementation((k: string) => store.get(k) ?? null)
      localStorageMock.setItem.mockImplementation((k: string, v: string) => {
        store.set(k, v)
      })
      return store
    }
    const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>

    it('resets a browser that ran the v2 reset and then stored dark, once', () => {
      const store = backedBy({ 'wineops-theme-v2': '1', 'wineops-theme': 'dark' })
      const first = renderHook(() => useTheme(), { wrapper })
      expect(first.result.current.theme).toBe('light')
      expect(store.get('wineops-theme-v3')).toBe('1')
      expect(store.get('wineops-theme')).toBe('light')
      first.unmount()

      // The reset is spent: a later stored theme is honoured, not reset again.
      store.set('wineops-theme', 'dark')
      localStorageMock.setItem.mockClear()
      const second = renderHook(() => useTheme(), { wrapper })
      expect(second.result.current.theme).toBe('dark')
      expect(localStorageMock.setItem).not.toHaveBeenCalledWith('wineops-theme-v3', '1')
      second.unmount()
    })

    it('resets a stored system theme too', () => {
      const store = backedBy({ 'wineops-theme-v2': '1', 'wineops-theme': 'system' })
      const { result } = renderHook(() => useTheme(), { wrapper })
      expect(result.current.theme).toBe('light')
      expect(store.get('wineops-theme')).toBe('light')
    })
  })

  it('throws error when used outside provider', () => {
    // Suppress console.error for this test
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useTheme())
    }).toThrow('useTheme must be used within a ThemeProvider')

    consoleError.mockRestore()
  })
})
