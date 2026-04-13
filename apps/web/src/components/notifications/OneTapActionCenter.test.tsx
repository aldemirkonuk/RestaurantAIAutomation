import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../__tests__/utils/test-utils'
import { OneTapActionCenter } from './OneTapActionCenter'

describe('OneTapActionCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the action center with title', () => {
    renderWithProviders(<OneTapActionCenter />)
    expect(screen.getByText(/One-Tap Actions/i)).toBeInTheDocument()
  })

  it('displays action items', () => {
    renderWithProviders(<OneTapActionCenter />)
    
    // Should show some mock actions
    expect(screen.getByText(/Penfolds Grange/i)).toBeInTheDocument()
    expect(screen.getByText(/Only 2 bottles left/i)).toBeInTheDocument()
  })

  it('allows filtering by priority', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OneTapActionCenter />)
    
    // Find and click filter button
    const filterButton = screen.getByRole('button', { name: /filter/i })
    await user.click(filterButton)
    
    // Check if filter options appear
    expect(screen.getByText(/All Actions/i)).toBeInTheDocument()
  })

  it('allows selecting actions with checkbox', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OneTapActionCenter />)
    
    // Find checkboxes (they don't have accessible names, so we find by role)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes.length).toBeGreaterThan(0)
    
    // Click first action checkbox
    await user.click(checkboxes[1]) // First is select-all
    
    // Should show batch action UI
    await waitFor(() => {
      expect(screen.getByText(/1 selected/i)).toBeInTheDocument()
    })
  })

  it('shows keyboard shortcut indicator', () => {
    renderWithProviders(<OneTapActionCenter />)
    expect(screen.getByText('⌘N')).toBeInTheDocument()
  })

  it('handles select all checkbox', async () => {
    const user = userEvent.setup()
    renderWithProviders(<OneTapActionCenter />)
    
    // Find and click select-all checkbox
    const selectAllCheckbox = screen.getAllByRole('checkbox')[0]
    await user.click(selectAllCheckbox)
    
    // Should show batch actions for multiple items
    await waitFor(() => {
      expect(screen.getByText(/selected/i)).toBeInTheDocument()
    })
  })

  it('displays action priority badges correctly', () => {
    renderWithProviders(<OneTapActionCenter />)
    
    // Check for priority indicators
    const criticalActions = screen.getAllByText(/Only 2 bottles left/i)
    expect(criticalActions.length).toBeGreaterThan(0)
  })

  it('shows timestamps for actions', () => {
    renderWithProviders(<OneTapActionCenter />)
    
    // Check for relative timestamps
    expect(screen.getByText(/mins ago/i) || screen.getByText(/Today/i)).toBeInTheDocument()
  })
})
