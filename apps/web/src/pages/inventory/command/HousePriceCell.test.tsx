import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { HousePriceCell, addedPriceNote, parsePriceInput, type AdviceLoad } from './HousePriceCell'
import type { PriceAdvice } from '../../../services/api/pricing'

/**
 * ADR 0193 -- "Your price" on /inventory: the house's own bottle and glass
 * price beside Market, changed in place by a manager, with one-tap advice
 * toward the house's target margin. The API modules are replaced (the gateway
 * is not the unit here); the cell itself runs for real.
 */
const updateInventoryItem = vi.fn()
const acceptPriceAdvice = vi.fn()
const confirmWinePour = vi.fn()
vi.mock('../../../services/api/inventory', () => ({
  updateInventoryItem: (...a: unknown[]) => updateInventoryItem(...a),
}))
vi.mock('../../../services/api/pricing', () => ({
  acceptPriceAdvice: (...a: unknown[]) => acceptPriceAdvice(...a),
  confirmWinePour: (...a: unknown[]) => confirmWinePour(...a),
}))

const raise: PriceAdvice = {
  kind: 'bottle',
  state: 'raise',
  price: 50,
  unitCost: 20,
  currentMarginPct: 60,
  targetPct: 65,
  bandPct: 2,
  gapPct: null,
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
  confirmWinePour.mockReset()
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

  it('a glass waiting for the house pour says so and points at Settings -- never "on target"', () => {
    const wait: PriceAdvice = {
      ...raise,
      kind: 'glass',
      state: 'pour_unconfirmed',
      advisedPrice: null,
      currentMarginPct: null,
      sentence: 'Glass advice waits until the house confirms its pour size (Settings, Target margin). Bottle advice does not.',
    }
    render(
      <HousePriceCell
        inventoryId="inv-1"
        wineName="Barolo"
        bottle={null}
        glass={12}
        advice={{
          status: 'ready',
          targetSet: true,
          byId: new Map([
            ['inv-1', { inventoryId: 'inv-1', wineName: 'Barolo', costBasis: 'invoice_lot_wac', costBasisLabel: '', bottleCost: 20, bottle: null, glass: wait }],
          ]),
        }}
        canEdit
        onChanged={vi.fn()}
      />,
    )
    expect(screen.getByText('glass waits for your pour size')).toHaveAttribute('href', '/settings?tab=target-margin')
    expect(screen.queryByText('on target')).not.toBeInTheDocument()
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

/**
 * ADR 0193 round 3. A locked price (the founder, 2026-09-21: "add a section to
 * that where you can lock price") is marked with who and when, keeps its
 * advice, and offers no Accept; an edit a lock held is said. A wine's own pour
 * ("Yes, confirmed per wine") is confirmed from the same edit.
 */
describe('HousePriceCell -- locks and a wine\'s own pour (round 3)', () => {
  const lockedRaise: PriceAdvice = {
    ...raise,
    locked: { lockId: 'lock-1', lockedPrice: 50, lockedBy: 'u5', lockedAt: '2026-09-02T09:00:00Z' },
  }

  it('L22: a locked price is marked with since when, its advice is shown on hover, and there is NO accept', () => {
    mount({ advice: ready(lockedRaise) })
    expect(screen.getByTestId('locked-bottle')).toHaveTextContent('btl locked at $50.00 since 2026-09-02')
    expect(screen.getByTestId('locked-bottle').getAttribute('title')).toMatch(/Raise the bottle to 57\.14.*advice cannot be accepted here/)
    expect(screen.queryByRole('button', { name: /raise btl/i })).not.toBeInTheDocument()
  })

  it('L25: when whether a price is locked is unknown, no accept is offered and the cell says why', () => {
    const load = ready(raise)
    mount({ advice: { ...(load as Extract<AdviceLoad, { status: 'ready' }>), locksReadable: false, locksReason: 'the locks could not be read (denied)' } })
    expect(screen.getByText('locks unknown, no accept')).toHaveAttribute('title', 'the locks could not be read (denied)')
    expect(screen.queryByRole('button', { name: /raise btl/i })).not.toBeInTheDocument()
  })

  it('L5: an edit a lock held is SAID -- the held kind named, the rest saved', async () => {
    updateInventoryItem.mockResolvedValue({ priceChange: { outcome: 'changed', held: [{ kind: 'bottle', lockedPrice: 50 }] } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    fireEvent.change(screen.getByLabelText(/bottle price for barolo/i), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText(/glass price for barolo/i), { target: { value: '13' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Not changed: the bottle price is locked at 50.00. Change it on Menu, under Locked prices. The rest was saved.')).toBeInTheDocument()
  })

  it('an edit where every kind was held says so, and claims nothing was saved', async () => {
    updateInventoryItem.mockResolvedValue({ priceChange: { outcome: 'locked', held: [{ kind: 'bottle', lockedPrice: 50 }] } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    fireEvent.change(screen.getByLabelText(/bottle price for barolo/i), { target: { value: '70' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Not changed: the bottle price is locked at 50.00. Change it on Menu, under Locked prices.')).toBeInTheDocument()
  })

  it('answer 3: a manager confirms this wine\'s own pour from the same edit; empty sends it back to the house pour', async () => {
    confirmWinePour.mockResolvedValue({ inventoryId: 'inv-1', pour: { confirmed: true, ml: 75 } })
    mount()
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    fireEvent.change(screen.getByLabelText(/pour in ml for barolo/i), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(confirmWinePour).toHaveBeenCalledWith('inv-1', 75))
    expect(updateInventoryItem).not.toHaveBeenCalled()
    expect(await screen.findByText("This wine's pour is confirmed at 75 ml.")).toBeInTheDocument()
  })

  it('answer 3: a wine already on its own pour shows it, and emptying the field returns it to the house pour', async () => {
    confirmWinePour.mockResolvedValue({ inventoryId: 'inv-1', pour: { confirmed: false, ml: null } })
    const load = ready(raise) as Extract<AdviceLoad, { status: 'ready' }>
    const wine = load.byId.get('inv-1')!
    load.byId.set('inv-1', { ...wine, pour: { ml: 75, source: 'wine' } })
    mount({ advice: load })
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    const pour = screen.getByLabelText(/pour in ml for barolo/i) as HTMLInputElement
    expect(pour.value).toBe('75')
    fireEvent.change(pour, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(confirmWinePour).toHaveBeenCalledWith('inv-1', null))
  })

  it('answer 3: a pour outside 10-500 ml is refused on the page, and nothing is sent', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    fireEvent.change(screen.getByLabelText(/pour in ml for barolo/i), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/A pour is between 10 and 500 ml/)).toBeInTheDocument()
    expect(confirmWinePour).not.toHaveBeenCalled()
    expect(updateInventoryItem).not.toHaveBeenCalled()
  })
})

describe('HousePriceCell -- a price and a pour saved in one edit (round 3)', () => {
  it('a saved price and a refused pour are both said -- never "nothing was changed"', async () => {
    updateInventoryItem.mockResolvedValue({ priceChange: { outcome: 'changed', held: [] } })
    confirmWinePour.mockRejectedValue({ response: { status: 500, data: { message: 'This wine\'s pour was not confirmed. Nothing was changed. timeout' } } })
    const { onChanged } = mount()
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    fireEvent.change(screen.getByLabelText(/bottle price for barolo/i), { target: { value: '70' } })
    fireEvent.change(screen.getByLabelText(/pour in ml for barolo/i), { target: { value: '75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/^The price was saved; this wine's pour was not: /)).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
  })

  it('while this wine\'s pour is not known (the advice is still loading), no pour field is offered', () => {
    mount({ advice: { status: 'loading' } })
    fireEvent.click(screen.getByRole('button', { name: /change your price/i }))
    expect(screen.queryByLabelText(/pour in ml for barolo/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/bottle price for barolo/i)).toBeInTheDocument()
  })
})

describe('addedPriceNote -- what adding a wine did to the price typed with it (last-call review)', () => {
  it('a price a lock held (a removed wine added back) is said, with the lock', () => {
    expect(
      addedPriceNote({ priceChange: { outcome: 'locked', held: [{ kind: 'bottle', lockedPrice: 95 }] } }),
    ).toBe('The wine was added. Not changed: the bottle price is locked at 95.00. Change it on Menu, under Locked prices.')
  })

  it('a failed price write is said with its reason, never as saved', () => {
    expect(addedPriceNote({ priceChange: { outcome: 'failed', error: 'timeout' } })).toBe(
      'The wine was added, but its price was not saved (timeout). Set it under Your price.',
    )
  })

  it('a newer price that stood is said', () => {
    expect(addedPriceNote({ priceChange: { outcome: 'stale', held: [] } })).toMatch(/^The wine was added, but its price was not changed/)
  })

  it('a price that landed, or none typed, says nothing more', () => {
    expect(addedPriceNote({ priceChange: { outcome: 'changed', held: [] } })).toBeNull()
    expect(addedPriceNote({ priceChange: { outcome: 'unchanged', held: [] } })).toBeNull()
    expect(addedPriceNote({})).toBeNull()
    expect(addedPriceNote(null)).toBeNull()
  })
})
