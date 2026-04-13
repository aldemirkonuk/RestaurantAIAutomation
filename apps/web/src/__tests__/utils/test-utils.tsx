import { ReactElement, ReactNode } from 'react'
import { render, RenderOptions } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { ThemeProvider } from '../../contexts/ThemeContext'
import { AuthProvider } from '../../contexts/AuthContext'
import { RealtimeProvider } from '../../contexts/RealtimeContext'
import { vi } from 'vitest'

// Mock Supabase client
export const mockSupabaseClient = {
  auth: {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  },
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
  channel: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
    unsubscribe: vi.fn(),
  })),
}

// Mock authenticated user
export const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  restaurantId: 'test-restaurant-id',
  role: 'manager' as const,
}

interface AllTheProvidersProps {
  children: ReactNode
}

/**
 * Provider wrapper for tests
 * Includes all necessary providers: Router, Theme, Auth, Realtime
 */
function AllTheProviders({ children }: AllTheProvidersProps) {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <RealtimeProvider>
            {children}
          </RealtimeProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}

/**
 * Custom render function that wraps components with all providers
 * 
 * @example
 * const { getByText } = renderWithProviders(<MyComponent />)
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllTheProviders, ...options })
}

/**
 * Render with authenticated user context
 */
export function renderWithAuth(
  ui: ReactElement,
  user = mockUser,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  // Mock the auth context to return the user
  vi.mock('../../contexts/AuthContext', () => ({
    useAuth: () => ({ user, loading: false }),
    AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  }))

  return renderWithProviders(ui, options)
}

/**
 * Wait for async operations to complete
 * Useful for testing components with useEffect or data fetching
 */
export const waitForAsync = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Mock window.matchMedia for testing theme and responsive components
 */
export function mockMatchMedia(matches: boolean = false) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })
}

/**
 * Mock localStorage for testing
 */
export function mockLocalStorage() {
  const store: Record<string, string> = {}

  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach((key) => delete store[key])
    }),
  }
}

/**
 * Create mock router location
 */
export function createMockLocation(pathname: string = '/') {
  return {
    pathname,
    search: '',
    hash: '',
    state: null,
    key: 'default',
  }
}

/**
 * Helper to fire keyboard events
 */
export function fireKeyboardEvent(element: Element, key: string, code?: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: code || key,
    bubbles: true,
    cancelable: true,
  })
  element.dispatchEvent(event)
}

// Re-export everything from testing library
export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'
