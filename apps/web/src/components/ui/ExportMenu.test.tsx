/** The trigger warms the Excel and PDF writers on hover or focus, once, never at mount (perf-p11-s5). */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const loaded = vi.hoisted(() => ({ n: 0 }))
vi.mock('exceljs', () => {
  loaded.n += 1
  return { default: {} }
})
vi.mock('jspdf', () => ({ default: {} }))
vi.mock('jspdf-autotable', () => ({ default: {} }))

import { ExportMenu } from './ExportMenu'

describe('ExportMenu warm-up', () => {
  beforeEach(() => {
    loaded.n = 0
  })

  it('loads nothing at mount, loads the writers on hover, and only once', async () => {
    render(<ExportMenu onExport={() => {}} />)
    await Promise.resolve()
    expect(loaded.n).toBe(0)
    const trigger = screen.getByRole('button', { name: /export/i })
    fireEvent.pointerEnter(trigger)
    await vi.waitFor(() => expect(loaded.n).toBe(1))
    fireEvent.focus(trigger)
    fireEvent.pointerEnter(trigger)
    await Promise.resolve()
    expect(loaded.n).toBe(1)
  })
})
