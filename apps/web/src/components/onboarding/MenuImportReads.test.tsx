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

import { AxiosError } from 'axios'
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

  it.each([
    ['a timeout', Object.assign(new AxiosError('timeout of 30000ms exceeded', 'ECONNABORTED'), { request: {} })],
    ['a server failure with no words', { response: { status: 502, data: {} } }],
  ])('after %s, does not offer to read the page again and points to Menus kept (F-793)', async (_label, err) => {
    importMenu.mockRejectedValueOnce(err)
    render(<MenuScanUpload onSuccess={vi.fn()} />)
    await act(async () => {
      captured!('iVBORw0KGgo=')
    })
    expect(
      await screen.findByText(
        'No answer came back from the menu read. It may still be reading and keeping this menu: give it a few minutes and look for it under Menus kept before reading it again.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.queryByText(/timeout|30000/)).toBeNull()
    expect(importMenu).toHaveBeenCalledTimes(1)
  })

  it('still offers "Try again" when the server said why it did not read (F-793)', async () => {
    importMenu.mockRejectedValueOnce({ response: { status: 503, data: { message: 'Menu scan service temporarily unavailable' } } })
    render(<MenuScanUpload onSuccess={vi.fn()} />)
    await act(async () => {
      captured!('iVBORw0KGgo=')
    })
    expect(await screen.findByText('Menu scan service temporarily unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('does not promise a read time the page cannot keep (F-793)', async () => {
    importMenu.mockReturnValueOnce(new Promise(() => {}))
    render(<MenuScanUpload onSuccess={vi.fn()} />)
    await act(async () => {
      captured!('iVBORw0KGgo=')
    })
    expect(screen.getByText('A long menu can take a few minutes')).toBeInTheDocument()
    expect(screen.queryByText(/10–20 seconds/)).toBeNull()
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
