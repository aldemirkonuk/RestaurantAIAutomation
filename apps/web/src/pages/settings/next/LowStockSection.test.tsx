import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LowStockSection } from './LowStockSection'

/**
 * F-1414 (rehit of F-075): the low-stock number could be set only on the
 * arrival's step, which hides once it is saved. Settings now reads the saved
 * number and changes it with the same call.
 */
const api = vi.hoisted(() => ({
  getLowStockSetting: vi.fn(),
  setDefaultThreshold: vi.fn(),
}))
vi.mock('@/services/api/menus', () => ({
  getLowStockSetting: api.getLowStockSetting,
  setDefaultThreshold: api.setDefaultThreshold,
}))

beforeEach(() => {
  api.getLowStockSetting.mockReset().mockResolvedValue({ carried: 40, defaultThresholdMin: 6 })
  api.setDefaultThreshold.mockReset().mockResolvedValue({ default_threshold_min: 4, threshold_configured: true })
})

describe('LowStockSection', () => {
  it('opens on the saved number and changes it after setup', async () => {
    render(<LowStockSection canManage />)
    const field = (await screen.findByLabelText('Low-stock number')) as HTMLInputElement
    expect(field.value).toBe('6')
    fireEvent.change(field, { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.setDefaultThreshold).toHaveBeenCalledWith(4, false))
    expect(await screen.findByText('Saved: 4.')).toBeTruthy()
  })

  it('sets it on the items carried now only after the counted tick', async () => {
    render(<LowStockSection canManage />)
    fireEvent.click(await screen.findByRole('checkbox', { name: /Also set it on the 40 items you carry now/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.setDefaultThreshold).toHaveBeenCalledWith(6, true))
  })

  it('says a failed read, and offers no field', async () => {
    api.getLowStockSetting.mockRejectedValue(new Error('Network Error'))
    render(<LowStockSection canManage />)
    expect(await screen.findByText(/could not be read — Network Error/)).toBeTruthy()
    expect(screen.queryByLabelText('Low-stock number')).toBeNull()
  })

  it('does not read it for someone who cannot change it', () => {
    render(<LowStockSection canManage={false} />)
    expect(api.getLowStockSetting).not.toHaveBeenCalled()
  })
})
