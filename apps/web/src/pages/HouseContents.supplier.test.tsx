import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HouseContents from './HouseContents'

/**
 * The supplier asked for on the house's contents page is added by its own
 * call; the setup's note that a vendor was added is a second call. When the
 * second fails the supplier is already on the book, so the page must not say
 * it could not add it: a retry would add the same supplier twice.
 */
const h = vi.hoisted(() => ({ add: vi.fn(), progress: vi.fn() }))
vi.mock('../services/api/vendors', () => ({ addCustomProvider: h.add }))
vi.mock('../services/api/menus', () => ({ updateOnboardingProgress: h.progress }))

function type(name: string) {
  render(
    <MemoryRouter>
      <HouseContents />
    </MemoryRouter>,
  )
  fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Add this supplier' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})
afterEach(cleanup)

it('says a supplier is on the book when only the setup note failed', async () => {
  h.add.mockResolvedValue({ id: 'v1', name: 'Suvla' })
  h.progress.mockRejectedValue(new Error('503'))
  type('Suvla')
  expect(await screen.findByText('Suvla is on the book.')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(h.add).toHaveBeenCalledTimes(1)
})

it('says the supplier could not be added when the add itself failed', async () => {
  h.add.mockRejectedValue(new Error('Could not add'))
  type('Suvla')
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not add'))
  expect(h.progress).not.toHaveBeenCalled()
})
