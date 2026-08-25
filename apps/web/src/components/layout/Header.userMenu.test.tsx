import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../__tests__/utils/test-utils'
import { Header } from './Header'
import { useAuth } from '../../contexts/AuthContext'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

vi.mock('../../hooks/queries', () => ({
  useNotifications: vi.fn(() => ({ data: [], refetch: vi.fn(), isLoading: false })),
  useMarkNotificationAsRead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useMarkAllNotificationsAsRead: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

vi.mock('../../stores', () => ({
  useNotificationStore: vi.fn((selector: (s: any) => any) =>
    selector({ unreadCount: 0, setUnreadCount: vi.fn() }),
  ),
}))

describe('Header user menu navigation', () => {
  beforeEach(() => {
    navigateMock.mockClear()
    vi.mocked(useAuth).mockReturnValue({
      user: {
        userId: 'test-user-id',
        email: 'test@wineops.com',
        name: 'Test User',
        restaurantId: 'rest-1',
        role: 'manager',
      },
      loading: false,
      logout: vi.fn(),
      availableRestaurants: [],
      activeRestaurantId: 'rest-1',
      activeRole: 'manager',
      setActiveRestaurantId: vi.fn(),
      refreshBranches: vi.fn(),
    } as any)
  })

  it('navigates to /profile from user menu', async () => {
    renderWithProviders(<Header title="Dashboard" />)
    fireEvent.click(screen.getByLabelText(/user menu/i))
    fireEvent.click(screen.getByLabelText(/view profile/i))
    expect(navigateMock).toHaveBeenCalledWith('/profile')
  })

  it('navigates to /settings from user menu', async () => {
    renderWithProviders(<Header title="Dashboard" />)
    fireEvent.click(screen.getByLabelText(/user menu/i))
    fireEvent.click(screen.getByLabelText(/open settings/i))
    expect(navigateMock).toHaveBeenCalledWith('/settings')
  })

  it('navigates to /help from user menu', async () => {
    renderWithProviders(<Header title="Dashboard" />)
    fireEvent.click(screen.getByLabelText(/user menu/i))
    fireEvent.click(screen.getByLabelText(/get help and support/i))
    expect(navigateMock).toHaveBeenCalledWith('/help')
  })
})
