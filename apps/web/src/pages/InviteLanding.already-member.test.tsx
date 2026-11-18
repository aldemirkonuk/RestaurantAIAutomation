/**
 * An invitation to a house the person already belongs to answers 409. The page
 * says so and opens that house, as a fresh accept does, instead of leaving the
 * person in whichever house was open.
 */
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  setActive: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    refreshBranches: h.refresh,
    setActiveRestaurantId: h.setActive,
  }),
}))
vi.mock('../services/api/client', () => ({
  apiClient: { get: h.get, post: h.post },
  getErrorMessage: () => 'Request failed. Try again.',
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import { InviteLanding } from './InviteLanding'

const conflict = (data: unknown) =>
  Object.assign(new Error('409'), { isAxiosError: true, response: { status: 409, data } })

function open() {
  render(
    <MemoryRouter initialEntries={['/invite/abcd']}>
      <Routes>
        <Route path="/invite/:code" element={<InviteLanding />} />
        <Route path="/" element={<p>the house</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('accessToken', 't')
  h.get.mockResolvedValue({ data: { valid: true, restaurant: 'The House', role: 'manager' } })
  h.setActive.mockResolvedValue(undefined)
  h.refresh.mockResolvedValue(undefined)
})

it('opens the house the 409 names, then goes in', async () => {
  h.post.mockRejectedValue(conflict({ message: 'already_member', restaurantId: 'house-9' }))
  open()
  fireEvent.click(await screen.findByRole('button', { name: /join the house/i }))
  await screen.findByText('the house')
  expect(h.setActive).toHaveBeenCalledWith('house-9')
})

it('goes in without switching when the 409 names no house', async () => {
  h.post.mockRejectedValue(conflict({ message: 'already_member' }))
  open()
  fireEvent.click(await screen.findByRole('button', { name: /join the house/i }))
  await screen.findByText('the house')
  await waitFor(() => expect(h.refresh).toHaveBeenCalled())
  expect(h.setActive).not.toHaveBeenCalled()
})
