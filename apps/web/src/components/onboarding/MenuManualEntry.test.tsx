/** Walk 2026-11-11: the typed-lines price headings said "($)" in a TRY house. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))

import { importMenu } from '../../services/api/menus'
import { LINE_KINDS, MenuManualEntry } from './MenuManualEntry'

describe('MenuManualEntry price headings', () => {
  it("name the house's currency code when it is known", () => {
    render(<MenuManualEntry onSuccess={vi.fn()} currency="TRY" />)
    expect(screen.getByRole('columnheader', { name: 'Glass (TRY)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Bottle (TRY)' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('$')
  })

  it('name no currency when none is known, never a dollar sign', () => {
    render(<MenuManualEntry onSuccess={vi.fn()} currency={null} />)
    expect(screen.getByRole('columnheader', { name: 'Glass' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Bottle' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('$')
  })
})

// apps/api-gateway/src/menus/wine-extract-item.interface.ts MENU_CATEGORY_VOCABULARY
const GATEWAY_VOCABULARY = [
  'red', 'white', 'rose', 'sparkling', 'orange', 'dessert', 'fortified',
  'beer', 'cider', 'sake', 'cocktail', 'spirit', 'whiskey', 'soft drink', 'non-alcoholic',
]

describe('MenuManualEntry takes any line', () => {
  beforeEach(() => {
    vi.mocked(importMenu).mockReset()
    vi.mocked(importMenu).mockResolvedValue({} as never)
  })

  const nameInput = (_n: number) => screen.getAllByRole('textbox')[0]
  const importedItems = () => (vi.mocked(importMenu).mock.calls[0][1] as unknown as { items: Array<Record<string, unknown>> }).items

  it('uses no wine-only words', () => {
    render(<MenuManualEntry onSuccess={vi.fn()} currency="TRY" />)
    expect(screen.getByRole('columnheader', { name: /^Name/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'What it is' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add another line/ })).toBeInTheDocument()
    const text = document.body.textContent ?? ''
    expect(text).not.toContain('Wine Name')
    expect(text).not.toContain('wine name')
    expect(text).not.toContain('Add another wine')
  })

  it('sends a food line as food with no price', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(nameInput(1), { target: { value: 'Lamb shank' } })
    fireEvent.change(screen.getByLabelText('What line 1 is'), { target: { value: 'food' } })
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(screen.getByText('Dishes stay on the menu; Mudavym does not price them yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importMenu).toHaveBeenCalledWith('manual', { items: [expect.objectContaining({ name: 'Lamb shank', category: 'food' })] })
    expect(importedItems()[0]).not.toHaveProperty('by_glass_price')
    expect(importedItems()[0]).not.toHaveProperty('bottle_price')
  })

  it('keeps the prices of a beer line', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(nameInput(1), { target: { value: 'Efes draft' } })
    fireEvent.change(screen.getByLabelText('What line 1 is'), { target: { value: 'beer' } })
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).toMatchObject({ name: 'Efes draft', category: 'beer', by_glass_price: 6 })
  })

  it('clears the prices when a priced row is switched to Food', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(nameInput(1), { target: { value: 'Mystery' } })
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('What line 1 is'), { target: { value: 'food' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).not.toHaveProperty('bottle_price')
    expect(importedItems()[0]).not.toHaveProperty('by_glass_price')
  })

  it('sends no category key when no kind is chosen', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(nameInput(1), { target: { value: 'Negroni' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).not.toHaveProperty('category')
  })

  it('offers exactly the gateway drink vocabulary plus food', () => {
    const values = LINE_KINDS.map((k) => k.value).filter((v) => v !== '' && v !== 'food')
    expect(values).toEqual(GATEWAY_VOCABULARY)
    expect(LINE_KINDS[0]).toEqual({ label: 'Choose…', value: '' })
    expect(LINE_KINDS.at(-1)).toEqual({ label: 'Food', value: 'food' })
  })
})
