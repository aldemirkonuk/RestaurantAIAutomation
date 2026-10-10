/**
 * What the menu import says it read (sim ledger F-011, F-014, F-015, F-016,
 * F-017, F-018).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'

const importMenu = vi.fn()
vi.mock('../../services/api/menus', () => ({
  importMenu: (...args: unknown[]) => importMenu(...args),
}))

let captured: ((b64: string) => void) | null = null
vi.mock('../scanner/CameraCapture', () => ({
  CameraCapture: ({ onFileUpload }: { onFileUpload: (b64: string) => void }) => {
    captured = onFileUpload
    return <div data-testid="camera" />
  },
}))

import { MenuScanUpload } from './MenuScanUpload'
import { MenuCsvUpload } from './MenuCsvUpload'

beforeEach(() => {
  importMenu.mockReset()
  captured = null
})

describe('MenuScanUpload', () => {
  it('"Try again" sends the same page again rather than only clearing the message (F-014)', async () => {
    importMenu.mockRejectedValueOnce(new Error('Menu scan service temporarily unavailable'))
    importMenu.mockResolvedValueOnce({ menuId: 'm1', items: [] })
    const onSuccess = vi.fn()
    render(<MenuScanUpload onSuccess={onSuccess} />)
    await act(async () => {
      captured!('iVBORw0KGgo=')
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(importMenu).toHaveBeenCalledTimes(2)
    expect(importMenu.mock.calls[1]).toEqual(['scan', { imageBase64: 'iVBORw0KGgo=' }])
  })

  it('speaks of the menu, not a wine list (F-016)', () => {
    render(<MenuScanUpload onSuccess={vi.fn()} />)
    expect(screen.queryByText(/wine list/i)).toBeNull()
    expect(screen.getByText('A photo of each page, or one PDF of the whole menu')).toBeInTheDocument()
  })
})

describe('MenuCsvUpload', () => {
  const pick = (text: string, name = 'drinks.csv') => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/csv' })] } })
  }

  it('names a column it will not read before anything is imported (F-017)', async () => {
    render(<MenuCsvUpload onSuccess={vi.fn()} />)
    pick('name,price,glass,notes\nEfes Pilsen,6,6,draft\n')
    const note = await screen.findByRole('status')
    expect(note).toHaveTextContent('These columns will not be read: price, notes.')
    expect(importMenu).not.toHaveBeenCalled()
  })

  it('counts lines, not wines, on the import button (F-018)', async () => {
    render(<MenuCsvUpload onSuccess={vi.fn()} />)
    pick('name,glass\nEfes Pilsen,6\nAyran,3\nYeni Rakı,9\n')
    expect(await screen.findByRole('button', { name: 'Import 3 lines' })).toBeInTheDocument()
    expect(screen.queryByText(/wines/i)).toBeNull()
  })
})
