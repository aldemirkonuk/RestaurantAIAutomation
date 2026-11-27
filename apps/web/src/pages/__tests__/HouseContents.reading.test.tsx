/**
 * r109 onboarding g4: /house asks after the menu the owner left reading on
 * get-started, every 5 s while in view, for at most 10 minutes.
 */
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ readMenuStatus: vi.fn(), getOnboardingProgress: vi.fn() }))
vi.mock('../../services/api/menus', () => ({
  readMenuStatus: h.readMenuStatus,
  getOnboardingProgress: h.getOnboardingProgress,
}))
vi.mock('../../services/api/settings', () => ({ settingsApi: { houseCurrency: vi.fn().mockResolvedValue(null) } }))
vi.mock('../../services/api/documents', () => ({ documentsApi: { upload: vi.fn() } }))
vi.mock('../../services/api/arrival', () => ({ skipFolio: vi.fn() }))
vi.mock('../../services/api/vendors', () => ({ addCustomProvider: vi.fn(), matchVendorCatalogue: vi.fn().mockResolvedValue([]) }))
vi.mock('../../components/brand/BrandMark', () => ({ BrandMark: () => <span>Mudavym</span> }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'owner', restaurantId: 'h1' } }) }))

import HouseContents from '../HouseContents'
import { MENU_READING_KEY, writeMenuReading } from '../../lib/houseMenuReading'
import { READING_ASK_FOR_MS, READING_POLL_MS, elapsedWords } from '../../components/onboarding/MenuReadingLine'

const T0 = new Date('2026-11-27T12:00:00Z').getTime()
const reading = { menuId: 'm-1', state: 'reading', failure: null, warnings: [], reply: null }
const page = () => render(<MemoryRouter><HouseContents /></MemoryRouter>)
const flush = () => act(async () => {})
const pass = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
let visibility: DocumentVisibilityState = 'visible'
let shown: { mockRestore: () => void } | null = null

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(T0)
  vi.clearAllMocks()
  sessionStorage.clear()
  visibility = 'visible'
  shown = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  h.getOnboardingProgress.mockResolvedValue({ vendor_added: true })
  h.readMenuStatus.mockResolvedValue(reading)
  writeMenuReading({ houseId: 'h1', menuId: 'm-1', at: T0 })
})
afterEach(() => {
  vi.useRealTimers()
  shown?.mockRestore()
})

describe('/house: the menu still being read', () => {
  it('holds the menu row with the reading line, and asks every 5 s', async () => {
    page()
    await flush()
    const line = screen.getByTestId('house-menu-reading')
    expect(line).toHaveTextContent('Your menu is being read')
    expect(screen.queryByText('Looking at your menu…')).not.toBeInTheDocument()
    expect(h.readMenuStatus).toHaveBeenCalledTimes(1)
    expect(h.readMenuStatus).toHaveBeenCalledWith('m-1')
    await pass(READING_POLL_MS - 1)
    expect(h.readMenuStatus).toHaveBeenCalledTimes(1)
    await pass(1)
    expect(h.readMenuStatus).toHaveBeenCalledTimes(2)
  })

  it('says the elapsed time, moving every 10 s, outside the spoken region', async () => {
    page()
    await flush()
    expect(screen.getByTestId('house-menu-reading')).not.toHaveTextContent('·')
    await pass(40_000)
    const line = screen.getByTestId('house-menu-reading')
    expect(line).toHaveTextContent('Your menu is being read · 40 s')
    expect(line.querySelector('[aria-live="polite"]')).not.toHaveTextContent('40 s')
    expect(elapsedWords(80_000)).toBe('1 min 20 s')
    expect(elapsedWords(9_999)).toBeNull()
  })

  it('done: says the lines and links to Menu, and stops asking', async () => {
    h.readMenuStatus
      .mockResolvedValueOnce(reading)
      .mockResolvedValueOnce({ ...reading, state: 'done', reply: { menuId: 'm-1', itemsExtracted: 14, submissionsCreated: 0, items: [] } })
    page()
    await flush()
    await pass(READING_POLL_MS)
    const live = screen.getByTestId('house-menu-reading').querySelector('[aria-live="polite"]')
    expect(live).toHaveTextContent('Your menu is read: 14 lines. Check it on Menu')
    expect(screen.getByRole('link', { name: 'Check it on Menu' })).toHaveAttribute('href', '/menu')
    expect(sessionStorage.getItem(MENU_READING_KEY)).toBeNull()
    await pass(READING_POLL_MS * 4)
    expect(h.readMenuStatus).toHaveBeenCalledTimes(2)
  })

  it('failed: says it in words, with the reason, and Send it again goes to get-started', async () => {
    h.readMenuStatus.mockResolvedValueOnce({ ...reading, state: 'failed', failure: 'No line could be read from this file.' })
    page()
    await flush()
    expect(screen.getByText('Your menu could not be read.', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('No line could be read from this file.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Send it again' })).toHaveAttribute('href', '/get-started')
  })

  it('the swap fades in only where motion is allowed, with no percent bar', async () => {
    h.readMenuStatus.mockResolvedValueOnce({ ...reading, state: 'done', reply: { menuId: 'm-1', itemsExtracted: 1, submissionsCreated: 0, items: [] } })
    page()
    await flush()
    const words = screen.getByText('Your menu is read: 1 line.', { exact: false })
    expect(words).toHaveClass('motion-safe:animate-swap-in')
    expect(words.className).not.toMatch(/(^|\s)animate-/)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('a hidden tab asks nothing, and coming back asks at once', async () => {
    page()
    await flush()
    visibility = 'hidden'
    await pass(READING_POLL_MS * 6)
    expect(h.readMenuStatus).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(h.readMenuStatus).toHaveBeenCalledTimes(2)
  })

  it('stops asking after 10 minutes and leaves the read to the bell and Menu', async () => {
    page()
    await flush()
    await pass(READING_ASK_FOR_MS + READING_POLL_MS)
    const calls = h.readMenuStatus.mock.calls.length
    expect(calls).toBeLessThanOrEqual(READING_ASK_FOR_MS / READING_POLL_MS + 1)
    expect(screen.getByTestId('house-menu-reading')).toHaveTextContent('the bell rings when it is read')
    await pass(READING_POLL_MS * 4)
    expect(h.readMenuStatus).toHaveBeenCalledTimes(calls)
  })

  it("another house's menu is ignored: no line, no question", async () => {
    writeMenuReading({ houseId: 'h2', menuId: 'm-9', at: T0 })
    page()
    await flush()
    expect(screen.queryByTestId('house-menu-reading')).not.toBeInTheDocument()
    expect(h.readMenuStatus).not.toHaveBeenCalled()
  })

  it('a refused question (404) stops asking and says so', async () => {
    h.readMenuStatus.mockRejectedValueOnce(Object.assign(new Error('gone'), { response: { status: 404 } }))
    page()
    await flush()
    expect(screen.getByTestId('house-menu-reading')).toHaveTextContent("We could not ask after your menu's read.")
    await pass(READING_POLL_MS * 3)
    expect(h.readMenuStatus).toHaveBeenCalledTimes(1)
  })

  it('a missed question (503) is asked again on the next beat', async () => {
    h.readMenuStatus.mockRejectedValueOnce(Object.assign(new Error('busy'), { response: { status: 503 } }))
    page()
    await flush()
    await pass(READING_POLL_MS)
    expect(h.readMenuStatus).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('house-menu-reading')).toHaveTextContent('Your menu is being read')
  })
})
