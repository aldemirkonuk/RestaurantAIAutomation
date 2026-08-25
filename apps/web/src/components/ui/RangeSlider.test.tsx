import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RangeSlider } from './RangeSlider'

describe('RangeSlider', () => {
  it('exposes a native slider role so keyboard and AT support come for free', () => {
    render(<RangeSlider value={2} max={5} onChange={vi.fn()} label="Within" />)
    const slider = screen.getByRole('slider')
    expect(slider).toHaveAttribute('aria-label', 'Within')
  })

  it('substitutes the max label at the top of the range', () => {
    render(
      <RangeSlider value={5} max={5} onChange={vi.fn()} maxLabel="Any distance" format={(v) => `${v} km`} />,
    )
    expect(screen.getByText('Any distance')).toBeInTheDocument()
    expect(screen.queryByText('5 km')).not.toBeInTheDocument()
  })

  it('formats the value below the max', () => {
    render(
      <RangeSlider value={2} max={5} onChange={vi.fn()} maxLabel="Any distance" format={(v) => `${v} km`} />,
    )
    expect(screen.getByText('2 km')).toBeInTheDocument()
  })

  it('reports a numeric value on change', () => {
    const onChange = vi.fn()
    render(<RangeSlider value={2} max={5} onChange={onChange} label="Within" />)

    fireEvent.change(screen.getByRole('slider'), { target: { value: '4' } })

    // Number, not the string the DOM hands back — callers index arrays with it.
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('is a real range input, which is what supplies arrow-key stepping', () => {
    // jsdom does not implement native range keyboard behaviour, so asserting on
    // arrow keys here would test the environment rather than the component.
    // Keeping the native input is the thing that guarantees it in a browser.
    render(<RangeSlider value={2} max={5} onChange={vi.fn()} label="Within" />)
    const slider = screen.getByRole('slider')
    expect(slider.tagName).toBe('INPUT')
    expect(slider).toHaveAttribute('type', 'range')
    expect(slider).toHaveAttribute('step', '1')
  })

  it('clamps a value supplied outside the range', () => {
    render(<RangeSlider value={99} max={5} onChange={vi.fn()} format={(v) => `${v}`} />)
    expect(screen.getByRole('slider')).toHaveValue('5')
  })

  it('can be disabled', () => {
    render(<RangeSlider value={2} max={5} onChange={vi.fn()} disabled />)
    expect(screen.getByRole('slider')).toBeDisabled()
  })
})
