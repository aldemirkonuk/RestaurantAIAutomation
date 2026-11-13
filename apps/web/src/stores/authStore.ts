import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { AUTH_STORAGE_KEY } from '../lib/deadSession'

/**
 * A copy of the session for code that cannot call `useAuth()`: hooks read
 * `user.userId` and `activeRestaurantId` from here, and `reminder-scheduler`
 * reads it outside React.
 *
 * The session has ONE owner, `AuthProvider` (contexts/AuthContext.tsx). It
 * reads `/auth/me`, signs in, refreshes and signs out, and it writes this copy
 * through `followSession` and `setActiveRestaurantId`. This store does no
 * network work of its own.
 *
 * It used to: a second `loadUser` ran at import time and read `/auth/me` again
 * on every page load (two reads per load, measured r18 2026-11-13). Because it
 * ran before `applyDevAuthBypass` stored a token, and because nothing cleared
 * it at sign-out, the copy could be empty for a person who had just signed in
 * and could still name the last person after a sign-out on a shared device.
 */
export interface User {
  userId: string
  email: string
  name: string
  /** The role in the session's house; null for a session in no house. */
  role: 'owner' | 'manager' | 'staff' | null
  /** The session's house; "" for a session in no house. */
  restaurantId: string
}

interface AuthState {
  user: User | null
  activeRestaurantId: string | null
  /** Takes the signed-in person from `AuthProvider`, or null once signed out. */
  followSession: (user: User | null) => void
  setActiveRestaurantId: (restaurantId: string) => void
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      activeRestaurantId: null,

      followSession: (user) => {
        if (user) {
          set({
            user: {
              userId: user.userId,
              email: user.email,
              name: user.name,
              role: user.role,
              restaurantId: user.restaurantId,
            },
          })
        } else {
          // Signed out: nothing of the last person stays for the next one.
          set({ user: null, activeRestaurantId: null })
        }
      },

      setActiveRestaurantId: (restaurantId) => {
        if (!UUID.test(restaurantId)) {
          return
        }
        set({ activeRestaurantId: restaurantId })
        localStorage.setItem('activeRestaurantId', restaurantId)
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      partialize: (state) => ({
        user: state.user,
        activeRestaurantId: state.activeRestaurantId,
      }),
    }
  )
)
