/**
 * Several files at once: each is read and kept as its own draft. The first
 * proof shows the first file (whose photo the form holds) and says how many
 * others were kept, instead of the last file's lines beside the first photo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MenuCsvUpload } from './MenuCsvUpload'
import { importMenu, type MenuImportResult } from '../../services/api/menus'

vi.mock('../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../services/api/menus')>('../../services/api/menus')
  return { ...actual, importMenu: vi.fn() }
})
const mockImport = vi.mocked(importMenu)

const read = (menuId: string): MenuImportResult => ({ menuId, itemsExtracted: 1, submissionsCreated: 0, items: [] })
const csv = (name: string) => new File([`name,price\n${name},10\n`], `${name}.csv`, { type: 'text/csv' })

async function sendFiles(files: File[]) {
  const onSuccess = vi.fn()
  const { container } = render(<MenuCsvUpload onSuccess={onSuccess} />)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(input, { target: { files } })
  const button = await screen.findByRole('button', { name: files.length > 1 ? `Import ${files.length} files` : /Import/ })
  await waitFor(() => expect(button).not.toBeDisabled())
  fireEvent.click(button)
  await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  return onSuccess
}

beforeEach(() => mockImport.mockReset())

describe('MenuCsvUpload -- several files', () => {
  it('shows the first file and counts the others kept', async () => {
    mockImport.mockResolvedValueOnce(read('first')).mockResolvedValueOnce(read('second')).mockResolvedValueOnce(read('third'))
    const onSuccess = await sendFiles([csv('a'), csv('b'), csv('c')])
    expect(mockImport).toHaveBeenCalledTimes(3)
    expect(onSuccess.mock.calls[0][0]).toMatchObject({ menuId: 'first', otherKept: 2 })
  })

  it('a file that failed is not counted as kept', async () => {
    mockImport.mockResolvedValueOnce(read('first')).mockRejectedValueOnce(new Error('no')).mockResolvedValueOnce(read('third'))
    const onSuccess = await sendFiles([csv('a'), csv('b'), csv('c')])
    expect(onSuccess.mock.calls[0][0]).toMatchObject({ menuId: 'first', otherKept: 1 })
  })

  it('one file says nothing about others', async () => {
    mockImport.mockResolvedValueOnce(read('only'))
    const onSuccess = await sendFiles([csv('a')])
    expect(onSuccess.mock.calls[0][0]).toEqual(read('only'))
  })
})
