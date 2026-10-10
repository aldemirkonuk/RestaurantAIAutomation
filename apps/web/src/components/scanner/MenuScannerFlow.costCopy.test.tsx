/**
 * F-780 (2026-10-10): F-312 hid the cost cells from staff, so the batch setup
 * step must not tell them it is where they say what the wines cost. A manager
 * is still asked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MenuScannerFlow } from './MenuScannerFlow'

const mayAct = vi.hoisted(() => ({ value: true }))
vi.mock('../../hooks/useMayActForTheHouse', () => ({
  useMayActForTheHouse: () => mayAct.value,
}))
vi.mock('../../hooks/useStorageLocations', () => ({
  useStorageLocations: () => ({ locations: [] }),
}))
const wine = { id: 'd1', name: 'Tsantali Rapsani', producer: 'Tsantali', vintage: 2019 }
vi.mock('../../services/wineDetection', () => ({
  scanMenuImage: vi.fn(async () => ({ wines: [wine], sectionHeaders: [] })),
}))
vi.mock('./CameraCapture', () => ({
  CameraCapture: ({ onCapture }: { onCapture: (b64: string) => void }) => (
    <button onClick={() => onCapture('aGk=')}>Shoot</button>
  ),
}))
vi.mock('./ScanResultsPanel', () => ({
  ScanResultsPanel: ({ wines, onConfirm }: { wines: unknown[]; onConfirm: (w: unknown[]) => void }) => (
    <button onClick={() => onConfirm(wines)}>Confirm</button>
  ),
}))

async function toStockSetup() {
  render(<MenuScannerFlow isOpen onClose={() => {}} restaurantId="r1" />)
  fireEvent.click(screen.getByRole('button', { name: 'Shoot' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }))
  await screen.findByText(/Batch setup/)
}

beforeEach(() => {
  mayAct.value = true
})

describe('MenuScannerFlow — batch setup asks only what the person can set (F-780)', () => {
  it('[REVERT-FAILS] does not tell staff the step is where they say what the wines cost', async () => {
    mayAct.value = false
    await toStockSetup()
    expect(screen.getByText('How many, and where they live')).toBeInTheDocument()
    expect(screen.queryByText(/what they cost/)).not.toBeInTheDocument()
  })

  it('tells a manager the step covers what the wines cost', async () => {
    await toStockSetup()
    expect(screen.getByText('How many, what they cost, and where they live')).toBeInTheDocument()
  })
})
