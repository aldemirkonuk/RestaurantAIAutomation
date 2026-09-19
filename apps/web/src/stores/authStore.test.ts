import { describe, it, expect, vi, beforeEach } from 'vitest'

const RID_A = '550e8400-e29b-41d4-a716-446655440000'
const RID_B = '6ba7b810-9dad-41d1-80b4-00c04fd430c8'
const user = {
  userId: 'u1',
  email: 'a@example.com',
  name: 'A',
  role: 'owner' as const,
  restaurantId: RID_A,
}

// Importing this module used to fire GET /auth/me through a private axios
// instance and, on a failure that was not a recovered 401, wipe both tokens and
// navigate to /login. Loading it must now touch neither the network nor the
// session.
describe('authStore is a passive mirror of AuthContext', () => {
  let axiosTouched: number

  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    axiosTouched = 0
    // A factory that counts the load: if the store imports axios again, the
    // count moves, whether or not it then makes a request.
    vi.doMock('axios', () => {
      axiosTouched += 1
      return { default: { create: () => ({ get: vi.fn(), post: vi.fn(), defaults: { headers: { common: {} } } }) } }
    })
  })

  it('makes no request, keeps both tokens and does not navigate when imported', async () => {
    localStorage.setItem('accessToken', 'stale-access')
    localStorage.setItem('refreshToken', 'stale-refresh')
    const before = window.location.href

    await import('./authStore')
    await Promise.resolve()

    expect(axiosTouched).toBe(0)
    expect(localStorage.getItem('accessToken')).toBe('stale-access')
    expect(localStorage.getItem('refreshToken')).toBe('stale-refresh')
    expect(window.location.href).toBe(before)
  })

  it('exposes no auth action a second bootstrap could hide behind', async () => {
    const { useAuthStore } = await import('./authStore')
    expect(Object.keys(useAuthStore.getState()).sort()).toEqual(
      ['activeRestaurantId', 'setActiveRestaurantId', 'setUser', 'syncSession', 'user'],
    )
  })

  it('setActiveRestaurantId ignores a non-UUID and records a UUID', async () => {
    const { useAuthStore } = await import('./authStore')
    useAuthStore.getState().setActiveRestaurantId('not-a-uuid')
    expect(useAuthStore.getState().activeRestaurantId).toBeNull()
    useAuthStore.getState().setActiveRestaurantId(RID_B)
    expect(useAuthStore.getState().activeRestaurantId).toBe(RID_B)
    expect(localStorage.getItem('activeRestaurantId')).toBe(RID_B)
  })

  it('syncSession mirrors the user and seeds the active restaurant in memory only', async () => {
    const { useAuthStore } = await import('./authStore')
    useAuthStore.getState().syncSession(user)
    expect(useAuthStore.getState().user).toEqual(user)
    expect(useAuthStore.getState().activeRestaurantId).toBe(RID_A)
    // AuthContext owns this key — it drives the X-Restaurant-Id header.
    expect(localStorage.getItem('activeRestaurantId')).toBeNull()
  })

  it('syncSession never overwrites the branch the user already picked', async () => {
    const { useAuthStore } = await import('./authStore')
    useAuthStore.getState().setActiveRestaurantId(RID_B)
    useAuthStore.getState().syncSession(user)
    expect(useAuthStore.getState().activeRestaurantId).toBe(RID_B)
  })

  it('syncSession(null) clears the user and the active restaurant', async () => {
    const { useAuthStore } = await import('./authStore')
    useAuthStore.getState().syncSession(user)
    useAuthStore.getState().syncSession(null)
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().activeRestaurantId).toBeNull()
  })
})
