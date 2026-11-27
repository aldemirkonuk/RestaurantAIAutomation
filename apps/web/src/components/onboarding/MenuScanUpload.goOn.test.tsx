/**
 * r109 onboarding g4: a background read that runs on offers the house, with
 * the read going on and the bell (#2234) saying when it ends.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  importMenu: vi.fn(),
  release: null as null | ((v: unknown) => void),
  fail: null as null | ((e: unknown) => void),
  onReading: null as null | ((menuId: string) => void),
}))
vi.mock('../../services/api/menus', () => ({
  importMenu: h.importMenu,
  readRefusalWords: (_e: unknown, fallback: string) => fallback,
}))
vi.mock('../../lib/fitPhoto', () => ({
  fitPhotoForReading: async (img: string) => ({ base64: 'AAAA', dataUrl: img }),
}))
vi.mock('../scanner/CameraCapture', () => ({
  CameraCapture: ({ onCapture }: { onCapture: (image: string) => void }) => (
    <button type="button" onClick={() => onCapture('data:image/jpeg;base64,AAAA')}>
      Take the photo
    </button>
  ),
}))

import { GO_ON_AFTER_MS, MenuScanUpload } from './MenuScanUpload'
import { MENU_READING_KEY } from '../../lib/houseMenuReading'

const HELD = 'This can take a minute. Go on to your house; we will ring when it is read.'
const onSuccess = vi.fn()
const onGoOn = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.setItem('activeRestaurantId', 'h1')
  h.importMenu.mockImplementation(
    (_m: string, _d: unknown, labels: { onReading?: (id: string) => void }) =>
      new Promise((resolve, reject) => {
        h.release = resolve
        h.fail = reject
        h.onReading = labels?.onReading ?? null
      }),
  )
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

async function sendPhoto() {
  render(<MenuScanUpload onSuccess={onSuccess} onGoOn={onGoOn} />)
  fireEvent.click(screen.getByRole('button', { name: 'Take the photo' }))
  await act(async () => {})
}

describe('MenuScanUpload: go on to the house while the menu is read', () => {
  it('offers nothing until the server says it is reading, however long the upload takes', async () => {
    await sendPhoto()
    await act(async () => vi.advanceTimersByTime(GO_ON_AFTER_MS * 10))
    expect(screen.queryByText(HELD)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Go on to the house' })).not.toBeInTheDocument()
  })

  it('offers the house only once the read has run three seconds', async () => {
    await sendPhoto()
    act(() => h.onReading?.('m-1'))
    await act(async () => vi.advanceTimersByTime(GO_ON_AFTER_MS - 1))
    expect(screen.queryByText(HELD)).not.toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(1))
    expect(screen.getByText(HELD)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go on to the house' })).toHaveClass('min-h-11')
  })

  it('a read that ends inside three seconds goes to the proof and never offers', async () => {
    await sendPhoto()
    act(() => h.onReading?.('m-1'))
    await act(async () => h.release?.({ menuId: 'm-1', items: [] }))
    await act(async () => vi.advanceTimersByTime(GO_ON_AFTER_MS * 2))
    expect(onSuccess).toHaveBeenCalledWith({ menuId: 'm-1', items: [] }, { image: 'data:image/jpeg;base64,AAAA' })
    expect(screen.queryByText(HELD)).not.toBeInTheDocument()
  })

  it('going on keeps {houseId, menuId}, opens the house, and the later ending pulls nobody back', async () => {
    await sendPhoto()
    act(() => h.onReading?.('m-1'))
    await act(async () => vi.advanceTimersByTime(GO_ON_AFTER_MS))
    fireEvent.click(screen.getByRole('button', { name: 'Go on to the house' }))
    expect(onGoOn).toHaveBeenCalledTimes(1)
    expect(JSON.parse(sessionStorage.getItem(MENU_READING_KEY) ?? '{}')).toMatchObject({ houseId: 'h1', menuId: 'm-1' })
    await act(async () => h.release?.({ menuId: 'm-1', items: [] }))
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('a failure after going on says nothing here', async () => {
    await sendPhoto()
    act(() => h.onReading?.('m-1'))
    await act(async () => vi.advanceTimersByTime(GO_ON_AFTER_MS))
    fireEvent.click(screen.getByRole('button', { name: 'Go on to the house' }))
    await act(async () => h.fail?.(new Error('read failed')))
    expect(screen.queryByText('The menu was not read. Please try again.')).not.toBeInTheDocument()
  })

  it('with no way on given (another page), nothing is offered', async () => {
    render(<MenuScanUpload onSuccess={onSuccess} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take the photo' }))
    await act(async () => {})
    act(() => h.onReading?.('m-1'))
    await act(async () => vi.advanceTimersByTime(GO_ON_AFTER_MS * 2))
    expect(screen.queryByText(HELD)).not.toBeInTheDocument()
  })
})
