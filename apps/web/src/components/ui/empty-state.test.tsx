import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './empty-state'

describe('EmptyState', () => {
  it('renders with title and description', () => {
    render(
      <EmptyState
        title="No items found"
        description="Try adjusting your filters"
      />
    )
    
    expect(screen.getByText('No items found')).toBeInTheDocument()
    expect(screen.getByText('Try adjusting your filters')).toBeInTheDocument()
  })

  it('renders with custom icon', () => {
    const TestIcon = () => <svg data-testid="test-icon" />
    render(
      <EmptyState
        title="Test"
        description="Testing"
        icon={<TestIcon />}
      />
    )
    
    expect(screen.getByTestId('test-icon')).toBeInTheDocument()
  })

  it('renders action button when provided', () => {
    render(
      <EmptyState
        title="No wines"
        description="Add your first wine"
        action={{
          label: 'Add Wine',
          onClick: () => {},
        }}
      />
    )
    
    expect(screen.getByRole('button', { name: 'Add Wine' })).toBeInTheDocument()
  })

  it('renders without action button', () => {
    render(
      <EmptyState
        title="No data"
        description="No description"
      />
    )
    
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
