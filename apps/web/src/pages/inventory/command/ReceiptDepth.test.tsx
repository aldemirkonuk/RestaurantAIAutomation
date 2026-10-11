/**
 * ReceiptDepth contract — the founder's inventory gap: real paperwork per
 * wine, E49 honesty throughout (a null tie-out is a dash, never a pass), and
 * failure said in words.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ProcurementDocument } from '../../../services/api/documents'
import { setHouseLocale } from '../../../lib/houseCurrency'

const api = vi.hoisted(() => ({
  byOrder: {} as Record<string, ProcurementDocument[]>,
  fail: false,
}))

vi.mock('../../../services/api/documents', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../services/api/documents')>()
  return {
    ...mod,
    documentsApi: {
      ...mod.documentsApi,
      forOrder: (id: string) =>
        api.fail ? Promise.reject(new Error('down')) : Promise.resolve(api.byOrder[id] ?? []),
    },
  }
})

import { ReceiptDepth } from './ReceiptDepth'

// A variable, not a literal: scripts/check_money_states_its_currency.py.
const FIXTURE_CURRENCY = 'USD'

function doc(over: Partial<ProcurementDocument>): ProcurementDocument {
  return {
    id: 'd1',
    doc_type: 'invoice',
    source_channel: 'email',
    doc_number: 'INV-88',
    doc_date: '2026-08-28',
    status: 'needs_review',
    total: 412.5,
    freight: null,
    fuel_surcharge: null,
    split_case_fee: null,
    delivery_fee: null,
    tax: null,
    other_charges: null,
    ties_out: null,
    tie_out_delta: null,
    extraction_confidence: null,
    notes: null,
    created_at: '2026-08-28T10:00:00Z',
    order_id: 'o1',
    ...over,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  api.byOrder = {}
  api.fail = false
})

describe('ReceiptDepth', () => {
  it('renders the paperwork with E49 dashes for null tie-out and doc number', async () => {
    api.byOrder = {
      o1: [
        doc({}),
        doc({ id: 'd2', doc_type: 'delivery_receipt', doc_number: null, ties_out: true, status: 'verified' }),
        doc({ id: 'd3', doc_type: 'credit_memo', doc_number: 'CM-3', ties_out: false, tie_out_delta: -12.4, currency: FIXTURE_CURRENCY }),
        doc({ id: 'd4', status: 'superseded' }), // never shown
      ],
    }
    render(<ReceiptDepth orders={[{ id: 'o1', orderNumber: 'PO-14' }]} />, { wrapper })
    expect(await screen.findByText('Invoice')).toBeInTheDocument()
    expect(screen.getByText('INV-88')).toBeInTheDocument()
    // null tie-out is a dash, never a pass
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('ties out')).toBeInTheDocument()
    expect(screen.getByText('off by $12.40')).toBeInTheDocument()
    // superseded paperwork stays out of the book
    expect(screen.getAllByText('Invoice')).toHaveLength(1)
  })

  // F-341: every figure here printed a bare "$" until 2026-10-09.
  it('says each document in its own money, and says so when none is recorded', async () => {
    api.byOrder = {
      o1: [
        doc({ total: 412.5, currency: 'EUR', ties_out: false, tie_out_delta: 3 }),
        doc({ id: 'd2', doc_type: 'delivery_receipt', total: 80, currency: null }),
      ],
    }
    render(<ReceiptDepth orders={[{ id: 'o1', orderNumber: 'PO-14' }]} />, { wrapper })
    expect(await screen.findByText('€412.50')).toBeInTheDocument()
    expect(screen.getByText('off by €3.00')).toBeInTheDocument()
    expect(screen.getByText('80.00 (currency not recorded)')).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('prints a document\'s money in the currency the document names', async () => {
    api.byOrder = {
      o1: [doc({ currency: 'TRY', ties_out: false, tie_out_delta: -12.4 })],
    }
    render(<ReceiptDepth orders={[{ id: 'o1' }]} />, { wrapper })
    expect(await screen.findByText(/TRY\s?412\.50|₺412\.50/)).toBeInTheDocument()
    expect(screen.getByText(/off by (TRY\s?12\.40|₺12\.40)/)).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('prints the day on the paper, not the day before it (F-570)', async () => {
    // Tests run in New York (src/__tests__/setup.ts), where reading
    // '2026-08-28' as an instant lands on 27 Aug.
    api.byOrder = { o1: [doc({ doc_date: '2026-08-28' })] }
    render(<ReceiptDepth orders={[{ id: 'o1' }]} />, { wrapper })
    expect(await screen.findByText('8/28')).toBeInTheDocument()
    expect(screen.queryByText('8/27')).toBeNull()
  })

  it('[REVERT-FAILS] writes the paper\'s day in digits in the house\'s order (F-1390)', async () => {
    setHouseLocale('tr-TR')
    try {
      api.byOrder = { o1: [doc({ doc_date: '2026-08-28' })] }
      render(<ReceiptDepth orders={[{ id: 'o1' }]} />, { wrapper })
      expect(await screen.findByText('28/8')).toBeInTheDocument()
      expect(screen.queryByText(/Ağu|Aug/)).toBeNull()
    } finally {
      setHouseLocale(null)
    }
  })

  it('admits an empty paper trail without claiming verification', async () => {
    api.byOrder = { o1: [] }
    render(<ReceiptDepth orders={[{ id: 'o1' }]} />, { wrapper })
    expect(await screen.findByText(/No invoice or receipt is attached/)).toBeInTheDocument()
  })

  it('says a fetch failure in words and claims nothing', async () => {
    api.fail = true
    render(<ReceiptDepth orders={[{ id: 'o1' }]} />, { wrapper })
    expect(await screen.findByText(/could not be read just now/)).toBeInTheDocument()
    expect(screen.getByText(/nothing below is claimed/)).toBeInTheDocument()
  })
})
