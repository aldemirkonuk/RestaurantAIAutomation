import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * A read-only MIRROR of the session that `AuthContext` owns.
 *
 * This store used to run its own bootstrap: a module-level `loadUser()` fired
 * on import (and the `@/stores` barrel is imported by AuthContext itself, so it
 * fired on every route), made a second GET /auth/me through a private axios
 * instance, and on any failure other than a recovered 401 wiped BOTH tokens
 * and hard-navigated to /login. AuthContext had already been taught that only a
 * 401 means "you are not who you said you were" — a 429, a 500 or a dropped
 * connection say "ask again later" — so the store's twin defeated that fix
 * whenever the two calls disagreed.
 *
 * The store now makes no request, holds no token and never navigates. Two
 * fields are read across the app (`user` and `activeRestaurantId`); AuthContext
 * is the only writer of both. Do not add a fetch, a redirect or a token write
 * here — a second session owner is how the defect above got in.
 */

export interface User {
  userId: string
  email: string
  name: string
  role: 'owner' | 'manager' | 'staff'
  restaurantId: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface AuthState {
  user: User | null
  activeRestaurantId: string | null

  setUser: (user: User | null) => void
  /** Records the branch the user picked. Ignores anything that is not a UUID. */
  setActiveRestaurantId: (restaurantId: string) => void
  /**
   * Mirror AuthContext's resolved session. `null` clears the mirror. When the
   * store has no active restaurant yet it is seeded from the user's own
   * restaurant, in memory only — AuthContext owns the localStorage key that
   * drives the X-Restaurant-Id header.
   */
  syncSession: (user: User | null) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      activeRestaurantId: null,

      setUser: (user) => set({ user }),

      setActiveRestaurantId: (restaurantId) => {
        if (!UUID_RE.test(restaurantId)) {
          return
        }
        set({ activeRestaurantId: restaurantId })
        localStorage.setItem('activeRestaurantId', restaurantId)
      },

      syncSession: (user) => {
        if (!user) {
          set({ user: null, activeRestaurantId: null })
          return
        }
        const seed =
          !get().activeRestaurantId && UUID_RE.test(user.restaurantId)
            ? user.restaurantId
            : get().activeRestaurantId
        set({ user, activeRestaurantId: seed })
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        activeRestaurantId: state.activeRestaurantId,
      }),
    }
  )
)
