import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MeasurementSection } from './MeasurementSection'

/**
 * Recipes walk G13 / G15 (calls F11, F14): the house's glass pour is a
 * restaurant fact read from and confirmed on the server, never a number kept
 * in this browser; the "Enable recipes" and "Recipe yield unit" switches that
 * nothing read are gone.
 */
const getTargetMargin = vi.fn()
const confirmPourSize = vi.fn()
vi.mock('@/services/api/pricing', () => ({
  getTargetMargin: (...a: unknown[]) => getTargetMargin(...a),
  confirmPourSize: (...a: unknown[]) => confirmPourSize(...a),
}))

const reg = (pour: { confirmed: boolean; ml: number | null; confirmedAt: string | null; name?: string }) => ({
  restaurantId: 'r', bottlePct: null, glassPct: null, bandPct: null,
  pour: {
    confirmed: pour.confirmed, ml: pour.ml, confirmedAt: pour.confirmedAt,
    confirmedBy: pour.name ? { userId: 'u', name: pour.name } : null,
  },
  readable: true, reason: null, statedAt: null, statedBy: null,
})

beforeEach(() => {
  getTargetMargin.mockReset()
  confirmPourSize.mockReset()
  localStorage.clear()
})

describe('MeasurementSection', () => {
  it('shows the server pour and who confirmed it', async () => {
    getTargetMargin.mockResolvedValue(reg({ confirmed: true, ml: 125, confirmedAt: '2026-11-01T10:00:00Z', name: 'Ayla' }))
    render(<MeasurementSection />)
    expect(await screen.findByLabelText('House glass pour in millilitres')).toHaveValue(125)
    expect(screen.getByText(/takes 125 ml from the bottle/)).toBeInTheDocument()
    expect(screen.getByText(/confirmed by · Ayla/i)).toBeInTheDocument()
  })

  it('saving the house pour sends a request and writes no browser key for it', async () => {
    getTargetMargin.mockResolvedValue(reg({ confirmed: false, ml: null, confirmedAt: null }))
    confirmPourSize.mockResolvedValue(reg({ confirmed: true, ml: 25, confirmedAt: '2026-11-07T10:00:00Z', name: 'Ayla' }))
    render(<MeasurementSection />)
    const input = await screen.findByLabelText('House glass pour in millilitres')
    expect(screen.getByText(/Not confirmed/)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(confirmPourSize).toHaveBeenCalledWith(25))
    expect(await screen.findByText(/takes 25 ml from the bottle/)).toBeInTheDocument()
    const stored = localStorage.getItem('restaurant-settings-storage') ?? ''
    expect(stored).not.toMatch(/defaultPourMl|recipesEnabled|recipeYieldUnit/)
  })

  it('renders no "Enable recipes" switch and no recipe yield unit', async () => {
    getTargetMargin.mockResolvedValue(reg({ confirmed: false, ml: null, confirmedAt: null }))
    render(<MeasurementSection />)
    await screen.findByLabelText('House glass pour in millilitres')
    expect(screen.queryByText(/Enable recipes/i)).toBeNull()
    expect(screen.queryByText(/Recipe yield unit/i)).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('says a failed read in words, never as an unconfirmed pour', async () => {
    getTargetMargin.mockRejectedValue(new Error('network down'))
    render(<MeasurementSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be read — network down/)
    expect(screen.queryByText(/Not confirmed/)).toBeNull()
  })
})
