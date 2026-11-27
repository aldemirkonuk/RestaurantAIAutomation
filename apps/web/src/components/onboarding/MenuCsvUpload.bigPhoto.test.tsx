/**
 * r106 onboarding-5 (g4, first-menu drop keeps every file): a phone photo over
 * the 10 MB upload cap was refused when it was dropped with other files, though
 * the box redraws a photo before sending it. Photos are exempt from the staging
 * cap; a PDF or a sheet keeps it. The order dropped is the order queued.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))

import { MenuCsvUpload } from './MenuCsvUpload'

const MB = 1024 * 1024
const big = (name: string, type: string, mb: number) => {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: mb * MB })
  return f
}

describe('MenuCsvUpload keeps every dropped file it can read', () => {
  it('a 15 MB photo dropped with a PDF and a second photo is staged, all three', async () => {
    render(
      <MenuCsvUpload
        onSuccess={vi.fn()}
        droppedFiles={[
          new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' }),
          big('IMG_1.jpg', 'image/jpeg', 15),
          big('IMG_2.jpg', 'image/jpeg', 2),
        ]}
      />,
    )
    expect(await screen.findByText('menu.pdf')).toBeInTheDocument()
    expect(screen.getByText('+2 more queued')).toBeInTheDocument()
    expect(screen.queryByText(/the limit is/)).toBeNull()
  })

  it('a PDF over the cap is still refused, in words, and the photo beside it stays', async () => {
    render(
      <MenuCsvUpload
        onSuccess={vi.fn()}
        droppedFiles={[big('huge.pdf', 'application/pdf', 15), big('IMG_1.jpg', 'image/jpeg', 15)]}
      />,
    )
    expect(await screen.findByText('IMG_1.jpg')).toBeInTheDocument()
    expect(screen.getByText(/huge\.pdf/)).toBeInTheDocument()
  })
})

describe('MenuCsvUpload counts the files-at-a-time limit once', () => {
  it('a PDF then 11 photos: one sentence, naming the first file skipped', async () => {
    const photos = Array.from({ length: 11 }, (_, i) => big(`IMG_${i + 1}.jpg`, 'image/jpeg', 1))
    render(
      <MenuCsvUpload
        onSuccess={vi.fn()}
        droppedFiles={[new File(['%PDF'], 'menu.pdf', { type: 'application/pdf' }), ...photos]}
      />,
    )
    expect(await screen.findByText(/Only 10 files at a time/)).toBeInTheDocument()
    expect(screen.getAllByText(/Only 10 files at a time/)).toHaveLength(1)
    expect(screen.getByText(/"IMG_10\.jpg" and any after it were skipped/)).toBeInTheDocument()
    expect(screen.queryByText(/IMG_11\.jpg" and any/)).toBeNull()
  })
})
