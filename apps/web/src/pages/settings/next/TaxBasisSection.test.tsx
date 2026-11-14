import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaxBasisSection, readTaxAnswer } from './TaxBasisSection'

/**
 * ADR 0359 C2/C3 -- the house says whether its prices hold tax and whether it
 * reclaims the tax it pays. No default, both answers together, only from now
 * on, and a failed read is not "not answered". Fixtures are SYNTHETIC.
 */
const get = vi.fn()
const put = vi.fn()
vi.mock('@/services/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
}))

const UNSET = {
  restaurantId: 'r', basis: 'unset', reclaimsInputTax: null, since: null, statedAt: null, statedBy: null,
  readable: true, reason: null,
}
const SAID = {
  ...UNSET, basis: 'prices_include_tax', reclaimsInputTax: true, since: '2027-01-05T09:00:00Z',
  statedAt: '2027-01-05T09:00:00Z', statedBy: { userId: 'u', name: 'SYNTHETIC owner' },
}
const NONE = { basis: 'unset' as const, reclaimsInputTax: null }

beforeEach(() => {
  get.mockReset()
  put.mockReset()
})

describe('readTaxAnswer -- what Record would write, before it writes', () => {
  it('says what an unanswered house is costed at, and records nothing', () => {
    const r = readTaxAnswer(null, null, NONE)
    expect(r).toMatchObject({ canRecord: false, body: null })
    expect(r.sentence).toMatch(/costed as its invoice prints it, tax and all/)
  })
  it('a VAT-charging house must also say whether it reclaims', () => {
    const r = readTaxAnswer('prices_include_tax', null, NONE)
    expect(r.canRecord).toBe(false)
    expect(r.sentence).toMatch(/Say whether the house reclaims the tax it pays/)
  })
  it('a reclaiming house is costed before tax, from now on', () => {
    const r = readTaxAnswer('prices_include_tax', true, NONE)
    expect(r.body).toEqual({ basis: 'prices_include_tax', reclaimsInputTax: true })
    expect(r.sentence).toMatch(/reclaims the tax it pays: a delivery whose invoice shows its tax is costed before tax/)
    expect(r.sentence).toMatch(/Deliveries already costed keep their cost\./)
  })
  it('a house that keeps the tax is costed with it', () => {
    const r = readTaxAnswer('prices_exclude_tax', false, NONE)
    expect(r.body).toEqual({ basis: 'prices_exclude_tax', reclaimsInputTax: false })
    expect(r.sentence).toMatch(/keeps the tax it pays as a cost/)
  })
  it('a no-VAT house reclaims nothing, whatever was pressed before', () => {
    const r = readTaxAnswer('not_vat_charging', true, NONE)
    expect(r.body).toEqual({ basis: 'not_vat_charging', reclaimsInputTax: false })
    expect(r.sentence).toMatch(/charges no VAT, so it reclaims none/)
  })
  it('the same answers again record nothing', () => {
    const r = readTaxAnswer('prices_include_tax', true, { basis: 'prices_include_tax', reclaimsInputTax: true })
    expect(r).toMatchObject({ canRecord: false, sentence: 'That is what is already recorded.' })
  })
  it('a changed reclaim answer alone can be recorded', () => {
    expect(readTaxAnswer('prices_include_tax', false, { basis: 'prices_include_tax', reclaimsInputTax: true }).canRecord).toBe(true)
  })
})

describe('TaxBasisSection', () => {
  it('an unanswered house presses nothing and offers no Record', async () => {
    get.mockResolvedValue({ data: UNSET })
    render(<TaxBasisSection canManage />)
    expect(await screen.findByText(/Not answered yet/)).toBeTruthy()
    expect(get).toHaveBeenCalledWith('/settings/tax-basis')
    expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0)
    expect((screen.getByRole('button', { name: 'Record' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('records both answers and shows what was saved', async () => {
    get.mockResolvedValue({ data: UNSET })
    put.mockResolvedValue({ data: { ...SAID, audited: true, auditReason: null } })
    render(<TaxBasisSection canManage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Our prices include tax' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, we reclaim it' }))
    expect(screen.getByTestId('st-tax-sentence').textContent).toMatch(/costed before tax/)
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/settings/tax-basis', { basis: 'prices_include_tax', reclaimsInputTax: true }))
    expect(await screen.findByText(/That is what is already recorded/)).toBeTruthy()
    expect(screen.getByText(/Deliveries costed before then keep the cost they were posted at/)).toBeTruthy()
    expect(screen.getByText(/set by · SYNTHETIC owner/)).toBeTruthy()
  })

  it('a no-VAT house is not asked whether it reclaims', async () => {
    get.mockResolvedValue({ data: UNSET })
    put.mockResolvedValue({ data: { ...SAID, basis: 'not_vat_charging', reclaimsInputTax: false } })
    render(<TaxBasisSection canManage />)
    fireEvent.click(await screen.findByRole('button', { name: 'We charge no VAT' }))
    expect(screen.queryByRole('group', { name: 'Do you reclaim the tax you pay on purchases?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    await waitFor(() => expect(put).toHaveBeenCalledWith('/settings/tax-basis', { basis: 'not_vat_charging', reclaimsInputTax: false }))
  })

  it('a refused write says nothing was recorded, in the gateway\'s words', async () => {
    get.mockResolvedValue({ data: UNSET })
    put.mockRejectedValue({ response: { status: 403 } })
    render(<TaxBasisSection canManage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Our prices are before tax' }))
    fireEvent.click(screen.getByRole('button', { name: 'No, we keep it as a cost' }))
    fireEvent.click(screen.getByRole('button', { name: 'Record' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Nothing was recorded — only an owner or a manager can answer this.',
    )
  })

  it('a failed read is not "not answered"', async () => {
    get.mockResolvedValue({ data: { ...UNSET, readable: false, reason: "the house's tax answer could not be read just now" } })
    render(<TaxBasisSection canManage />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/could not be read — the house's tax answer could not be read just now/)
    expect(alert.textContent).toMatch(/not the same as a house that has not answered/)
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
  })

  it('someone who may not manage the house sees the answers but cannot change them', async () => {
    get.mockResolvedValue({ data: SAID })
    render(<TaxBasisSection canManage={false} />)
    const b = (await screen.findByRole('button', { name: 'Our prices include tax' })) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Record' })).toBeNull()
    expect(screen.getByText('Only an owner or a manager can answer this.')).toBeTruthy()
  })

  it('a change whose trail row failed says so', async () => {
    get.mockResolvedValue({ data: { ...SAID, audited: false, auditReason: 'trail down' } })
    render(<TaxBasisSection canManage />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/not written to the trail — trail down/)
  })
})
