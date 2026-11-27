import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { VerifyEmail } from './VerifyEmail'
import { useAuth } from '../contexts/AuthContext'
import { apiClient } from '../services/api/client'
import { getOnboardingProgress } from '../services/api/menus'

/**
 * After the address is verified the page routes on "has a house", read from
 * `GET /auth/houses` (the rule the phone uses): nothing held and no house
 * opens one (/get-started on the web, ADR 0213), anything held goes to the
 * chooser, a session already in a house keeps the menu check, and a failed
 * read stays on the page and says so with a "Try again".
 */

vi.mock('../contexts/AuthContext', () => ({ useAuth: vi.fn() }))
vi.mock('../services/api/client', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
  getErrorMessage: () => 'failed',
}))
vi.mock('../services/api/menus', () => ({ getOnboardingProgress: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const HOUSE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '')
const tokenIn = (restaurantId: string | null) =>
  `${b64({ alg: 'none' })}.${b64({ sub: 'u1', email: 'p@house.test', restaurantId })}.sig`

let hrefSet: string[]
const realLocation = window.location

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.clearAllMocks()
  localStorage.clear()
  hrefSet = []
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      ...realLocation,
      set href(v: string) {
        hrefSet.push(v)
      },
    },
  })
  vi.mocked(useAuth).mockReturnValue({
    user: { userId: 'u1', email: 'p@house.test', emailVerified: false },
    loading: false,
    logout: vi.fn(),
  } as never)
  vi.mocked(getOnboardingProgress).mockResolvedValue({ menu_uploaded: false } as never)
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

function verifyAs(tokenHouse: string | null) {
  vi.mocked(apiClient.post).mockResolvedValue({
    data: { accessToken: tokenIn(tokenHouse), refreshToken: 'r' },
  } as never)
  render(
    <MemoryRouter initialEntries={['/verify-email?token=abc']}>
      <VerifyEmail />
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: /Verify my email/i }))
}

const arrives = async () => {
  await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1600)
  })
  return hrefSet.at(-1)
}

describe('VerifyEmail routes on whether the account has a house', () => {
  it('no house and nothing held opens a first house', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { houses: [], held: [] } } as never)
    verifyAs(null)
    expect(await arrives()).toBe('/get-started')
    expect(apiClient.get).toHaveBeenCalledWith('/auth/houses')
  })

  it('a session already in a house with nothing held keeps the menu check', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { houses: [{ id: HOUSE_ID, name: 'Moda' }], held: [] },
    } as never)
    vi.mocked(getOnboardingProgress).mockResolvedValue({ menu_uploaded: true } as never)
    verifyAs(HOUSE_ID)
    expect(await arrives()).toBe('/')
    expect(getOnboardingProgress).toHaveBeenCalled()
  })

  it('anything held goes to the chooser, never to open a house', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { houses: [], held: [{ membershipId: 'm1', id: HOUSE_ID, name: 'Moda' }] },
    } as never)
    verifyAs(null)
    expect(await arrives()).toBe('/choose-house')
  })

  it('a failed read stays on the page, says so, and Try again reads again', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('503'))
    verifyAs(null)
    const notice = await screen.findByTestId('verify-houses-unread')
    expect(notice).toHaveTextContent(/couldn.t read your houses/i)
    expect(hrefSet).toEqual([])
    expect(screen.queryByRole('button', { name: /Verify my email/i })).toBeNull()

    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { houses: [], held: [] } } as never)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await arrives()).toBe('/get-started')
    expect(apiClient.get).toHaveBeenCalledTimes(2)
    expect(apiClient.post).toHaveBeenCalledTimes(1)
  })

  it('an answer that is not the houses shape is a failed read, never "no houses"', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: {} } as never)
    verifyAs(null)
    expect(await screen.findByTestId('verify-houses-unread')).toBeInTheDocument()
    expect(hrefSet).toEqual([])
  })
})
