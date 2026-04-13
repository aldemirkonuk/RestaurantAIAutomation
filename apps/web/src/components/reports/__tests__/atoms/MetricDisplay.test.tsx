import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetricDisplay } from '../../atoms/MetricDisplay'

describe('MetricDisplay', () => {
  it('renders label and value', () => {
    render(<MetricDisplay value={1000} label="Total Revenue" />)
    
    expect(screen.getByText('Total Revenue')).toBeInTheDocument()
    expect(screen.getByText('1,000')).toBeInTheDocument()
  })

  it('formats currency correctly', () => {
    render(<MetricDisplay value={1234.56} label="Revenue" format="currency" />)
    
    expect(screen.getByText('$1,235')).toBeInTheDocument()
  })

  it('formats percentage correctly', () => {
    render(<MetricDisplay value={45.5} label="Margin" format="percentage" />)
    
    expect(screen.getByText('45.5%')).toBeInTheDocument()
  })

  it('handles string values', () => {
    render(<MetricDisplay value="$1,234" label="Custom" />)
    
    expect(screen.getByText('$1,234')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <MetricDisplay value={100} label="Test" className="custom-class" />
    )
    
    expect(container.firstChild).toHaveClass('custom-class')
  })
})
