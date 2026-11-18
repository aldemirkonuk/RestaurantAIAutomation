import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { UnknownAddress } from './UnknownAddress'
import { useAuth } from '../contexts/AuthContext'

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('./layout/DashboardLayout', async () => {
  const { Outlet } = await import('react-router-dom')
  return { DashboardLayout: () => <div data-testid="shell"><Outlet /></div> }
})
vi.mock('./mudavym/ShellCatchAll', () => ({ ShellCatchAll: () => <div>in-app 404</div> }))

function at(path: string, auth: Record<string, unknown>) {
  vi.mocked(useAuth).mockReturnValue(auth as any)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>the sign-in screen</div>} />
        <Route path="*" element={<UnknownAddress />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('UnknownAddress', () => {
  it('a signed-out visitor at an unknown address meets the book 404, not the sign-in screen', async () => {
    at('/this-page-does-not-exist', { loading: false, isAuthenticated: false, user: null })
    expect(await screen.findByTestId('book-not-found')).toBeTruthy()
    expect(screen.queryByText('the sign-in screen')).toBeNull()
  })

  it('a signed-in person gets the in-app 404 inside the shell', () => {
    at('/nope', {
      loading: false,
      isAuthenticated: true,
      user: { emailVerified: true, restaurantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
    expect(screen.getByTestId('shell')).toBeTruthy()
    expect(screen.getByText('in-app 404')).toBeTruthy()
  })

  it('while the session is still being read nothing is decided yet', () => {
    at('/nope', { loading: true, isAuthenticated: false, user: null })
    expect(screen.queryByTestId('book-not-found')).toBeNull()
    expect(screen.queryByText('the sign-in screen')).toBeNull()
  })
})
