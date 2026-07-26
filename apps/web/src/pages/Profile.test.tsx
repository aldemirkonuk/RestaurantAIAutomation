import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../__tests__/utils/test-utils'
import { useAuth } from '../contexts/AuthContext'
import Profile from './Profile'

vi.mock('../services/api/profile', () => ({
  profileApi: {
    getMe: vi.fn().mockResolvedValue({
      userId: 'u1',
      email: 'test@wineops.com',
      name: 'Test User',
      phone: '+14155552671',
      role: 'manager',
      hasPassword: true,
      linkedProviders: { google: true, microsoft: false },
    }),
    updateMe: vi.fn(),
    changePassword: vi.fn(),
    linkProvider: vi.fn(),
    unlinkProvider: vi.fn(),
  },
}))

vi.mock('../components/layout/Header', () => ({
  Header: ({ title }: { title?: string }) => <div data-testid="header">{title}</div>,
}))

describe('Profile page', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        userId: 'u1',
        email: 'test@wineops.com',
        name: 'Test User',
        restaurantId: 'rest-1',
        role: 'manager',
      },
      loading: false,
      logout: vi.fn(),
      availableRestaurants: [
        { id: 'rest-1', name: 'Nob Hill Wine Bar', city: 'SF', chain_id: null, chain_name: null },
      ],
      activeRestaurantId: 'rest-1',
      activeRole: 'manager',
      setActiveRestaurantId: vi.fn(),
      refreshBranches: vi.fn(),
    } as any)
  })

  it('renders account sections and left rail', async () => {
    renderWithProviders(<Profile />)
    expect(screen.getByTestId('header')).toHaveTextContent('Profile')
    expect(screen.getByLabelText(/profile sections/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByDisplayValue('Test User')).toBeInTheDocument()
    })
    expect(screen.getByRole('heading', { name: 'Linked accounts' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Danger zone' })).toBeInTheDocument()
  })

  it('shows manager rail sections for managers', async () => {
    renderWithProviders(<Profile />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('Test User')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Restaurant' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Payment' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Memberships' })).toBeInTheDocument()
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument()
  })

  it('hides manager sections for staff', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        userId: 'u1',
        email: 'staff@wineops.com',
        name: 'Staff User',
        restaurantId: 'rest-1',
        role: 'staff',
      },
      loading: false,
      logout: vi.fn(),
      availableRestaurants: [],
      activeRestaurantId: 'rest-1',
      activeRole: 'staff',
      setActiveRestaurantId: vi.fn(),
      refreshBranches: vi.fn(),
    } as any)

    renderWithProviders(<Profile />)
    await waitFor(() => {
      expect(screen.getByDisplayValue('Staff User')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Restaurant' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Payment' })).not.toBeInTheDocument()
  })

  it('shows upgrade stub for owners', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: {
        userId: 'u1',
        email: 'owner@wineops.com',
        name: 'Owner',
        restaurantId: 'rest-1',
        role: 'owner',
      },
      loading: false,
      logout: vi.fn(),
      availableRestaurants: [],
      activeRestaurantId: 'rest-1',
      activeRole: 'owner',
      setActiveRestaurantId: vi.fn(),
      refreshBranches: vi.fn(),
    } as any)

    renderWithProviders(<Profile />)
    await waitFor(() => {
      expect(screen.getByText('Coming soon')).toBeInTheDocument()
    })
  })
})
