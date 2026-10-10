/** The scan card speaks to the owner (sim ledger F-011, F-015). */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CameraCapture } from './CameraCapture'

describe('CameraCapture — the card before the camera opens', () => {
  it('says "Scan your menu" and how pages are read, and names no engine or model', () => {
    const { container } = render(
      <CameraCapture onCapture={vi.fn()} onFileUpload={vi.fn()} enableLiveDetection={false} useCameraModal />,
    )
    expect(screen.getByRole('heading', { name: 'Scan your menu' })).toBeInTheDocument()
    expect(screen.getByText(/every page of a PDF is read/)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/RF-DETR|PaddleOCR|Gemini|Qwen|RolmOCR|Pipeline|Wine Menu/)
  })
})
