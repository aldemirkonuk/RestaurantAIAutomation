import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TargetMarginSection, readPourInput, readTargetInputs } from './TargetMarginSection'

/**
 * ADR 0193 -- the house's target margin register. No default is offered, the
 * units are said out loud, and a failed read is not "not set".
 */
const getTargetMargin = vi.fn()
const setTargetMargin = vi.fn()
const confirmPourSize = vi.fn()
vi.mock('@/services/api/pricing', () => ({
  getTargetMargin: (...a: unknown[]) => getTargetMargin(...a),
  setTargetMargin: (...a: unknown[]) => setTargetMargin(...a),
  confirmPourSize: (...a: unknown[]) => confirmPourSize(...a),
}))

const NO_POUR = { confirmed: false, ml: null, confirmedAt: null, confirmedBy: null }
const UNSET = { restaurantId: 'r', bottlePct: null, glassPct: null, bandPct: null, pour: NO_POUR, readable: true, reason: null, statedAt: null, statedBy: null }
const NONE = { bottlePct: null, glassPct: null, bandPct: null }

beforeEach(() => {
  getTargetMargin.mockReset()
  setTargetMargin.mockReset()
  confirmPourSize.mockReset()
})

describe('readTargetInputs — what Record would write, before it writes', () => {
  it('refuses the fraction spelling 0.65 and says which spelling is wanted', () => {
    const r = readTargetInputs('0.65', '', '2', NONE)
    expect(r.canRecord).toBe(false)
    expect(r.sentence).toMatch(/a 65 percent margin is 65, not 0\.65/)
  })
  it('refuses a target above 95', () => {
    expect(readTargetInputs('96', '', '2', NONE).canRecord).toBe(false)
  })
  it('needs at least one target', () => {
    const r = readTargetInputs('', '', '2', NONE)
    expect(r.canRecord).toBe(false)
    expect(r.sentence).toMatch(/Nothing is recorded yet/)
  })
  it('needs "close enough" -- it is never invented', () => {
    const r = readTargetInputs('65', '', '', NONE)
    expect(r.canRecord).toBe(false)
    expect(r.sentence).toMatch(/how close is close enough/)
  })
  it('says exactly what will be written', () => {
    const r = readTargetInputs('65', '75', '2', NONE)
    expect(r.canRecord).toBe(true)
    expect(r.body).toEqual({ bottlePct: 65, glassPct: 75, bandPct: 2 })
    expect(r.sentence).toMatch(
      /Record will write 65 percent on a bottle and 75 percent on a glass, treating a price within 2 percent of the advised price as close enough/,
    )
  })
  it('"close enough" is a percent of the advised price, 0 to 20, and a trailing % is accepted', () => {
    expect(readTargetInputs('65', '', '3%', NONE).body).toEqual({ bottlePct: 65, glassPct: null, bandPct: 3 })
    const over = readTargetInputs('65', '', '21', NONE)
    expect(over.canRecord).toBe(false)
    expect(over.sentence).toMatch(/between 0 and 20 percent of the advised price/)
  })
  it('an unchanged value records nothing', () => {
    expect(readTargetInputs('65', '', '2', { bottlePct: 65, glassPct: null, bandPct: 2 }).canRecord).toBe(false)
  })
})

describe('readPourInput — the pour, confirmed once', () => {
  it('needs a number of ml in range, and says what Confirm records', () => {
    expect(readPourInput('', null).canConfirm).toBe(false)
    expect(readPourInput('abc', null).canConfirm).toBe(false)
    expect(readPourInput('9', null).canConfirm).toBe(false)
    expect(readPourInput('501', null).canConfirm).toBe(false)
    const ok = readPourInput('125 ml', null)
    expect(ok).toMatchObject({ canConfirm: true, ml: 125 })
    expect(ok.sentence).toMatch(/Confirm will record a 125 ml pour/)
  })
  it('the pour already confirmed confirms nothing', () => {
    expect(readPourInput('125', 125).canConfirm).toBe(false)
  })
})

describe('TargetMarginSection', () => {
  it('an unset house: fields empty, no default offered, and the cost of not setting it is said', async () => {
    getTargetMargin.mockResolvedValue(UNSET)
    render(<TargetMarginSection canManage />)
    expect(await screen.findByText(/No price advice is given anywhere\./)).toBeInTheDocument()
    expect(screen.getByLabelText('bottle')).toHaveValue(null)
    expect(screen.getByLabelText('glass')).toHaveValue(null)
    expect(screen.getByLabelText('close enough')).toHaveValue(null)
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled()
    // The pour: not confirmed, so glasses wait -- and no 150 ml is offered.
    expect(screen.getByText(/No glass is advised yet\./)).toBeInTheDocument()
    expect(screen.getByLabelText('pour')).toHaveValue(null)
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  })

  it('confirms the pour that was typed, and reads back who confirmed it', async () => {
    getTargetMargin.mockResolvedValue(UNSET)
    confirmPourSize.mockResolvedValue({
      ...UNSET,
      pour: { confirmed: true, ml: 125, confirmedAt: '2026-09-21T10:00:00Z', confirmedBy: { userId: 'u', name: 'Ada' } },
      audited: true,
    })
    render(<TargetMarginSection canManage />)
    fireEvent.change(await screen.findByLabelText('pour'), { target: { value: '125' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(confirmPourSize).toHaveBeenCalledWith(125))
    expect(await screen.findByText(/confirmed by · Ada/)).toBeInTheDocument()
    expect(screen.getByText(/costed on a/)).toHaveTextContent('125 ml')
  })

  it('records what was typed, and nothing else', async () => {
    getTargetMargin.mockResolvedValue(UNSET)
    setTargetMargin.mockResolvedValue({ ...UNSET, bottlePct: 65, bandPct: 2, statedAt: '2026-09-21T10:00:00Z', statedBy: { userId: 'u', name: 'Ada' }, audited: true })
    const onSaved = vi.fn()
    render(<TargetMarginSection canManage onSaved={onSaved} />)
    fireEvent.change(await screen.findByLabelText('bottle'), { target: { value: '65' } })
    fireEvent.change(screen.getByLabelText('close enough'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(setTargetMargin).toHaveBeenCalledWith({ bottlePct: 65, glassPct: null, bandPct: 2 }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(await screen.findByText(/set by · Ada/)).toBeInTheDocument()
  })

  it('a failed read is said, and is not "not set"', async () => {
    getTargetMargin.mockRejectedValue(new Error('timeout'))
    render(<TargetMarginSection canManage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be read — timeout/)
    expect(screen.queryByText(/No price advice is given anywhere/)).not.toBeInTheDocument()
  })

  it('staff can read it but not change it', async () => {
    getTargetMargin.mockResolvedValue({ ...UNSET, bottlePct: 65, bandPct: 2 })
    render(<TargetMarginSection canManage={false} />)
    expect(await screen.findByLabelText('bottle')).toBeDisabled()
    expect(screen.getByText(/Only managers and owners can state the margin/)).toBeInTheDocument()
  })
})
