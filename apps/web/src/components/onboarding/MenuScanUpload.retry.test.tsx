/**
 * r28 onboarding gap 13: the photo box's "Retry" only cleared the message,
 * so the owner had to take the photo again with nothing said. It now sends
 * the same photo again, and the wait says "Reading your menu…".
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { importMenu } = vi.hoisted(() => ({ importMenu: vi.fn() }))
vi.mock('../../services/api/menus', () => ({ importMenu }))
vi.mock('../scanner/CameraCapture', () => ({
  CameraCapture: ({ onCapture }: { onCapture: (image: string) => void }) => (
    <button type="button" onClick={() => onCapture('data:image/jpeg;base64,AAAA')}>
      Take the photo
    </button>
  ),
}))

import { MenuScanUpload } from './MenuScanUpload'

const onSuccess = vi.fn()

beforeEach(() => vi.clearAllMocks())

describe('MenuScanUpload sends the same photo again', () => {
  it('after a refused read, "Send this photo again" sends that photo, and a read then goes on', async () => {
    importMenu
      .mockRejectedValueOnce(Object.assign(new Error('Network Error'), { response: { status: 503, data: { message: 'The reader is busy.' } } }))
      .mockResolvedValueOnce({ menuId: 'm-1', items: [] })
    render(<MenuScanUpload onSuccess={onSuccess} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take the photo' }))
    const again = await screen.findByRole('button', { name: 'Send this photo again' })
    fireEvent.click(again)
    await waitFor(() => expect(importMenu).toHaveBeenCalledTimes(2))
    expect(importMenu.mock.calls[1]).toEqual(['scan', { imageBase64: 'data:image/jpeg;base64,AAAA' }])
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({ menuId: 'm-1', items: [] }, { image: 'data:image/jpeg;base64,AAAA' }),
    )
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('the wait says it is reading, with no word about AI', async () => {
    let finish: (value: unknown) => void = () => undefined
    importMenu.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    render(<MenuScanUpload onSuccess={onSuccess} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take the photo' }))
    expect(await screen.findByText('Reading your menu…')).toBeInTheDocument()
    expect(screen.queryByText(/AI/)).toBeNull()
    finish({ menuId: 'm-1', items: [] })
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })
})
