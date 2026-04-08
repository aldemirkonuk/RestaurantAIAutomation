import type { Page } from '@playwright/test'

export const MOCK_USER = {
  userId: 'e2e-test-user-001',
  email: 'dev@wineops.test',
  name: 'E2E Test Developer',
  role: 'owner' as const,
  restaurantId: '00000000-0000-0000-0000-000000000001',
}

/**
 * Injects a mock auth state into a Playwright page, bypassing real Supabase/API auth.
 *
 * Strategy:
 *  1. Mocks GET /api/v1/auth/me to return MOCK_USER (prevents real API call)
 *  2. Injects a fake JWT into localStorage via addInitScript so AuthContext
 *     finds a token on mount, reads studioRoles from its payload, and sets
 *     isAuthenticated = true — all without a live backend.
 *
 * Must be called BEFORE page.goto().
 */
export async function mockAuthState(
  page: Page,
  studioRoles: ('developer' | 'certified_contributor' | 'review_admin')[] = ['developer'],
): Promise<void> {
  // Mock the auth/me endpoint so AuthContext can resolve the user object
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: MOCK_USER }),
    }),
  )

  // Inject fake JWT via browser btoa() so AuthContext's atob() decoding works correctly.
  // The payload includes app_metadata.roles which AuthContext reads for studioRoles.
  await page.addInitScript(
    ({ roles, userId, email }) => {
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      const body = btoa(
        JSON.stringify({
          sub: userId,
          email,
          app_metadata: { roles },
          exp: 9999999999,
        }),
      )
      localStorage.setItem('accessToken', `${header}.${body}.e2e-test-sig`)
    },
    { roles: studioRoles, userId: MOCK_USER.userId, email: MOCK_USER.email },
  )
}
