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

  it('throws error when used outside provider', () => {
    // Suppress console.error for this test
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      renderHook(() => useTheme())
    }).toThrow('useTheme must be used within a ThemeProvider')

    consoleError.mockRestore()
  })
})
