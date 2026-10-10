/**
 * Typed menu import after a send with no answer (sim ledger F-808).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const importMenu = vi.fn()
vi.mock('../../services/api/menus', () => ({
  importMenu: (...args: unknown[]) => importMenu(...args),
}))

// A lira house: its currency and the country it groups figures by.
const houseCurrency = vi.fn()
vi.mock('../../services/api/settings', () => ({
  settingsApi: { houseCurrency: () => houseCurrency() },
}))

import { AxiosError } from 'axios'
import { setHouseCurrency } from '../../lib/houseCurrency'
import { MenuManualEntry } from './MenuManualEntry'

const NO_ANSWER =
  'No answer came back from the menu read. It may still be reading and keeping this menu: give it a few minutes and look for it under Menus kept before reading it again.'

beforeEach(() => {
  importMenu.mockReset()
  houseCurrency.mockReset()
  houseCurrency.mockResolvedValue({ readable: true, code: 'TRY', country: 'Turkey' })
  localStorage.setItem('activeRestaurantId', 'r1')
})

function typeWine(name: string) {
  fireEvent.change(screen.getByPlaceholderText('e.g. Château Margaux 2018'), { target: { value: name } })
}

describe('MenuManualEntry', () => {
  it.each([
    ['a timeout', Object.assign(new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'), { request: {} })],
    ['a server failure with no words', { response: { status: 502, data: {} } }],
  ])('after %s, does not offer Import again and points to Menus kept (F-808)', async (_label, err) => {
    importMenu.mockRejectedValueOnce(err)
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    typeWine('Efes Pilsen')
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 wine' }))
    expect(await screen.findByText(NO_ANSWER)).toBeInTheDocument()
    expect(screen.queryByText(/timeout|30000/)).toBeNull()
    const button = screen.getByRole('button', { name: 'Import 1 wine' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(importMenu).toHaveBeenCalledTimes(1)
    // The typed rows stay for reference.
    expect(screen.getByDisplayValue('Efes Pilsen')).toBeInTheDocument()
  })

  it('keeps Import when the server said why it did not import (F-808)', async () => {
    importMenu.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Each wine needs a name.' } } })
    importMenu.mockResolvedValueOnce({ menuId: 'm1', items: [] })
    const onSuccess = vi.fn()
    render(<MenuManualEntry onSuccess={onSuccess} />)
    typeWine('Efes Pilsen')
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 wine' }))
    expect(await screen.findByText('Each wine needs a name.')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Import 1 wine' })
    expect(button).not.toBeDisabled()
    fireEvent.click(button)
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(importMenu).toHaveBeenCalledTimes(2)
  })

  // F-1000: a lira house was asked for "Glass ($)", and "45,50" in a number
  // input became an empty value — the wine imported with no price, no word.
  it('labels the prices in the house currency and reads "45,50" the way the house writes it (F-1000)', async () => {
    importMenu.mockResolvedValueOnce({ menuId: 'm1', items: [] })
    setHouseCurrency('TRY')
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    expect(screen.getByRole('columnheader', { name: 'Glass (TRY)' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Bottle (TRY)' })).toBeInTheDocument()
    expect(screen.queryByText(/\(\$\)/)).toBeNull()
    typeWine('Kavaklıdere Yakut')
    fireEvent.change(screen.getByLabelText('Glass price, row 1'), { target: { value: '45,50' } })
    fireEvent.change(screen.getByLabelText('Bottle price, row 1'), { target: { value: '1250' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 wine' }))
    await vi.waitFor(() => expect(importMenu).toHaveBeenCalledTimes(1))
    expect(importMenu.mock.calls[0][1].items[0]).toMatchObject({ by_glass_price: 45.5, bottle_price: 1250 })
  })

  it('refuses a price it cannot read instead of importing the wine unpriced (F-1000)', () => {
    render(<MenuManualEntry onSuccess={vi.fn()} />)
    typeWine('Kavaklıdere Yakut')
    fireEvent.change(screen.getByLabelText('Glass price, row 1'), { target: { value: 'forty' } })
    expect(screen.getByRole('alert')).toHaveTextContent('“forty” is not a price.')
    const button = screen.getByRole('button', { name: 'Import 1 wine' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(importMenu).not.toHaveBeenCalled()
  })
})
