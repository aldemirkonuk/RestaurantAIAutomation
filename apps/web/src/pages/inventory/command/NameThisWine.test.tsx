/**
 * The quiet flag on a wine whose name cannot say which wine it is, and the
 * edit path to the house's own name (founder, 2026-09-21, ADR 0192's
 * amendment). The gateway decides the status and the words
 * (house-item-research.spec.ts); what is proved here is that the flag shows
 * only where the gateway set it, that naming the wine uses the ordinary item
 * edit with the house's name, and that a failed read is never "nothing to name".
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }))
vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => api.get(...a),
    patch: (...a: unknown[]) => api.patch(...a),
  },
  getActiveRestaurantId: () => 'rest-A',
  getErrorMessage: (e: unknown) =>
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
    (e as { message?: string })?.message ??
    'unknown error',
}))

import { HouseItemResearchUnread, NameThisWine, NameThisWineHint } from './NameThisWine'

const FLAG = 'Tell us which wine this is and we can help you build better menus and promotions'

function draw(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

let research: Array<Record<string, unknown>> = []

beforeEach(() => {
  api.get.mockReset()
  api.patch.mockReset()
  research = [
    { inventoryId: 'inv-1', status: 'not_findable', reason: 'placeholder', flag: FLAG, updatedAt: '2026-09-21T10:00:00Z' },
    { inventoryId: 'inv-2', status: 'queued', reason: 'waits', flag: null, updatedAt: '2026-09-21T10:00:00Z' },
  ]
  api.get.mockImplementation(async (path: string) => {
    if (path === '/inventory/research') return { data: { items: research } }
    throw new Error(`unexpected GET ${path}`)
  })
})

describe('the flag on a wine that needs naming', () => {
  it('shows the flag only on the item the gateway flagged', async () => {
    draw(
      <>
        <NameThisWineHint inventoryId="inv-1" />
        <NameThisWineHint inventoryId="inv-2" />
      </>,
    )
    const hints = await screen.findAllByTestId('name-this-wine-hint')
    expect(hints).toHaveLength(1)
    expect(hints[0]).toHaveTextContent(FLAG)
  })

  it('names the wine through the ordinary item edit, with the house\'s own name', async () => {
    api.patch.mockImplementation(async () => {
      research = [{ ...research[0], status: 'queued', flag: null }]
      return { data: {} }
    })
    draw(<NameThisWine inventoryId="inv-1" currentName="Wine 2" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Name this wine' }))
    const input = screen.getByLabelText("The wine's name")
    expect(input).toHaveValue('Wine 2')
    fireEvent.change(input, { target: { value: '  Kavaklıdere Yakut 2019 ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/inventory/rest-A/item/inv-1', { wineName: 'Kavaklıdere Yakut 2019' }),
    )
    expect(await screen.findByTestId('name-this-wine-says')).toHaveTextContent(
      'Saved. We will look this wine up by its new name.',
    )
    expect(screen.queryByText(FLAG)).toBeNull()
  })

  it('says so when the new name is still a placeholder', async () => {
    api.patch.mockResolvedValue({ data: {} })
    draw(<NameThisWine inventoryId="inv-1" currentName="Wine 2" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Name this wine' }))
    fireEvent.change(screen.getByLabelText("The wine's name"), { target: { value: 'house red' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }))
    expect(await screen.findByTestId('name-this-wine-says')).toHaveTextContent(
      'Saved. That name still does not say which wine this is.',
    )
  })

  // Last call, 2026-09-21: a failed re-read left the old list in the cache,
  // and the old status was worded as the new one.
  it('promises nothing about the lookup when the list cannot be re-read after the save', async () => {
    let reads = 0
    api.get.mockImplementation(async (path: string) => {
      if (path !== '/inventory/research') throw new Error(`unexpected GET ${path}`)
      reads += 1
      if (reads > 1) throw new Error('research list unreadable')
      return { data: { items: research } }
    })
    api.patch.mockResolvedValue({ data: {} })
    draw(<NameThisWine inventoryId="inv-1" currentName="Wine 2" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Name this wine' }))
    fireEvent.change(screen.getByLabelText("The wine's name"), { target: { value: 'Kavaklıdere Yakut 2019' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }))
    const says = await screen.findByTestId('name-this-wine-says')
    expect(says).toHaveTextContent(/^Saved\.$/)
    expect(reads).toBeGreaterThan(1)
  })

  it("shows the gateway's own words when the save fails", async () => {
    api.patch.mockRejectedValue({
      response: { data: { message: 'The name was saved, but whether this wine can now be looked up was not recorded (x).' } },
    })
    draw(<NameThisWine inventoryId="inv-1" currentName="Wine 2" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Name this wine' }))
    fireEvent.change(screen.getByLabelText("The wine's name"), { target: { value: 'Barolo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }))
    expect(await screen.findByTestId('name-this-wine-problem')).toHaveTextContent(/The name was saved, but/)
  })

  it('a blank name is not sent', async () => {
    draw(<NameThisWine inventoryId="inv-1" currentName="" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Name this wine' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save the name' }))
    expect(await screen.findByTestId('name-this-wine-problem')).toBeInTheDocument()
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('shows nothing for a wine that is queued or matched', async () => {
    draw(<NameThisWine inventoryId="inv-2" currentName="Barolo" />)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.queryByTestId('name-this-wine')).toBeNull()
  })

  it('a failed read is said once, never shown as nothing to name', async () => {
    api.get.mockRejectedValue(new Error('permission denied'))
    draw(
      <>
        <NameThisWineHint inventoryId="inv-1" />
        <HouseItemResearchUnread />
      </>,
    )
    expect(await screen.findByTestId('house-item-research-unread')).toHaveTextContent(
      /could not be read \(permission denied\)\. That is a failed read/,
    )
    expect(screen.queryByTestId('name-this-wine-hint')).toBeNull()
  })
})
