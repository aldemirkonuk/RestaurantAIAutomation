/**
 * r106 onboarding (#2123 review): a photo the browser cannot redraw (a HEIC in
 * Chrome) is sent whole by fitPhotoForReading. Over the gateway's 15 MB body it
 * would be a bare 413 that also drops the files queued behind it. It is refused
 * in words, naming it, and the queue goes on.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { importMenu, fitPhotoForReading } = vi.hoisted(() => ({
  importMenu: vi.fn(),
  fitPhotoForReading: vi.fn(),
}))
vi.mock('../../services/api/menus', () => ({
  importMenu,
  readRefusalWords: (e: any, fallback: string) => e?.message || fallback,
}))
vi.mock('../../lib/fitPhoto', () => ({ fitPhotoForReading }))

import { MenuCsvUpload } from './MenuCsvUpload'

const MB = 1024 * 1024
const sized = (name: string, type: string, mb: number) => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: mb * MB })
  return f
}

beforeEach(() => {
  vi.clearAllMocks()
  importMenu.mockResolvedValue({ menuId: 'm-1', items: [] })
})

describe('MenuCsvUpload with a photo the browser cannot shrink', () => {
  it('a 12 MB HEIC is refused at staging, in words, and the PDF is staged', async () => {
    render(
      <MenuCsvUpload
        onSuccess={vi.fn()}
        droppedFiles={[sized('IMG.HEIC', 'image/heic', 12), new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })]}
      />,
    )
    expect(await screen.findByText('menu.pdf')).toBeInTheDocument()
    expect(screen.getByText(/IMG\.HEIC/)).toBeInTheDocument()
    expect(screen.getByText(/the limit is 10\.0 MB/)).toBeInTheDocument()
  })

  it('a photo that arrives unfitted and over the limit is never sent; the PDF behind it still goes', async () => {
    const huge = 'A'.repeat(Math.ceil((12 * MB * 4) / 3))
    fitPhotoForReading.mockResolvedValueOnce({ base64: huge, dataUrl: 'data:image/jpeg;base64,x', mime: 'image/jpeg', fitted: false })
    fitPhotoForReading.mockResolvedValue({ base64: 'JVBERi0=', dataUrl: null, mime: 'application/pdf', fitted: false })
    const onSuccess = vi.fn()
    render(
      <MenuCsvUpload
        onSuccess={onSuccess}
        droppedFiles={[new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.pdf', { type: 'application/pdf' })]}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Import/ }))
    await waitFor(() => expect(screen.getByText(/cannot shrink it/)).toBeInTheDocument())
    expect(importMenu).not.toHaveBeenCalledWith('scan', { imageBase64: huge })
    expect(importMenu).toHaveBeenCalledWith('scan', { imageBase64: 'JVBERi0=' })
    expect(onSuccess).toHaveBeenCalled()
  })
})
