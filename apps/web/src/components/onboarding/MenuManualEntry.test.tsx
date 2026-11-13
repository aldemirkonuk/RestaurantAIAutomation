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

  // Menu r21: a typed dish lost its price, where a read menu keeps "Tiramisu 9"
  // on its line (bottle_price) and /menu shows and changes it.
  it('sends a food line as food with its one price, kept on the line', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(nameInput(1), { target: { value: 'Lamb shank' } })
    fireEvent.change(screen.getByLabelText('What line 1 is'), { target: { value: 'food' } })
    expect(screen.queryByLabelText('Glass price of line 1')).toBeNull()
    expect(screen.queryByLabelText('Bottle price of line 1')).toBeNull()
    expect(screen.getByText("The dish's price stays on the menu; no stock is made for it.")).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Price of line 1'), { target: { value: '24.5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).toMatchObject({ name: 'Lamb shank', category: 'food', bottle_price: 24.5 })
    expect(importedItems()[0]).not.toHaveProperty('by_glass_price')
  })

  it('a dish typed with no price is sent with none', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(nameInput(1), { target: { value: 'Bread' } })
    fireEvent.change(screen.getByLabelText('What line 1 is'), { target: { value: 'food' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).not.toHaveProperty('bottle_price')
    expect(importedItems()[0]).not.toHaveProperty('by_glass_price')
  })

  it('keeps the prices of a beer line', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(nameInput(1), { target: { value: 'Efes draft' } })
    fireEvent.change(screen.getByLabelText('What line 1 is'), { target: { value: 'beer' } })
    fireEvent.change(screen.getByLabelText('Glass price of line 1'), { target: { value: '6' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).toMatchObject({ name: 'Efes draft', category: 'beer', by_glass_price: 6 })
  })

  it('a priced row switched to Food keeps its price as the dish price and drops the glass price', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(nameInput(1), { target: { value: 'Mystery' } })
    fireEvent.change(screen.getByLabelText('Glass price of line 1'), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText('Bottle price of line 1'), { target: { value: '40' } })
    fireEvent.change(screen.getByLabelText('What line 1 is'), { target: { value: 'food' } })
    expect(screen.getByLabelText('Price of line 1')).toHaveValue('40')
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).toMatchObject({ bottle_price: 40 })
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

// Onboarding r22 D6: the typed lines had no names for a screen reader (only the
// dish price box did), and a `type=number` price box could not take "24,50".
describe('MenuManualEntry boxes are named, and a price is typed as the house writes it', () => {
  beforeEach(() => {
    vi.mocked(importMenu).mockReset()
    vi.mocked(importMenu).mockResolvedValue({} as never)
  })
  const importedItems = () => (vi.mocked(importMenu).mock.calls[0][1] as unknown as { items: Array<Record<string, unknown>> }).items

  it('names every box and the remove button by its line', () => {
    render(<MenuManualEntry onSuccess={vi.fn()} currency="TRY" />)
    fireEvent.click(screen.getByRole('button', { name: /Add another line/ }))
    for (const n of [1, 2]) {
      for (const name of [`Name of line ${n}`, `Producer of line ${n}`, `Vintage of line ${n}`, `Region of line ${n}`, `Glass price of line ${n}`, `Bottle price of line ${n}`]) {
        expect(screen.getByRole('textbox', { name })).toBeInTheDocument()
      }
      expect(screen.getByRole('combobox', { name: `What line ${n} is` })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `Remove line ${n}` })).toBeInTheDocument()
    }
    // A price box is text with the decimal keypad, never a number box.
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(screen.getByLabelText('Bottle price of line 1')).toHaveAttribute('inputmode', 'decimal')
  })

  it('hints the prices the way the house writes them: "14,00" in a lira house (r23 walk: "14.00")', () => {
    render(<MenuManualEntry onSuccess={vi.fn()} currency="TRY" />)
    expect(screen.getByLabelText('Glass price of line 1')).toHaveAttribute('placeholder', '14,00')
    expect(screen.getByLabelText('Bottle price of line 1')).toHaveAttribute('placeholder', '68,00')
    fireEvent.change(screen.getByLabelText('What line 1 is'), { target: { value: 'food' } })
    expect(screen.getByLabelText('Price of line 1')).toHaveAttribute('placeholder', '24,00')
  })

  it('hints a pound house the English way', () => {
    render(<MenuManualEntry onSuccess={vi.fn()} currency="GBP" />)
    expect(screen.getByLabelText('Glass price of line 1')).toHaveAttribute('placeholder', '14.00')
  })

  it('a price typed exactly as its hint is read as that price, never refused', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} currency="TRY" />)
    fireEvent.change(screen.getByLabelText('Name of line 1'), { target: { value: 'Yakut' } })
    for (const label of ['Glass price of line 1', 'Bottle price of line 1']) {
      const box = screen.getByLabelText(label)
      fireEvent.change(box, { target: { value: box.getAttribute('placeholder') } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).toMatchObject({ by_glass_price: 14, bottle_price: 68 })
  })

  it('reads "24,50" on a dish as 24.50', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name of line 1'), { target: { value: 'Lamb shank' } })
    fireEvent.change(screen.getByLabelText('What line 1 is'), { target: { value: 'food' } })
    fireEvent.change(screen.getByLabelText('Price of line 1'), { target: { value: '24,50' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).toMatchObject({ name: 'Lamb shank', category: 'food', bottle_price: 24.5 })
  })

  it('reads a comma glass price and a grouped bottle price on a drink', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name of line 1'), { target: { value: 'Kavaklidere Yakut' } })
    fireEvent.change(screen.getByLabelText('Glass price of line 1'), { target: { value: '45,50' } })
    fireEvent.change(screen.getByLabelText('Bottle price of line 1'), { target: { value: '1.250,00 TL' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).toMatchObject({ by_glass_price: 45.5, bottle_price: 1250 })
  })

  it('refuses "1,250", says why at the box, and imports nothing until it is fixed', async () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name of line 1'), { target: { value: 'Raki' } })
    const bottle = screen.getByLabelText('Bottle price of line 1')
    fireEvent.change(bottle, { target: { value: '1,250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    expect(screen.getByRole('alert').textContent).toBe('One price could not be read. Fix it below; nothing was imported.')
    expect(importMenu).not.toHaveBeenCalled()
    expect(bottle).toHaveAttribute('aria-invalid', 'true')
    expect(bottle).toHaveAccessibleDescription('"1,250" is not a price: it could be 1250 or 1.25; write it as 1250 or 1.25.')
    // Typing in the box takes the mark away; the fixed price is sent.
    fireEvent.change(bottle, { target: { value: '1250' } })
    expect(bottle).not.toHaveAttribute('aria-invalid')
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    await waitFor(() => expect(importMenu).toHaveBeenCalled())
    expect(importedItems()[0]).toMatchObject({ bottle_price: 1250 })
  })

  it('refuses a minus and letters, counting each refused box', () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Name of line 1'), { target: { value: 'Efes' } })
    fireEvent.change(screen.getByLabelText('Glass price of line 1'), { target: { value: '-5' } })
    fireEvent.change(screen.getByLabelText('Bottle price of line 1'), { target: { value: 'ten' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 line' }))
    expect(screen.getByRole('alert').textContent).toBe('2 prices could not be read. Fix them below; nothing was imported.')
    expect(importMenu).not.toHaveBeenCalled()
  })
})
