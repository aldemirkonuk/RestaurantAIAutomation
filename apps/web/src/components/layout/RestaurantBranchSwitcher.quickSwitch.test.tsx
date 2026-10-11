/**
 * F-1036: two quick house switches. Picking a second house before the first
 * answers supersedes the first, and the first then answers "not opened" too.
 * That is not a refusal: only the latest switch's outcome may be shown, and a
 * note about a house the page has since left must not stay on screen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { RestaurantBranchSwitcher } from './RestaurantBranchSwitcher'

const HOUSES = [
  { id: 'h-harbour', name: 'Harbour', city: 'Izmir' },
  { id: 'h-moda', name: 'Moda', city: 'Istanbul' },
  { id: 'h-uplands', name: 'Uplands', city: 'Ankara' },
]

let activeRestaurantId = 'h-harbour'
let pending: Record<string, (ok: boolean) => void> = {}
const setActiveRestaurantId = vi.fn(
  (id: string) => new Promise<boolean>((resolve) => (pending[id] = resolve)),
)

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId,
    availableRestaurants: HOUSES,
    setActiveRestaurantId,
    activeRole: 'manager',
  }),
}))

vi.mock('../../lib/mudavym/shellGround', () => ({
  useMudavymShell: () => ({ on: false }),
}))

const ui = () => (
  <MemoryRouter>
    <RestaurantBranchSwitcher compact={false} />
  </MemoryRouter>
)

function pick(name: string) {
  fireEvent.click(screen.getByRole('button', { expanded: false }))
  fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
}

describe('RestaurantBranchSwitcher: two quick switches (F-1036)', () => {
  beforeEach(() => {
    activeRestaurantId = 'h-harbour'
    pending = {}
    setActiveRestaurantId.mockClear()
  })

  it('says nothing when the first switch answers after the second has landed', async () => {
    const view = render(ui())
    pick('Moda')
    pick('Uplands')

    await act(async () => {
      activeRestaurantId = 'h-uplands'
      pending['h-uplands'](true)
    })
    view.rerender(ui())
    await act(async () => pending['h-moda'](false))

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports only the latest switch, in the house the page is in', async () => {
    render(ui())
    pick('Moda')
    pick('Uplands')

    await act(async () => pending['h-moda'](false))
    expect(screen.queryByRole('alert')).toBeNull()

    await act(async () => pending['h-uplands'](false))
    expect(screen.getByRole('alert').textContent).toBe(
      "Couldn't open Uplands. You're still in Harbour.",
    )
  })

  it('drops a refusal note once the page is in another house', async () => {
    const view = render(ui())
    pick('Moda')
    await act(async () => pending['h-moda'](false))
    expect(screen.getByRole('alert')).toBeTruthy()

    activeRestaurantId = 'h-uplands'
    view.rerender(ui())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('RestaurantBranchSwitcher at phone width (F-1184)', () => {
  beforeEach(() => {
    activeRestaurantId = 'h-harbour'
    pending = {}
    setActiveRestaurantId.mockClear()
  })
  const compact = () => (
    <MemoryRouter>
      <RestaurantBranchSwitcher compact className="relative" />
    </MemoryRouter>
  )

  it('names the house, not its first letter, and says which house it is in', () => {
    render(compact())
    const trigger = screen.getByRole('button', { expanded: false })
    expect(trigger.getAttribute('aria-label')).toBe('Switch location. Now in Harbour')
    // The name is never hidden below 640px; it truncates instead.
    const name = screen.getByText('Harbour')
    expect(name.className).toMatch(/\btruncate\b/)
    expect(name.closest('.hidden')).toBeNull()
    // The letter tile is what goes at phone width.
    expect(screen.getByText('H').parentElement?.className).toMatch(/(^|\s)hidden sm:flex(\s|$)/)
  })

  it('wraps a refusal note inside the screen instead of running off it', async () => {
    render(compact())
    pick('Moda')
    await act(async () => pending['h-moda'](false))
    const note = screen.getByRole('alert')
    expect(note.className).not.toMatch(/whitespace-nowrap/)
    expect(note.className).not.toMatch(/\bleft-0\b/)
    expect(note.className).toMatch(/\bright-0\b/)
    expect(note.className).toMatch(/max-w-\[min\(18rem,calc\(100vw-2rem\)\)\]/)
  })
})
