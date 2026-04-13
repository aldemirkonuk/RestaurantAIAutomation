import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { WineTypeBar } from '../../atoms/WineTypeBar'

describe('WineTypeBar', () => {
  const mockData = {
    red: 40,
    white: 30,
    sparkling: 15,
    rose: 10,
    dessert: 5,
  }

  it('renders all wine type segments', () => {
    const { container } = render(<WineTypeBar data={mockData} />)
    
    const segments = container.querySelectorAll('div[title]')
    expect(segments.length).toBe(5)
  })

  it('returns null for empty data', () => {
    const { container } = render(
      <WineTypeBar data={{ red: 0, white: 0, sparkling: 0, rose: 0, dessert: 0 }} />
    )
    
    expect(container.firstChild).toBeNull()
  })

  it('shows labels when showLabels is true', () => {
    const { container } = render(<WineTypeBar data={mockData} showLabels />)
    
    // Check for label text (values >= 3 show labels)
    expect(container.textContent).toContain('40')
    expect(container.textContent).toContain('30')
  })

  it('applies different heights', () => {
    const { container: small } = render(<WineTypeBar data={mockData} height="sm" />)
    const { container: large } = render(<WineTypeBar data={mockData} height="lg" />)
    
    expect(small.querySelector('.h-5')).toBeInTheDocument()
    expect(large.querySelector('.h-8')).toBeInTheDocument()
  })

  it('calculates percentages correctly', () => {
    const { container } = render(<WineTypeBar data={mockData} />)
    
    // Red should be 40% of total (40/100)
    const redSegment = container.querySelector('[title="Red: 40"]')
    expect(redSegment).toBeInTheDocument()
    expect(redSegment).toHaveStyle({ width: '40%' })
  })
})
