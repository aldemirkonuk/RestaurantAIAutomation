/**
 * r28 onboarding gap 11: a PDF or a spreadsheet dropped on /get-started's
 * "Drop the menu here" opened the file box and the file was thrown away.
 * The file box now stages files handed to it by a drop, as if picked.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { importMenu } = vi.hoisted(() => ({ importMenu: vi.fn() }))
vi.mock('../../services/api/menus', () => ({ importMenu }))

import { MenuCsvUpload } from './MenuCsvUpload'

const onSuccess = vi.fn()
const pdf = () => new File(['%PDF-1.4 menu'], 'menu.pdf', { type: 'application/pdf' })
const csv = () => new File(['name,price\nAyran,40\nCacık,120\n'], 'menu.csv', { type: 'text/csv' })

beforeEach(() => {
  vi.clearAllMocks()
  importMenu.mockResolvedValue({ menuId: 'm-1', items: [] })
})

describe('MenuCsvUpload stages a dropped file', () => {
  it('a dropped PDF is named and imported with "Import the menu"', async () => {
    render(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={[pdf()]} />)
    expect(await screen.findByText('menu.pdf')).toBeInTheDocument()
    const go = await screen.findByRole('button', { name: 'Import the menu' })
    await waitFor(() => expect(go).not.toBeDisabled())
    fireEvent.click(go)
    await waitFor(() => expect(importMenu).toHaveBeenCalledTimes(1))
    expect(importMenu.mock.calls[0][0]).toBe('scan')
    expect(typeof importMenu.mock.calls[0][1].imageBase64).toBe('string')
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('a dropped CSV shows its rows, as a picked one does', async () => {
    render(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={[csv()]} />)
    expect(await screen.findByText('menu.csv')).toBeInTheDocument()
    expect(await screen.findByText('Ayran')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 2 lines' })).toBeInTheDocument()
  })

  it('a dropped file the box does not take is named in words, not dropped silently', async () => {
    const doc = new File(['x'], 'menu.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    render(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={[doc]} />)
    expect(await screen.findByText(/"menu\.docx" is not a spreadsheet, CSV, PDF, or image\./)).toBeInTheDocument()
    expect(importMenu).not.toHaveBeenCalled()
  })

  it('several dropped files queue as several picked ones do', async () => {
    render(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={[pdf(), csv()]} />)
    expect(await screen.findByText('+1 more queued')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import 2 files' })).toBeInTheDocument()
  })

  it('the same drop is staged once: a re-render does not undo a change of file', async () => {
    const drop = [pdf()]
    const { rerender } = render(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={drop} />)
    expect(await screen.findByText('menu.pdf')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Change file'))
    expect(screen.queryByText('menu.pdf')).toBeNull()
    rerender(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={drop} />)
    expect(screen.queryByText('menu.pdf')).toBeNull()
    expect(screen.getByText('Click to upload file')).toBeInTheDocument()
  })

  it('with nothing dropped the box waits for a pick', () => {
    render(<MenuCsvUpload onSuccess={onSuccess} droppedFiles={null} />)
    expect(screen.getByText('Click to upload file')).toBeInTheDocument()
  })
})
