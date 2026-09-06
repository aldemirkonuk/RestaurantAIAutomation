/**
 * "Carry these bottles (from a menu scan)" — both branches.
 *
 * Flag off, the legacy modal renders byte for byte as it shipped (it is still
 * opened by `pages/WineLibrary.tsx:1810`, which is not rebuilt); the pinned
 * literal class string is asserted against `git show origin/main:<path>` so a
 * drift fails rather than skips.
 *
 * The regression is the census's own footnote — "the detection half is real;
 * the approve half wrote nothing before". Every carry test below fails against
 * a copy of the pre-fix file, which has no approve half at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent } from '@testing-library/react'
import { execFileSync } from 'node:child_process'
import { MenuScannerModal } from './MenuScannerModal'
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround'
import type { DetectedWine } from '../../services/wineDetection'

const persist = vi.fn()
vi.mock('../../lib/menuScannerPersistence', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>)
  return { ...actual, persistBatchToInventory: (...a: unknown[]) => persist(...a) }
})

/** The detection half is exercised by its own suite; here it is a button. */
let detectHandler: ((wines: DetectedWine[]) => void) | null = null
vi.mock('./MenuScannerTab', () => ({
  MenuScannerTab: ({ onWinesDetected }: { onWinesDetected: (w: DetectedWine[]) => void }) => {
    detectHandler = onWinesDetected
    return <div data-testid="scanner-tab" />
  },
}))

const LEGACY_CARD =
  'bg-white rounded-3xl shadow-2xl w-full max-w-4xl h-[80vh] overflow-hidden flex flex-col'

const DETECTED = [
  {
    id: 'd1',
    name: 'Öküzgözü',
    producer: 'Kavaklıdere',
    vintage: 2022,
    confidence: 0.91,
    inMasterLibrary: true,
    masterWineId: 'mw1',
  },
  {
    id: 'd2',
    name: 'Chianti Classico',
    producer: 'Banfi',
    vintage: 2021,
    confidence: 0.41,
    inMasterLibrary: false,
  },
] as unknown as DetectedWine[]

const EMPTY_RESULT = {
  added: [],
  stockAdded: [],
  reactivated: [],
  provisional: [],
  failed: [],
}

function modal(onCarried = vi.fn()) {
  return {
    onCarried,
    ...render(
      <MenuScannerModal isOpen onClose={() => {}} onWinesDetected={() => {}} onCarried={onCarried} />,
    ),
  }
}

function detect(wines = DETECTED) {
  act(() => detectHandler?.(wines))
}

beforeEach(() => {
  resetMudavymShell()
  detectHandler = null
  persist.mockResolvedValue({ ...EMPTY_RESULT, added: [{ wineName: 'Öküzgözü' }] })
})
afterEach(() => vi.clearAllMocks())

describe('the pinned legacy string is the one the committed source ships', () => {
  it('MenuScannerModal', () => {
    const src = execFileSync(
      'git',
      ['show', 'origin/main:apps/web/src/components/wines/MenuScannerModal.tsx'],
      { encoding: 'utf8', cwd: process.cwd() },
    )
    expect(src).toContain(LEGACY_CARD)
  })
})

describe('flag off — the legacy modal, class string for class string', () => {
  it('renders the legacy card and no house overlay', () => {
    modal()
    expect(document.querySelector(`[class="${LEGACY_CARD}"]`)).not.toBeNull()
    expect(document.querySelector('.mdv-ovl')).toBeNull()
  })
})

describe('flag on — the house sheet', () => {
  beforeEach(() => claimMudavymShell(Symbol('cellar-page'), 'paper'))

  it('is a wide Sheet on the primitive, motion `tuck`, closed in words', () => {
    modal()
    const root = document.querySelector('.mdv-ovl')
    expect(root?.getAttribute('data-shape')).toBe('sheet')
    expect(root?.getAttribute('data-wide')).toBe('true')
    expect(document.querySelector('[data-motion="tuck"]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
  })

  it('reading writes nothing, and says so', () => {
    modal()
    expect(
      screen.getByText(/nothing reaches the book until you tick lines and carry them\./),
    ).toBeTruthy()
  })

  /* THE REGRESSION — the approve half exists and writes. */
  it('offers the carry the census drew, and writes through the bulk door', async () => {
    const { onCarried } = modal()
    detect()

    // A 0.41 read arrives UNTICKED; the confident one is ticked.
    expect(screen.getByRole('checkbox', { name: 'Carry Öküzgözü' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Carry Chianti Classico' })).not.toBeChecked()

    const button = screen.getByRole('button', { name: 'Carry the 1 I ticked' })
    fireEvent.click(button)

    await screen.findByText('Carried')
    expect(persist).toHaveBeenCalledTimes(1)
    const [lines, options] = persist.mock.calls[0]
    expect(lines).toHaveLength(1)
    // The library match travels as a wineId; no cost is ever seeded from a menu.
    expect(lines[0]).toMatchObject({ wineId: 'mw1', stockLive: 6 })
    expect(lines[0].costPerBottle).toBeUndefined()
    expect(options).toMatchObject({ source: 'menu_scan' })
    expect(onCarried).toHaveBeenCalledTimes(1)
  })

  it("keeps the reader's confidence on the row, in grey", () => {
    modal()
    detect()
    const grey = [...document.querySelectorAll('.mdv-grey')].map((n) => n.textContent ?? '')
    expect(grey[0]).toContain('read with confidence 0.91')
    expect(grey[0]).toContain('matched in the library')
    expect(grey[1]).toContain('read with confidence 0.41')
    expect(grey[1]).toContain('new to the library, carried as provisional')
    expect(
      document.querySelector('.mdv-prov')?.textContent,
    ).toContain('1 below 0.60 and left unticked')
  })

  it('a shaky read carries one bottle, a confident one carries six', () => {
    modal()
    detect()
    const qtys = [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')].map(
      (n) => n.value,
    )
    expect(qtys).toEqual(['6', '1'])
  })

  it('reads back every bucket, and names provisional as provisional', async () => {
    persist.mockResolvedValue({
      added: [{ wineName: 'Öküzgözü' }],
      stockAdded: [],
      reactivated: [],
      provisional: [{ wineName: 'Chianti Classico' }],
      failed: [{ wineName: 'Bad line', error: 'no quantity' }],
    })
    modal()
    detect()
    fireEvent.click(screen.getByRole('button', { name: 'Carry the 1 I ticked' }))

    await screen.findByText('Carried')
    expect(screen.getByText('New rows on the register')).toBeTruthy()
    expect(screen.getByText('New to the library, carried as provisional')).toBeTruthy()
    expect(
      screen.getByText(
        'A provisional entry is not a curated wine. It is marked so nobody reads it as one.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Not carried')).toBeTruthy()
    expect(screen.getByText(/Bad line — no quantity/)).toBeTruthy()
  })

  it('a refusal is its own state, and says nothing was written', async () => {
    persist.mockRejectedValue({ response: { status: 403, data: { message: 'forbidden' } } })
    modal()
    detect()
    fireEvent.click(screen.getByRole('button', { name: 'Carry the 1 I ticked' }))

    await screen.findByText('Not permitted')
    expect(
      screen.getByText(/Nothing was carried; the register is unchanged\./),
    ).toBeTruthy()
  })

  it('a failure keeps every line ticked and unwritten', async () => {
    persist.mockRejectedValue({ response: { status: 500, data: { message: 'upstream down' } } })
    modal()
    detect()
    fireEvent.click(screen.getByRole('button', { name: 'Carry the 1 I ticked' }))

    await screen.findByText('Not carried')
    expect(
      screen.getByText(/Every line below is still ticked and still unwritten\./),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Carry the 1 I ticked' })).toBeTruthy()
  })

  it('a menu with no wine titles is an answer, said in words', () => {
    modal()
    detect([])
    expect(
      screen.getByText(/The reader found no wine titles on that menu\./),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Carry the \d/ })).toBeNull()
  })

  it('wears the page ground the portal was handed', () => {
    resetMudavymShell()
    claimMudavymShell(Symbol('cellar-charcoal'), 'charcoal')
    modal()
    expect(document.querySelector('.mdv-ovl')?.getAttribute('data-ground')).toBe('charcoal')
  })
})
