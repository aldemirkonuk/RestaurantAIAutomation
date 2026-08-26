import type { Decorator } from '@storybook/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '../src/contexts/ThemeContext'
import { ToastProvider } from '../src/contexts/ToastContext'
import { AuthContext, type AuthContextType, type User } from '../src/contexts/AuthContext'
import { fallbackSignInMethods } from '../src/lib/identityProviders'

/**
 * Storybook's stand-in for the provider stack App.tsx mounts.
 *
 * Ordering mirrors App.tsx (Theme > Query > Toast > Auth > Router) so stories
 * see the same context topology as production. WebSocketProvider and
 * RealtimeProvider are deliberately omitted: they open live connections, and
 * the only consumer among our stories (`useRealtimeDispatch`) already degrades
 * to no-ops when its provider is absent.
 */

const MOCK_USER: User = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'sommelier@example.com',
  name: 'Alex Sommelier',
  role: 'owner',
  restaurantId: '00000000-0000-4000-8000-000000000010',
  emailVerified: true,
}

const noop = async () => {}
// `clearError` is synchronous in AuthContextType, so it needs its own stub
// rather than reusing the async `noop`.
const syncNoop = () => {}

/**
 * A fully-populated auth context. We inject the value rather than mounting the
 * real AuthProvider because that provider bootstraps from localStorage and
 * calls /api/v1/auth/me — in Storybook there is no gateway, so it would settle
 * into a logged-out state and every auth-gated story would render its signed
 * -out branch instead of the UI the story is documenting.
 */
export const mockAuthValue: AuthContextType = {
  user: MOCK_USER,
  loading: false,
  error: null,
  clearError: syncNoop,
  activeRestaurantId: MOCK_USER.restaurantId,
  activeRole: 'owner',
  availableRestaurants: [
    {
      id: MOCK_USER.restaurantId,
      name: 'Auberge du Vin',
      city: 'San Francisco',
      chain_id: null,
      chain_name: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000011',
      name: 'Auberge du Vin — Napa',
      city: 'Napa',
      chain_id: 'chain-1',
      chain_name: 'Auberge Group',
    },
  ],
  setActiveRestaurantId: noop,
  login: noop,
  register: noop,
  registerRestaurant: noop,
  joinViaInvite: noop,
  loginWithGoogle: noop,
  loginWithMicrosoft: noop,
  // Storybook has no gateway, so this resolves the way the real client does
  // when the call fails: the standard set, flagged `assumed`. See ADR 0024.
  resolveSignInMethods: async (email: string) => fallbackSignInMethods(email),
  logout: noop,
  refreshToken: noop,
  refreshBranches: noop,
  isAuthenticated: true,
}

/**
 * A fresh QueryClient per story keeps one story's cached (or failed) queries
 * from leaking into the next. Retries are off: there is no API behind
 * Storybook, so every query is expected to fail, and retrying only delays the
 * component's empty state.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, throwOnError: false, staleTime: Infinity },
      mutations: { retry: false, throwOnError: false },
    },
  })
}

export const withProviders: Decorator = (Story) => (
  <ThemeProvider>
    <QueryClientProvider client={makeQueryClient()}>
      <ToastProvider>
        <AuthContext.Provider value={mockAuthValue}>
          <MemoryRouter>
            <Story />
          </MemoryRouter>
        </AuthContext.Provider>
      </ToastProvider>
    </QueryClientProvider>
  </ThemeProvider>
)
