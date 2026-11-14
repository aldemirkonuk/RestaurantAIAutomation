/**
 * r28 onboarding gap 12: a photo sent through the file box is fitted for the
 * reader and sent as bare base64; a PDF goes as it is and gives the first
 * proof no image to draw.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { importMenu, fitPhotoForReading } = vi.hoisted(() => ({
  importMenu: vi.fn(),
  fitPhotoForReading: vi.fn(),
}))
vi.mock('../../services/api/menus', () => ({ importMenu }))
vi.mock('../../lib/fitPhoto', () => ({ fitPhotoForReading }))

import { MenuCsvUpload } from './MenuCsvUpload'

const onSuccess = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  importMenu.mockResolvedValue({ menuId: 'm-1', items: [] })
})

describe('MenuCsvUpload sends a photo fitted', () => {
  it('a dropped photo is fitted, sent as the fitted bare base64, and the proof gets the fitted data URL', async () => {
    fitPhotoForReading.mockResolvedValue({ base64: '/9j/FIT', dataUrl: 'data:image/jpeg;base64,/9j/FIT', mime: 'image/jpeg', fitted: true })
    render(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={[new File(['a'], 'menu.jpg', { type: 'image/jpeg' })]} />)
    fireEvent.click(await screen.findByRole('button', { name: /Import/ }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(fitPhotoForReading).toHaveBeenCalledWith('YQ==')
    expect(importMenu).toHaveBeenCalledWith('scan', { imageBase64: '/9j/FIT' })
    expect(onSuccess).toHaveBeenCalledWith({ menuId: 'm-1', items: [] }, { image: 'data:image/jpeg;base64,/9j/FIT' })
  })

  it('a PDF gives the proof no image', async () => {
    fitPhotoForReading.mockResolvedValue({ base64: 'JVBERi0=', dataUrl: null, mime: 'application/pdf', fitted: false })
    render(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={[new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' })]} />)
    fireEvent.click(await screen.findByRole('button', { name: /Import/ }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(importMenu).toHaveBeenCalledWith('scan', { imageBase64: 'JVBERi0=' })
    expect(onSuccess).toHaveBeenCalledWith({ menuId: 'm-1', items: [] }, { image: null })
  })

  it('a workbook gives the proof no image', async () => {
    const book = new File([new Uint8Array([80, 75, 3, 4])], 'menu.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    render(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={[book]} />)
    fireEvent.click(await screen.findByRole('button', { name: /Import/ }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(importMenu).toHaveBeenCalledWith('csv', { fileBase64: 'UEsDBA==' })
    expect(fitPhotoForReading).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledWith({ menuId: 'm-1', items: [] }, { image: null })
  })

  it('a spreadsheet is never sent through the photo fitter', async () => {
    render(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={[new File(['name,price\nRaki,100\n'], 'menu.csv', { type: 'text/csv' })]} />)
    fireEvent.click(await screen.findByRole('button', { name: /Import/ }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(fitPhotoForReading).not.toHaveBeenCalled()
    expect(onSuccess).toHaveBeenCalledWith({ menuId: 'm-1', items: [] }, { image: null })
  })
})
