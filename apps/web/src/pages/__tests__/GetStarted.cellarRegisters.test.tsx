/**
 * The cellar-registers mount in onboarding (`.planning/06-pages/wines.md` §13
 * "Roadmap for the adaptation" item 1).
 *
 * Three things are asserted, and each would fail if the mount were wrong:
 *   1. flag OFF → no step, and the existing Activate step renders unchanged;
 *   2. flag ON  → the step renders AFTER the menu review, carrying the
 *      proposal that came out of `useCellarRegisters`;
 *   3. skipping ("Confirm later") writes nothing and continues the flow.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { RegisterId } from '../cellar/next/cellar-format'
import type { CellarRegistersVM, RegisterReadoutVM } from '../cellar/next/useCellarNextData'

const flag = vi.fn(() => false)
vi.mock('../../lib/mudavym/useMudavymDesign', () => ({
  useMudavymDesign: () => flag(),
  MUDAVYM_PAGES: ['cellar'],
}))

const progress = vi.fn(() => ({
  progress: { menu_uploaded: false, threshold_configured: true },
  isLoading: false,
}))
vi.mock('../../hooks/queries/useOnboardingProgress', () => ({
  useOnboardingProgress: () => progress(),
}))

vi.mock('../../contexts/AuthContext', async () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1' }),
  AuthContext: { Provider: ({ children }: never) => children },
}))

vi.mock('../../guidance/analytics', () => ({ trackGuidance: vi.fn() }))

// The menu-import review step is driven directly: the scan card's own upload
// path is not what this test is about.
vi.mock('../../components/onboarding/MenuScanUpload', () => ({
  MenuScanUpload: ({ onSuccess }: { onSuccess: (r: unknown) => void }) => (
    <button type="button" onClick={() => onSuccess({ itemsExtracted: 3, items: [] })}>
      finish-scan
    </button>
  ),
}))
vi.mock('../../components/onboarding/MenuReviewScreen', () => ({
  MenuReviewScreen: ({ onConfirm }: { onConfirm: () => void }) => (
    <button type="button" onClick={onConfirm}>
      confirm-review
    </button>
  ),
}))

const save = { mutateAsync: vi.fn(async (_input: unknown): Promise<unknown> => ({})), isPending: false }
type RegistersHook = {
  data: CellarRegistersVM | null
  loading: boolean
  error: string | null
  save: typeof save
  refetch: () => void
}
const registers = vi.fn((): RegistersHook => ({
  data: readout(),
  loading: false,
  error: null,
  save,
  refetch: vi.fn(),
}))
vi.mock('../cellar/next/useCellarNextData', () => ({
  useCellarRegisters: () => registers(),
}))

const ALL: RegisterId[] = [
  'wines', 'beer', 'whiskey', 'cocktails', 'spirits', 'non_alcoholic', 'soft_drinks',
]
const OK = { readable: true, reason: null, rows: 0 }

function reg(id: RegisterId, carried: boolean): RegisterReadoutVM {
  return {
    id,
    carried,
    decidedBy: 'inferred',
    confidence: carried ? 'certain' : 'none',
    basis: carried
      ? `This cellar counts 12 rows into ${id}.`
      : `Nothing in this cellar and nothing on this menu names ${id}.`,
    evidence: {
      inventoryRows: carried ? 12 : 0,
      menuRows: 0,
      catalogueRows: 0,
      nameOnly: false,
    },
    needsEvidence: false,
    strandedItems: 0,
  }
}

function readout(over: Partial<CellarRegistersVM> = {}): CellarRegistersVM {
  const rs = ALL.map((id) => reg(id, id === 'wines'))
  return {
    restaurantId: 'r1',
    registers: rs,
    carried: ['wines'],
    decidedBy: 'inferred',
    awaitingConfirmation: true,
    needsEvidence: [],
    stranded: [],
    sources: { answers: OK, inventory: OK, menu: OK, cocktails: OK, catalogue: OK },
    unmappedKinds: {},
    unmappedCatalogueTypes: {},
    ...over,
  }
}

import GetStarted from '../GetStarted'

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/get-started?tab=activate']}>
      <GetStarted />
    </MemoryRouter>,
  )
}

async function reachReview() {
  fireEvent.click(screen.getByText('Scan Photo'))
  fireEvent.click(await screen.findByText('finish-scan'))
  fireEvent.click(await screen.findByText('confirm-review'))
}

beforeEach(() => {
  vi.clearAllMocks()
  flag.mockReturnValue(false)
  save.mutateAsync.mockResolvedValue({})
  progress.mockReturnValue({
    progress: { menu_uploaded: false, threshold_configured: true },
    isLoading: false,
  })
  registers.mockReturnValue({
    data: readout(),
    loading: false,
    error: null,
    save,
    refetch: vi.fn(),
  })
  localStorage.clear()
})

describe('GetStarted — cellar registers, flag off', () => {
  it('renders the existing Activate step and no registers step', async () => {
    renderPage()
    expect(screen.getByText("Let's set up your wine list")).toBeInTheDocument()
    expect(screen.getByText('Scan Photo')).toBeInTheDocument()
    expect(screen.getByText('Upload File')).toBeInTheDocument()
    expect(screen.getByText('Manual Entry')).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-cellar-registers')).toBeNull()
    expect(screen.queryByTestId('activate-cellar-registers')).toBeNull()
  })

  it('goes straight from the review to the existing success path', async () => {
    renderPage()
    await reachReview()
    expect(await screen.findByText(/We found 3 wines/)).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-cellar-registers')).toBeNull()
    expect(registers).not.toHaveBeenCalled()
  })
})

describe('GetStarted — cellar registers, flag on', () => {
  beforeEach(() => flag.mockReturnValue(true))

  it('renders the step after the review, with the hook’s proposal', async () => {
    renderPage()
    await reachReview()

    const step = await screen.findByTestId('onboarding-cellar-registers')
    expect(step).toBeInTheDocument()
    // Not yet the success screen: the step sits between them.
    expect(screen.queryByText(/We found 3 wines/)).toBeNull()

    // The proposal itself, not a blank form: wines ticked (12 rows counted),
    // beer untouched.
    const wines = screen.getByLabelText('Wines register') as HTMLInputElement
    const beer = screen.getByLabelText('Beer register') as HTMLInputElement
    expect(wines.checked).toBe(true)
    expect(beer.checked).toBe(false)
    expect(screen.getByText(/This cellar counts 12 rows into wines\./)).toBeInTheDocument()
  })

  it('confirming records all seven and continues the flow', async () => {
    renderPage()
    await reachReview()
    fireEvent.click(await screen.findByTestId('registers-step-confirm'))

    await waitFor(() => expect(save.mutateAsync).toHaveBeenCalledTimes(1))
    const arg = (save.mutateAsync.mock.calls as unknown as [
      { registers: { id: RegisterId; carried: boolean }[]; source: string },
    ][])[0][0]
    expect(arg.source).toBe('confirmed')
    expect(arg.registers).toHaveLength(7)
    expect(await screen.findByText(/We found 3 wines/)).toBeInTheDocument()
  })

  it('skipping writes nothing and continues the flow', async () => {
    renderPage()
    await reachReview()
    fireEvent.click(await screen.findByTestId('onboarding-cellar-registers-skip'))

    expect(await screen.findByText(/We found 3 wines/)).toBeInTheDocument()
    expect(save.mutateAsync).not.toHaveBeenCalled()
  })

  it('does not ask a house that has already answered — the flow just continues', async () => {
    registers.mockReturnValue({
      data: readout({ awaitingConfirmation: false, decidedBy: 'confirmed' }),
      loading: false,
      error: null,
      save,
      refetch: vi.fn(),
    })
    renderPage()
    await reachReview()
    expect(await screen.findByText(/We found 3 wines/)).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-cellar-registers')).toBeNull()
  })

  it('an unread readout is never turned into a question', async () => {
    registers.mockReturnValue({
      data: null,
      loading: false,
      error: 'registers unreadable',
      save,
      refetch: vi.fn(),
    })
    renderPage()
    await reachReview()
    expect(await screen.findByText(/We found 3 wines/)).toBeInTheDocument()
    expect(screen.queryByTestId('onboarding-cellar-registers')).toBeNull()
  })

  it('mounts as the last Activate step when a menu already exists', async () => {
    progress.mockReturnValue({
      progress: { menu_uploaded: true, threshold_configured: true },
      isLoading: false,
    })
    renderPage()
    expect(await screen.findByTestId('activate-cellar-registers')).toBeInTheDocument()
    expect(await screen.findByTestId('registers-step')).toBeInTheDocument()
  })
})
