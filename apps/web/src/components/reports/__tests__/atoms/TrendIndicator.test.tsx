import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TrendIndicator } from '../../atoms/TrendIndicator'

describe('TrendIndicator', () => {
  it('shows increase trend with positive change', () => {
    render(<TrendIndicator change={5.5} changeType="increase" />)
    
    expect(screen.getByText('+5.5%')).toBeInTheDocument()
    expect(screen.getByText('+5.5%')).toHaveClass('text-emerald-600')
  })

  it('shows decrease trend with negative change', () => {
    render(<TrendIndicator change={-3.2} changeType="decrease" />)
    
    expect(screen.getByText('-3.2%')).toBeInTheDocument()
    expect(screen.getByText('-3.2%')).toHaveClass('text-rose-600')
  })

  it('auto-detects increase from positive number', () => {
    render(<TrendIndicator change={8.0} />)
    
    expect(screen.getByText('+8%')).toBeInTheDocument()
  })

  it('auto-detects decrease from negative number', () => {
    render(<TrendIndicator change={-2.5} />)
    
    expect(screen.getByText('-2.5%')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <TrendIndicator change={5} className="custom-class" />
    )
    
    expect(container.firstChild).toHaveClass('custom-class')
  })
})
