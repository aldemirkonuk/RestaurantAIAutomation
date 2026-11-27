/**
 * r28 onboarding gap 12: the camera and the picker give bare base64. The
 * reader gets the fitted bare base64, and the first proof a data URL it can
 * draw (a bare string is not a URL).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { importMenu, fitPhotoForReading } = vi.hoisted(() => ({
  importMenu: vi.fn(),
  fitPhotoForReading: vi.fn(),
}))
vi.mock('../../services/api/menus', () => ({ importMenu }))
vi.mock('../../lib/fitPhoto', () => ({ fitPhotoForReading }))
vi.mock('../scanner/CameraCapture', () => ({
  CameraCapture: ({ onCapture }: { onCapture: (image: string) => void }) => (
    <button type="button" onClick={() => onCapture('/9j/WHOLE')}>
      Take the photo
    </button>
  ),
}))

import { MenuScanUpload } from './MenuScanUpload'

const onSuccess = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  importMenu.mockResolvedValue({ menuId: 'm-1', items: [] })
  fitPhotoForReading.mockResolvedValue({ base64: '/9j/FIT', dataUrl: 'data:image/jpeg;base64,/9j/FIT', mime: 'image/jpeg', fitted: true })
})

describe('MenuScanUpload sends the photo fitted', () => {
  it('a taken photo is fitted, the reader gets the fitted base64, and the proof its data URL', async () => {
    render(<MenuScanUpload onSuccess={onSuccess} />)
    fireEvent.click(screen.getByRole('button', { name: 'Take the photo' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(fitPhotoForReading).toHaveBeenCalledWith('/9j/WHOLE')
    expect(importMenu).toHaveBeenCalledWith('scan', { imageBase64: '/9j/FIT' })
    expect(onSuccess).toHaveBeenCalledWith({ menuId: 'm-1', items: [] }, { image: 'data:image/jpeg;base64,/9j/FIT' })
  })
})
