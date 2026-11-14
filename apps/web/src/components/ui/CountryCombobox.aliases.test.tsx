/** r31 walk F4: "Türkiye", "USA" and "UK" found nothing in the country box. */
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CountryCombobox } from './CountryCombobox'

function Box({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('')
  return <CountryCombobox value={value} onChange={(v) => { setValue(v); onChange(v) }} />
}

describe('CountryCombobox finds a country by any name', () => {
  it('offers Turkey for "Türkiye" and picks the display name', () => {
    const onChange = vi.fn()
    render(<Box onChange={onChange} />)
    const box = screen.getByRole('combobox', { name: 'Country' })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'Türkiye' } })
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Turkey'])
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('Turkey')
    expect(box).toHaveValue('Turkey')
  })

  it('offers United Kingdom first for "uk", before Ukraine', () => {
    render(<Box onChange={vi.fn()} />)
    const box = screen.getByRole('combobox', { name: 'Country' })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'uk' } })
    const names = screen.getAllByRole('option').map((o) => o.textContent)
    expect(names[0]).toBe('United Kingdom')
    expect(names).toContain('Ukraine')
  })

  it('offers United States for "USA"', () => {
    render(<Box onChange={vi.fn()} />)
    const box = screen.getByRole('combobox', { name: 'Country' })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'USA' } })
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('United States')
  })
})
