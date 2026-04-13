import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../__tests__/utils/test-utils'
import { Header } from './Header'

describe('Header', () => {
  it('renders with title', () => {
    renderWithProviders(<Header title="Dashboard" />)
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
  })

  it('renders with title and subtitle', () => {
    renderWithProviders(
      <Header title="Inventory" subtitle="Manage your wine collection" />
    )
    
    expect(screen.getByText('Inventory')).toBeInTheDocument()
    expect(screen.getByText('Manage your wine collection')).toBeInTheDocument()
  })

  it('renders without subtitle', () => {
    renderWithProviders(<Header title="Orders" />)
    expect(screen.getByText('Orders')).toBeInTheDocument()
    expect(screen.queryByText('subtitle')).not.toBeInTheDocument()
  })
})
