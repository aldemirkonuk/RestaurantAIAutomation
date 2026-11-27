/** onboarding-r110-g2: the first stock count, walked shelf by shelf from /house. */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getInventory, apiGet, submitSpotCount, reduced } = vi.hoisted(() => ({
  getInventory: vi.fn(),
  apiGet: vi.fn(),
  submitSpotCount: vi.fn(),
  reduced: { on: false },
}))
let keyN = 0

vi.mock('../../services/api/inventory', () => ({ getInventory }))
vi.mock('../../services/api/client', () => ({ apiClient: { get: apiGet }, getActiveRestaurantId: () => 'r1' }))
vi.mock('../../lib/spotCountOutbox', () => ({
  submitSpotCount,
  newClientCountId: () => `key-${++keyN}`,
}))
vi.mock('../../lib/mudavym/motion', () => ({ prefersReducedMotion: () => reduced.on }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))

import HouseCount, { CARD_ENTER } from '../HouseCount'
import { HouseCountRow } from '../../components/onboarding/HouseCountRow'
import { readTypedCount } from '../../lib/firstCount'

const good = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  wineName: name,
  uom: 'bottle',
  storage_location_id: null,
  lastCountedAt: null,
  isActive: true,
  ...over,
})

const SHELF = [
  good('g-none', 'Ayran', { uom: 'each' }),
  good('g-walk-b', 'Zeytinyağı', { storage_location_id: 'L-walk', uom: 'l' }),
  good('g-bar', 'Rakı', { storage_location_id: 'L-bar' }),
  good('g-walk-a', 'Flour', { storage_location_id: 'L-walk', uom: 'kg' }),
  good('g-odd', 'Salt', { storage_location_id: 'L-unnamed', uom: 'g' }),
  good('g-done', 'Counted wine', { lastCountedAt: '2026-11-20T10:00:00Z' }),
  good('g-off', 'Retired', { isActive: false }),
]
const LOCATIONS = [
  { id: 'L-walk', name: 'Walk-in' },
  { id: 'L-bar', name: 'Bar shelf' },
]

const animate = vi.fn()
const page = () => render(<MemoryRouter><HouseCount /></MemoryRouter>)
const cardName = () => screen.getByTestId('house-count-card').querySelector('label span')?.textContent
const field = () => screen.getByRole('textbox')
const press = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}
const type = (v: string) => fireEvent.change(field(), { target: { value: v } })

beforeEach(() => {
  vi.clearAllMocks()
  keyN = 0
  reduced.on = false
  document.documentElement.dir = ''
  getInventory.mockResolvedValue(SHELF)
  apiGet.mockResolvedValue({ data: LOCATIONS })
  submitSpotCount.mockResolvedValue({ synced: true })
  ;(Element.prototype as any).animate = animate
})
afterEach(() => {
  delete (Element.prototype as any).animate
})

describe('/house/count walks the shelf', () => {
  it('orders by storage location name, then name; unnamed shelves after, no shelf last; counted and retired goods are out', async () => {
    page()
    await screen.findByTestId('house-count-card')
    const seen: Array<string | null | undefined> = []
    for (let i = 0; i < 5; i++) {
      seen.push(cardName())
      await press('Skip')
    }
    expect(seen).toEqual(['Rakı', 'Flour', 'Zeytinyağı', 'Salt', 'Ayran'])
  })

  it('Skip writes nothing, and the end says what is left for later', async () => {
    page()
    await screen.findByTestId('house-count-card')
    for (let i = 0; i < 5; i++) await press('Skip')
    expect(submitSpotCount).not.toHaveBeenCalled()
    expect(screen.getByTestId('house-count-end')).toHaveTextContent('0 counted, 5 left for later')
  })

  it('an explicit 0 is written as 0, through the outbox, with a key made at the tap', async () => {
    page()
    await screen.findByTestId('house-count-card')
    type('0')
    await press('Next')
    expect(submitSpotCount).toHaveBeenCalledTimes(1)
    expect(submitSpotCount.mock.calls[0][0]).toMatchObject({
      itemId: 'g-bar',
      body: { countedQty: 0, clientCountId: 'key-1' },
    })
    expect(cardName()).toBe('Flour')
  })

  it('an empty field on Next writes nothing and stays on the good', async () => {
    page()
    await screen.findByTestId('house-count-card')
    await press('Next')
    expect(submitSpotCount).not.toHaveBeenCalled()
    expect(cardName()).toBe('Rakı')
    expect(screen.getByRole('alert')).toHaveTextContent('Type what is on the shelf, or Skip it for later.')
  })

  it('a retry of the same number keeps its key; a new number gets a new one', async () => {
    submitSpotCount.mockRejectedValueOnce(new Error('400'))
    page()
    await screen.findByTestId('house-count-card')
    type('7')
    await press('Next')
    expect(screen.getByRole('alert')).toHaveTextContent('This count was not written. Try Next again.')
    expect(cardName()).toBe('Rakı')
    await press('Next')
    expect(submitSpotCount.mock.calls.map((c) => c[0].body.clientCountId)).toEqual(['key-1', 'key-1'])
    // A new number after Back gets a new key.
    await press('Back')
    type('8')
    await press('Next')
    expect(submitSpotCount.mock.calls[2][0].body).toMatchObject({ countedQty: 8, clientCountId: 'key-2' })
  })

  it('a decimal is refused in each good’s own unit (kg, l, g), and a negative is refused', async () => {
    page()
    await screen.findByTestId('house-count-card')
    await press('Skip') // Flour, in kg
    type('2.5')
    await press('Next')
    expect(screen.getByRole('alert')).toHaveTextContent('Whole kg only')
    type('-1')
    await press('Next')
    expect(screen.getByRole('alert')).toHaveTextContent('A count cannot be below zero.')
    expect(submitSpotCount).not.toHaveBeenCalled()
    await press('Skip') // Zeytinyağı, in l
    type('0,5')
    await press('Next')
    expect(screen.getByRole('alert')).toHaveTextContent('Whole l only')
    await press('Skip') // Salt, in g
    type('.5')
    await press('Next')
    expect(screen.getByRole('alert')).toHaveTextContent('Whole g only')
    expect(submitSpotCount).not.toHaveBeenCalled()
    expect(readTypedCount('')).toEqual({ kind: 'empty' })
    expect(readTypedCount('0')).toEqual({ kind: 'count', qty: 0 })
    expect(readTypedCount('3000000000')).toEqual({ kind: 'unreadable' })
  })

  it('a resumed walk leaves out what is counted: the counter reads what is left', async () => {
    getInventory.mockResolvedValue([
      good('a', 'Ayran', { lastCountedAt: '2026-11-27T09:00:00Z' }),
      good('b', 'Bira'),
      good('c', 'Cin'),
    ])
    page()
    await screen.findByTestId('house-count-card')
    expect(cardName()).toBe('Bira')
    expect(screen.getByTestId('house-count-counter')).toHaveTextContent('1 of 2')
    type('3')
    await press('Next')
    await press('Skip')
    expect(screen.getByTestId('house-count-end')).toHaveTextContent('1 counted, 1 left for later')
  })

  it('Next enters from the inline end and Back from the inline start, 24 px over 200 ms, mirrored in RTL; focus goes to the new field', async () => {
    page()
    await screen.findByTestId('house-count-card')
    expect(animate).not.toHaveBeenCalled()
    await press('Skip')
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.calls[0][0][0]).toEqual({ transform: 'translateX(24px)', opacity: 0 })
    expect(animate.mock.calls[0][0][1]).toEqual({ transform: 'translateX(0)', opacity: 1 })
    expect(animate.mock.calls[0][1]).toEqual({ duration: 200, easing: 'cubic-bezier(0.16,1,0.3,1)' })
    expect(CARD_ENTER).toEqual({ px: 24, ms: 200, easing: 'cubic-bezier(0.16,1,0.3,1)' })
    expect(document.activeElement).toBe(field())
    await press('Back')
    expect(animate.mock.calls[1][0][0]).toEqual({ transform: 'translateX(-24px)', opacity: 0 })
    document.documentElement.dir = 'rtl'
    await press('Skip')
    expect(animate.mock.calls[2][0][0]).toEqual({ transform: 'translateX(-24px)', opacity: 0 })
    await press('Back')
    expect(animate.mock.calls[3][0][0]).toEqual({ transform: 'translateX(24px)', opacity: 0 })
  })

  it('under reduced motion nothing animates: 0 Element.animate calls, and the hairline has no transition', async () => {
    reduced.on = true
    page()
    await screen.findByTestId('house-count-card')
    await press('Skip')
    await press('Back')
    type('1')
    await press('Next')
    expect(animate).not.toHaveBeenCalled()
    const hairline = screen.getByTestId('house-count-hairline')
    expect(hairline.className).toMatch(/motion-reduce:transition-none/)
    expect(hairline.className).not.toMatch(/(^|\s)transition-transform/)
    expect(hairline.style.transform).toBe('scaleX(0.2)')
    expect(document.activeElement).toBe(field())
  })

  it('a failed read says so, and Look again reads again', async () => {
    getInventory.mockRejectedValueOnce(new Error('503'))
    page()
    expect(await screen.findByText(/We could not read your goods just now\./)).toBeInTheDocument()
    await press('Look again')
    await screen.findByTestId('house-count-card')
    expect(getInventory).toHaveBeenCalledTimes(2)
  })
})

describe('the /house row', () => {
  it('names the goods not counted yet and opens /house/count', async () => {
    render(<MemoryRouter><HouseCountRow /></MemoryRouter>)
    const link = await screen.findByRole('link')
    expect(link).toHaveTextContent('Count what is on the shelf · 5 goods from your menu, not counted yet')
    expect(link).toHaveAttribute('href', '/house/count')
  })

  it('shows no row once every good is counted', async () => {
    getInventory.mockResolvedValue([good('a', 'A', { lastCountedAt: '2026-11-27T09:00:00Z' })])
    render(<MemoryRouter><HouseCountRow /></MemoryRouter>)
    await waitFor(() => expect(getInventory).toHaveBeenCalled())
    await new Promise((settle) => setTimeout(settle, 0))
    expect(screen.queryByTestId('house-count-row')).toBeNull()
  })
})
