/**
 * Walk r21 D6: the country box had no role and its list no options, so a
 * screen reader heard a bare text box. It is an ARIA combobox now.
 */
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CountryCombobox } from './CountryCombobox'

function Labelled({ onChange = vi.fn(), initial = '' }: { onChange?: (v: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <label htmlFor="c">Country · required</label>
      <CountryCombobox id="c" value={value} onChange={(v) => { setValue(v); onChange(v) }} />
    </>
  )
}

describe('CountryCombobox', () => {
  it('is a combobox named by its label, with a list it controls', () => {
    render(<Labelled />)
    const box = screen.getByRole('combobox', { name: 'Country · required' })
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(box).toHaveAttribute('aria-autocomplete', 'list')
    fireEvent.focus(box)
    expect(box).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox', { name: 'Countries' })
    expect(box).toHaveAttribute('aria-controls', list.id)
    expect(screen.getAllByRole('option').length).toBeGreaterThan(100)
  })

  it('is named "Country" when no label can point at it', () => {
    render(<CountryCombobox value="" onChange={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'Country' })).toBeInTheDocument()
  })

  it('moves through the list with the arrow keys and picks with Enter', () => {
    const onChange = vi.fn()
    render(<Labelled onChange={onChange} />)
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'turk' } })
    onChange.mockClear()
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    const first = screen.getAllByRole('option')[0]
    expect(box).toHaveAttribute('aria-activedescendant', first.id)
    const enter = fireEvent.keyDown(box, { key: 'Enter' })
    expect(enter).toBe(false) // the pick is not also the form's Enter
    expect(onChange).toHaveBeenCalledWith(first.textContent)
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(box).not.toHaveAttribute('aria-activedescendant')
  })

  it('leaves Enter to the form when nothing is highlighted', () => {
    render(<Labelled />)
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'turk' } })
    expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(true)
  })

  it('closes on Escape, and says which country is chosen', () => {
    render(<Labelled initial="Turkey" />)
    const box = screen.getByRole('combobox')
    fireEvent.focus(box)
    expect(screen.getByRole('option', { name: 'Turkey' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(box).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('picks with the mouse as before', () => {
    const onChange = vi.fn()
    render(<Labelled onChange={onChange} />)
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'germ' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Germany' }))
    expect(onChange).toHaveBeenLastCalledWith('Germany')
    expect(box).toHaveValue('Germany')
  })
})
