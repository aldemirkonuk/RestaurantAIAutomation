import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingSkeleton } from './loading-skeleton'

describe('LoadingSkeleton', () => {
  it('renders a basic skeleton', () => {
    const { container } = render(<LoadingSkeleton />)
    const skeleton = container.querySelector('.animate-pulse')
    expect(skeleton).toBeInTheDocument()
  })

  it('accepts custom className', () => {
    const { container } = render(<LoadingSkeleton className="h-20 w-20" />)
    const skeleton = container.querySelector('.h-20')
    expect(skeleton).toBeInTheDocument()
  })

  it('renders with default styling', () => {
    const { container } = render(<LoadingSkeleton />)
    const skeleton = container.querySelector('.bg-gray-200')
    expect(skeleton).toBeInTheDocument()
  })
})
