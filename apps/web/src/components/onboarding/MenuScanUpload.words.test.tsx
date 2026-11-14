/**
 * r33 walk: the photo step of /get-started showed the wine scanner's start
 * panel to a new owner: "Scan Wine Menu", "live AI detection" and an "AI
 * Detection Pipeline" note naming OCR models. The first-menu photo says its
 * own words; the scanner keeps its defaults for its other callers.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))

import { MenuScanUpload } from './MenuScanUpload'
import { CameraCapture } from '../scanner/CameraCapture'

describe('the first menu photo speaks to the owner', () => {
  it('says what to do, with no scanner title, no AI and no model list', () => {
    render(<MenuScanUpload onSuccess={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Photograph the menu' })).toBeInTheDocument()
    expect(screen.getByText(/Take a photo of the printed menu, or choose a photo or a PDF of it\./)).toBeInTheDocument()
    expect(screen.queryByText('Scan Wine Menu')).toBeNull()
    expect(screen.queryByText('AI Detection Pipeline')).toBeNull()
    expect(screen.queryByText(/\bAI\b/)).toBeNull()
    expect(screen.queryByText(/PaddleOCR|Gemini|RF-DETR/)).toBeNull()
  })

  it('the scanner keeps its own words for its other callers', () => {
    render(<CameraCapture onCapture={vi.fn()} onFileUpload={vi.fn()} useCameraModal />)
    expect(screen.getByRole('heading', { name: 'Scan Wine Menu' })).toBeInTheDocument()
    expect(screen.getByText('AI Detection Pipeline')).toBeInTheDocument()
  })
})
