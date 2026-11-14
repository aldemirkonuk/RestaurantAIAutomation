/**
 * r41 onboarding gap 4: the camera is fetched when the photo way is opened,
 * not with /get-started. Imported statically, CameraCapture brought
 * framer-motion's animation, gesture and layout code (28.4 KB gz) and the
 * camera (4.8 KB gz) into the page's first paint.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

let openCamera: () => void = () => undefined
vi.mock('../scanner/CameraCapture', async () => {
  await new Promise<void>((done) => (openCamera = done))
  return { CameraCapture: () => <p>The camera</p> }
})
vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))
vi.mock('../../lib/fitPhoto', () => ({ fitPhotoForReading: vi.fn() }))

import { MenuScanUpload } from './MenuScanUpload'

describe('the camera loads when the photo way is opened', () => {
  it('says the camera is opening until its code is in, in the same box', async () => {
    render(<MenuScanUpload onSuccess={vi.fn()} />)
    const wait = await screen.findByRole('status')
    expect(wait).toHaveTextContent('Opening the camera…')
    expect(wait.className).toContain('min-h-[400px]')
    expect(screen.queryByText('The camera')).toBeNull()
    openCamera()
    expect(await screen.findByText('The camera')).toBeInTheDocument()
    expect(screen.queryByText('Opening the camera…')).toBeNull()
  })

  it('MenuScanUpload has no static import of the camera', () => {
    const source = readFileSync(resolve(__dirname, 'MenuScanUpload.tsx'), 'utf8')
    expect(source).not.toMatch(/^import[^\n]*['"]\.\.\/scanner\/CameraCapture['"]/m)
    expect(source).toMatch(/import\(['"]\.\.\/scanner\/CameraCapture['"]\)/)
  })
})
