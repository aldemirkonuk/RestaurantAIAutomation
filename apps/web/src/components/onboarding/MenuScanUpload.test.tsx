/**
 * M12 (copy half): a scan read is synchronous and a long PDF can run for
 * minutes, so the waiting screen does not promise a number of seconds.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MenuScanUpload } from './MenuScanUpload'
import { importMenu } from '../../services/api/menus'

vi.mock('../../services/api/menus', () => ({ importMenu: vi.fn() }))
vi.mock('../scanner/CameraCapture', () => ({
  CameraCapture: ({ onCapture }: { onCapture: (b64: string) => void }) => (
    <button onClick={() => onCapture('JVBERi0=')}>capture</button>
  ),
}))

describe('MenuScanUpload — the waiting screen', () => {
  it('says reading takes a while and names no number of seconds', async () => {
    vi.mocked(importMenu).mockReturnValue(new Promise(() => {}))
    const { container } = render(<MenuScanUpload onSuccess={vi.fn()} />)
    fireEvent.click(screen.getByText('capture'))
    expect(await screen.findByText('Analyzing your menu with AI...')).toBeTruthy()
    expect(container.textContent).not.toMatch(/seconds?/i)
    expect(container.textContent).not.toMatch(/\d/)
    expect(screen.getByText('Reading a menu can take a while.')).toBeTruthy()
  })
})
