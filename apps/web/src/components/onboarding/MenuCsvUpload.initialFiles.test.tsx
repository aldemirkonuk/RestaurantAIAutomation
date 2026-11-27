import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../services/api/menus', () => ({
  importMenu: vi.fn(),
  readRefusalWords: (_e: unknown, fallback: string) => fallback,
}))
import { MenuCsvUpload } from './MenuCsvUpload'

afterEach(cleanup)

// r105 g4: a PDF dropped on the first-menu step opened this panel and the file
// was lost. The panel now takes the dropped files as if chosen here.
it('takes the files dropped on the menu step as if they were chosen here', async () => {
  const pdf = new File([new Uint8Array(10)], 'menu.pdf', { type: 'application/pdf' })
  render(<MenuCsvUpload onSuccess={vi.fn()} droppedFiles={[pdf]} />)
  expect(await screen.findByText(/menu\.pdf/)).toBeInTheDocument()
})

it('shows no file when nothing was dropped', () => {
  render(<MenuCsvUpload onSuccess={vi.fn()} />)
  expect(screen.queryByText(/menu\.pdf/)).not.toBeInTheDocument()
})

// r105 review: the panel read initialFiles (now droppedFiles) once, at mount. A drop that lands
// while it is open, or a second drop, was taken by nobody and gave no error.
it('takes a drop that lands after the panel is already open', async () => {
  const pdf = new File([new Uint8Array(10)], 'menu.pdf', { type: 'application/pdf' })
  const { rerender } = render(<MenuCsvUpload onSuccess={vi.fn()} droppedFiles={[]} />)
  expect(screen.queryByText(/menu\.pdf/)).not.toBeInTheDocument()
  rerender(<MenuCsvUpload onSuccess={vi.fn()} droppedFiles={[pdf]} />)
  expect(await screen.findByText(/menu\.pdf/)).toBeInTheDocument()
})

it('takes a second drop, replacing the first', async () => {
  const first = new File([new Uint8Array(10)], 'first.pdf', { type: 'application/pdf' })
  const second = new File([new Uint8Array(10)], 'second.pdf', { type: 'application/pdf' })
  const { rerender } = render(<MenuCsvUpload onSuccess={vi.fn()} droppedFiles={[first]} />)
  expect(await screen.findByText(/first\.pdf/)).toBeInTheDocument()
  rerender(<MenuCsvUpload onSuccess={vi.fn()} droppedFiles={[second]} />)
  expect(await screen.findByText(/second\.pdf/)).toBeInTheDocument()
})
