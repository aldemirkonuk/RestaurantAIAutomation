import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HousePriceCell, parsePriceInput, type AdviceLoad } from './HousePriceCell'
import type { PriceAdvice } from '../../../services/api/pricing'

/**
 * ADR 0193 -- "Your price" on /inventory: the house's own bottle and glass
 * price beside Market, changed in place by a manager, with one-tap advice
 * toward the house's target margin. The API modules are replaced (the gateway
 * is not the unit here); the cell itself runs for real.
 */
const updateInventoryItem = vi.fn()
const acceptPriceAdvice = vi.fn()
vi.mock('../../../services/api/inventory', () => ({
  updateInventoryItem: (...a: unknown[]) => updateInventoryItem(...a),
}))
vi.mock('../../../services/api/pricing', () => ({
  acceptPriceAdvice: (...a: unknown[]) => acceptPriceAdvice(...a),
}))

const raise: PriceAdvice = {
  kind: 'bottle',
  state: 'raise',
  price: 50,
  unitCost: 20,
  currentMarginPct: 60,
  targetPct: 65,
  bandPts: 2,
  advisedPrice: 57.14,
  sentence: 'Raise the bottle to 57.14 (now 50.00): today’s margin is 60%, your target is 65%.',
}

function ready(bottle: PriceAdvice | null, targetSet = true): AdviceLoad {
  return {
    status: 'ready',
    targetSet,
    byId: new Map([
      ['inv-1', { inventoryId: 'inv-1', wineName: 'Barolo', costBasis: 'invoice_lot_wac', costBasisLabel: '', bottleCost: 20, bottle, glass: null }],
    ]),
  }
}

function mount(over: Partial<Parameters<typeof HousePriceCell>[0]> = {}) {
  const onChanged = vi.fn()
  render(
    <HousePriceCell
      inventoryId="inv-1"
      wineName="Barolo"
      bottle={50}
      glass={12}
      advice={ready(raise)}
      canEdit
      onChanged={onChanged}
      {...over}
    />,
  )
  return { onChanged }
}

beforeEach(() => {
  updateInventoryItem.mockReset()
  acceptPriceAdvice.mockReset()
})

describe('HousePriceCell', () => {
  it('shows the house’s own bottle and glass price', () => {
    mount()
    expect(screen.getByRole('button', { name: /change your price for barolo/i })).toHaveTextContent('$50.00 btl · $12.00 gl')
  })

  it('a manager changes the bottle price in place; only the field that moved is sent', async () => {
    updateInventoryItem.mockResolvedValue({ priceChange: { outcome: 'changed' } })
    const { onChanged } = mount()
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    fireEvent.change(screen.getByLabelText(/bottle price for barolo/i), { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateInventoryItem).toHaveBeenCalledWith('inv-1', { menuPriceBottle: 70 }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('an emptied field takes the price off (null), never sends 0', async () => {
    updateInventoryItem.mockResolvedValue({ priceChange: { outcome: 'changed' } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    fireEvent.change(screen.getByLabelText(/glass price for barolo/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateInventoryItem).toHaveBeenCalledWith('inv-1', { menuPriceGlass: null }))
  })

  it('a price that is not a number is refused on the page and nothing is sent', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    fireEvent.change(screen.getByLabelText(/bottle price for barolo/i), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/A price is a number of 0 or more/)).toBeInTheDocument()
    expect(updateInventoryItem).not.toHaveBeenCalled()
  })

  it('the gateway’s refusal is said in words (403)', async () => {
    updateInventoryItem.mockRejectedValue({ response: { status: 403, data: { message: 'x' } } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    fireEvent.change(screen.getByLabelText(/bottle price for barolo/i), { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an owner or a manager can change a price.')
  })

  it('one tap applies the advice exactly as shown', async () => {
    acceptPriceAdvice.mockResolvedValue({ outcome: 'changed' })
    const { onChanged } = mount()
    fireEvent.click(screen.getByRole('button', { name: /raise btl to \$57\.14/i }))
    await waitFor(() => expect(acceptPriceAdvice).toHaveBeenCalledWith('inv-1', 'bottle', 57.14))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('a refused accept (the advice moved: 409) is said, not swallowed', async () => {
    acceptPriceAdvice.mockRejectedValue({ response: { status: 409, data: { message: 'The advice changed since it was shown' } } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /raise btl to/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The advice changed since it was shown')
  })

  it('staff see the price and the advice, with no control to change either', () => {
    mount({ canEdit: false })
    expect(screen.queryByRole('button', { name: /change your price/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /raise btl/i })).not.toBeInTheDocument()
    expect(screen.getByText(/Raise btl to \$57\.14/)).toBeInTheDocument()
  })

  it('advice that could not be read says so -- not an empty cell', () => {
    mount({ advice: { status: 'error', message: 'timeout' } })
    expect(screen.getByText('advice unavailable')).toHaveAttribute('title', 'timeout')
  })

  it('no target set: the cell says so and points at Settings', () => {
    mount({ advice: ready({ ...raise, state: 'no_target', advisedPrice: null }, false) })
    expect(screen.getByRole('link', { name: 'no target set' })).toHaveAttribute('href', '/settings?tab=target-margin')
  })

  it('no recorded cost: says so, never "on target"', () => {
    mount({ advice: ready({ ...raise, state: 'no_cost', advisedPrice: null }) })
    expect(screen.getByText('no cost recorded')).toBeInTheDocument()
    expect(screen.queryByText('on target')).not.toBeInTheDocument()
  })
})

describe('parsePriceInput', () => {
  it('empty clears, $ is tolerated, negatives and words are refused, cents are kept', () => {
    expect(parsePriceInput('')).toEqual({ ok: true, value: null })
    expect(parsePriceInput('$62.5')).toEqual({ ok: true, value: 62.5 })
    expect(parsePriceInput('57.144')).toEqual({ ok: true, value: 57.14 })
    expect(parsePriceInput('-1')).toEqual({ ok: false })
    expect(parsePriceInput('ten')).toEqual({ ok: false })
  })
})
