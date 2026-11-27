import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { hasInstallPrompt, showInstallPrompt } = vi.hoisted(() => ({
  hasInstallPrompt: vi.fn(),
  showInstallPrompt: vi.fn(),
}))
vi.mock('../../lib/installPrompt', () => ({ hasInstallPrompt, showInstallPrompt }))

import { KeepOnPhone } from './KeepOnPhone'

const media = (on: string[]) =>
  vi.fn((q: string) => ({ matches: on.includes(q), media: q, addEventListener() {}, removeEventListener() {} }))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  hasInstallPrompt.mockReturnValue(true)
  showInstallPrompt.mockResolvedValue(true)
  window.matchMedia = media(['(pointer: coarse)']) as unknown as typeof window.matchMedia
})
afterEach(() => vi.restoreAllMocks())

describe('KeepOnPhone', () => {
  it('is hidden on a fine pointer', () => {
    window.matchMedia = media([]) as unknown as typeof window.matchMedia
    render(<KeepOnPhone />)
    expect(screen.queryByTestId('keep-on-phone')).toBeNull()
  })

  it('is hidden when already a Home Screen app', () => {
    window.matchMedia = media(['(pointer: coarse)', '(display-mode: standalone)']) as unknown as typeof window.matchMedia
    render(<KeepOnPhone />)
    expect(screen.queryByTestId('keep-on-phone')).toBeNull()
  })

  it('calls the saved prompt on a press', () => {
    render(<KeepOnPhone />)
    fireEvent.click(screen.getByRole('button', { name: 'Add to Home Screen' }))
    expect(showInstallPrompt).toHaveBeenCalledTimes(1)
  })

  it('says the steps in words on iOS, where there is no event', () => {
    hasInstallPrompt.mockReturnValue(false)
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')
    render(<KeepOnPhone />)
    expect(screen.getByText('Tap Share, then Add to Home Screen.')).toBeTruthy()
    expect(screen.getByText(/reach you with a push/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to Home Screen' })).toBeNull()
  })

  it('Not now hides it and remembers', () => {
    const first = render(<KeepOnPhone />)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByTestId('keep-on-phone')).toBeNull()
    first.unmount()
    render(<KeepOnPhone />)
    expect(screen.queryByTestId('keep-on-phone')).toBeNull()
  })

  it('still renders when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<KeepOnPhone />)
    expect(screen.getByTestId('keep-on-phone')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByTestId('keep-on-phone')).toBeNull()
  })
})
