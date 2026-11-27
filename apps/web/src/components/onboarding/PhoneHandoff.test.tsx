/** DD-r108-56: on a computer, photograph the menu with the phone. */
import { act, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { listMenuVersions, media, authUser, navigate } = vi.hoisted(() => ({
  listMenuVersions: vi.fn(),
  media: { desk: true, reduced: false },
  authUser: { current: { name: 'Selin Kaya', restaurantId: 'house-a', role: 'owner', emailVerified: true } },
  navigate: vi.fn(),
}))

vi.mock('../../services/api/menus', () => ({ listMenuVersions, importMenu: vi.fn() }))
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: authUser.current,
    loading: false,
    createFirstHouse: vi.fn(),
    signInWithSession: vi.fn(),
    availableRestaurants: [{ id: 'house-a', name: 'Meyhane' }],
  }),
}))
vi.mock('../../lib/houseMenuStanding', () => ({ readHouseMenuStanding: () => Promise.resolve('none') }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('./MenuCsvUpload', () => ({ MenuCsvUpload: () => null }))
vi.mock('./MenuScanUpload', () => ({ MenuScanUpload: () => null }))
vi.mock('./MenuManualEntry', () => ({ MenuManualEntry: () => null }))

import { PhoneHandoff, WATCH_EVERY_MS, WATCH_FOR_MS, handoffAddress } from './PhoneHandoff'
import GetStarted from '../../pages/GetStarted'

const version = (menuId: string, linesExtracted: number | null) => ({ menuId, linesExtracted, status: 'draft', current: false })
const answer = (...versions: ReturnType<typeof version>[]) => ({ current: null, lastUsed: null, versions })

function mount() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PhoneHandoff restaurantId="house-a" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Advance, then let the query's batched notice (a 0 ms timer) land. */
const tick = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
    await vi.advanceTimersByTimeAsync(1)
  })

const arrival = () => screen.queryByText(/Your phone.s read is in\./)

let animateSpy: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  media.desk = true
  media.reduced = false
  authUser.current = { name: 'Selin Kaya', restaurantId: 'house-a', role: 'owner', emailVerified: true }
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('pointer: fine') ? media.desk : query.includes('reduced-motion') ? media.reduced : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
  animateSpy = vi.fn()
  ;(Element.prototype as unknown as { animate: unknown }).animate = animateSpy
})
afterEach(() => {
  vi.useRealTimers()
  delete (Element.prototype as unknown as { animate?: unknown }).animate
})

describe('PhoneHandoff on the computer', () => {
  it('is not drawn on a coarse pointer', () => {
    media.desk = false
    mount()
    expect(screen.queryByTestId('phone-handoff')).toBeNull()
    expect(listMenuVersions).not.toHaveBeenCalled()
  })

  it('draws a 160 px QR with no token in it, and its caption', () => {
    listMenuVersions.mockResolvedValue(answer())
    mount()
    const svg = screen.getByTestId('phone-handoff').querySelector('svg')!
    expect(svg.getAttribute('height')).toBe('160')
    expect(screen.getByText('Use your phone’s camera')).toBeInTheDocument()
    expect(handoffAddress('https://app.example', 'house-a')).toBe('https://app.example/get-started?from=desk&house=house-a')
  })

  it('a menu new since the baseline says the read is in, with a link to /menu', async () => {
    listMenuVersions.mockResolvedValueOnce(answer(version('old', 10))).mockResolvedValue(answer(version('old', 10), version('new', 7)))
    mount()
    await tick(0)
    expect(arrival()).toBeNull()
    await tick(WATCH_EVERY_MS)
    expect(arrival()).not.toBeNull()
    expect(screen.getByRole('link', { name: 'Check it on Menu' })).toHaveAttribute('href', '/menu')
    const calls = listMenuVersions.mock.calls.length
    await tick(WATCH_EVERY_MS * 3)
    expect(listMenuVersions.mock.calls.length).toBe(calls) // stops on arrival
  })

  it('an old draft is not news, and a new menu with no lines is not either', async () => {
    listMenuVersions.mockResolvedValue(answer(version('old-draft', 12), version('empty', 0)))
    mount()
    await tick(0)
    listMenuVersions.mockResolvedValue(answer(version('old-draft', 12), version('empty', 0), version('blank', 0)))
    await tick(WATCH_EVERY_MS * 3)
    expect(arrival()).toBeNull()
  })

  it('re-reads every 4 s and stops at 10 min, focus included', async () => {
    listMenuVersions.mockResolvedValue(answer(version('old', 10)))
    mount()
    await tick(0)
    expect(listMenuVersions).toHaveBeenCalledTimes(1)
    await tick(WATCH_EVERY_MS)
    expect(listMenuVersions).toHaveBeenCalledTimes(2)
    await tick(WATCH_FOR_MS)
    const atTheEnd = listMenuVersions.mock.calls.length
    expect(atTheEnd).toBeLessThanOrEqual(WATCH_FOR_MS / WATCH_EVERY_MS + 2)
    await tick(WATCH_FOR_MS)
    await act(async () => {
      window.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(listMenuVersions.mock.calls.length).toBe(atTheEnd)
  })

  it('fades the arrival in over 180 ms with motion on', async () => {
    listMenuVersions.mockResolvedValueOnce(answer()).mockResolvedValue(answer(version('new', 4)))
    mount()
    await tick(0)
    await tick(WATCH_EVERY_MS)
    expect(arrival()).not.toBeNull()
    expect(animateSpy).toHaveBeenCalledTimes(1)
    expect(animateSpy.mock.calls[0][1]).toMatchObject({ duration: 180, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' })
  })

  it('under reduced motion the line arrives with zero animations', async () => {
    media.reduced = true
    listMenuVersions.mockResolvedValueOnce(answer()).mockResolvedValue(answer(version('new', 4)))
    mount()
    await tick(0)
    await tick(WATCH_EVERY_MS)
    expect(arrival()).not.toBeNull()
    expect(animateSpy).not.toHaveBeenCalled()
  })
})

describe('GetStarted on the phone the QR opened', () => {
  const at = (path: string) =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <GetStarted />
        </MemoryRouter>
      </QueryClientProvider>,
    )

  it('a house other than its session offers ChooseHouse instead of reading', async () => {
    media.desk = false
    at('/get-started?from=desk&house=house-b')
    await tick(0)
    expect(screen.getByTestId('desk-house-mismatch')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Choose the house' })).toHaveAttribute('href', '/choose-house')
    expect(screen.queryByText('Drop the menu here')).toBeNull()
  })

  it('its own house reads, names the house, and draws no QR of its own', async () => {
    media.desk = true
    at('/get-started?from=desk&house=house-a')
    await tick(0)
    expect(screen.getByText('Drop the menu here')).toBeInTheDocument()
    expect(screen.getByTestId('reading-for')).toHaveTextContent('Reading for Meyhane.')
    expect(screen.queryByTestId('phone-handoff')).toBeNull()
  })

  it('signed out, the sign-in keeps the house it was asked for', async () => {
    authUser.current = null as unknown as typeof authUser.current
    at('/get-started?from=desk&house=house-a')
    await tick(0)
    expect(navigate).toHaveBeenCalledWith('/login?redirect=%2Fget-started%3Ffrom%3Ddesk%26house%3Dhouse-a', { replace: true })
  })
})
