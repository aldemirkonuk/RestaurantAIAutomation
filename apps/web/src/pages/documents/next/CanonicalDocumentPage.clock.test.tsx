/**
 * One document page, one clock: the house's (r34 walk w2 F1, 2026-11-13).
 *
 * The walker's Istanbul house showed the door count in UTC
 * ("2026-11-14 03:28"), the agreement on the reader's clock ("13.11 22:28")
 * and the delivery day as UTC's ("Nov 14, 2026") on the same paper. Every
 * moment is now read on the zone `GET /settings/time-zone` answers.
 *
 * The same instant is rendered for three houses whose clocks differ from each
 * other by more than a day's edge, so the assertions cannot pass on the test
 * runner's own zone: at most one of them can be the runner's. All data is
 * SYNTHETIC.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const documentMock = vi.fn()
const zoneMock = vi.fn()
const eventMock = vi.fn()

vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: (url: string) => {
      if (url === '/settings/time-zone') return zoneMock()
      return Promise.reject(new Error(`unexpected GET ${url}`))
    },
  },
}))
vi.mock('../../../services/api/deliveries', () => ({
  deliveriesApi: {
    event: () => eventMock(),
    proposals: vi.fn().mockResolvedValue([]),
    recordDoorCount: vi.fn(),
  },
}))
vi.mock('../../../services/api/inventory', () => ({
  getInventory: () => Promise.resolve([]),
}))
vi.mock('../../../services/api/canonical', () => ({
  canonicalApi: {
    document: (id: string) => documentMock(id),
    delivery: vi.fn(),
    lineMappings: vi.fn().mockResolvedValue([]),
  },
}))

import { CanonicalDocumentPage } from './CanonicalDocumentPage'
import {
  fmtDayOf,
  fmtStamp,
  knownZone,
  wallClock,
} from '../../../components/documents/canonical-format'
import { deviceClockNote, houseZoneOf } from './house-clock'

/** 03:28 UTC on the 14th — the walker's moment. */
const AT = '2026-11-14T03:28:00Z'

const env = (value: unknown) => ({ value, source: 'extracted', confidence: null, revision: 1 })
const party = () => ({
  name: env('SYNTHETIC Vendor A.Ş.'),
  vatIdentifier: env(null),
  identifier: env(null),
  address: env(null),
  electronicAddress: env(null),
})

function response() {
  return {
    canonical: {
      documentId: 'doc-syn',
      restaurantId: 'rest-syn',
      docType: 'invoice',
      direction: 'issued_by_vendor',
      jurisdiction: 'TR',
      revision: 1,
      layer1: {
        documentNumber: env('SYN-1'),
        issueDate: env('2026-11-13'),
        typeCode: env('380'),
        currency: env('TRY'),
        paymentDueDate: env(null),
        paymentTerms: env(null),
        seller: party(),
        buyer: party(),
        purchaseOrderReference: env(null),
        despatchAdviceReference: env(null),
        precedingInvoiceReference: env(null),
        actualDeliveryDate: env(null),
        deliveryLocation: env(null),
        lines: [
          {
            lineId: env(null),
            description: env('SYNTHETIC Öküzgözü'),
            sellerItemId: env(null),
            quantity: env(6),
            unit: env('bottle'),
            netPrice: env(100),
            priceBaseQuantity: env(1),
            priceBaseUnit: env('bottle'),
            netAmount: env(600),
            allowancesCharges: [],
            vatCategory: env(null),
            vatRate: env(null),
            vintage: env(null),
            lot: env(null),
            formatMl: env(750),
            freeGoodsQty: env(0),
          },
        ],
        allowancesCharges: [],
        totals: {
          linesNetTotal: env(600),
          allowancesTotal: env(0),
          chargesTotal: env(0),
          taxExclusiveAmount: env(600),
          taxAmount: env(0),
          taxInclusiveAmount: env(600),
          paidAmount: env(null),
          roundingAmount: env(null),
          amountDue: env(600),
        },
        vatBreakdown: [],
      },
      layer2: { providerId: null, vendorResolution: null, lines: [] },
      layer3: {
        lines: [
          {
            lineIndex: 0,
            ordered: 6,
            shipped: 6,
            received: 6,
            billed: 6,
            verdict: 'ok',
            reason: null,
            moneyAtRisk: null,
          },
        ],
        tiesOut: true,
        tieOutDeltaCents: 0,
        verdicts: [],
      },
    },
    deliveries: [
      {
        deliveryId: 'del-syn',
        state: 'AGREED',
        provenance: 'ORDERED',
        deliveredAt: AT,
        agreedAt: AT,
        verifiedAt: null,
        jurisdiction: 'TR',
        providerId: null,
        selectedRole: 'invoice',
        documents: [
          {
            documentId: 'doc-syn',
            role: 'invoice',
            docType: 'invoice',
            docNumber: 'SYN-1',
            docDate: '2026-11-13',
            status: 'needs_review',
            total: 600,
            currency: 'TRY',
            createdAt: '2026-11-13T20:00:00Z',
            isSelected: true,
          },
          {
            documentId: 'door-syn',
            role: 'door_count',
            docType: 'receiving_advice',
            docNumber: null,
            docDate: null,
            status: null,
            total: null,
            currency: null,
            createdAt: AT,
            isSelected: false,
          },
        ],
      },
    ],
    siblings: [],
    corrections: [],
    original: { imageUrl: null, reason: 'none stored', contentType: null, filename: null, pages: null },
    intake: {
      status: 'needs_review',
      verdict: null,
      reason: null,
      sourceChannel: 'upload',
      extractionModel: null,
      sha256: 'abc123',
      createdAt: '2026-11-13T20:00:00Z',
    },
  }
}

const event = {
  id: 'del-syn',
  providerId: null,
  orderId: null,
  state: 'AGREED',
  provenance: 'ORDERED',
  jurisdiction: 'TR',
  deliveredAt: AT,
  agreedAt: AT,
  agreedRule: 'both_sides_recorded',
  verifiedAt: null,
  verifiedBy: null,
  lapsedAt: null,
  lapseDeemed: null,
  amendedAt: null,
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/documents/doc-syn?view=door']}>
        <Routes>
          <Route path="/documents/:id" element={<CanonicalDocumentPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const readout = (zone: string | null, over: Record<string, unknown> = {}) => ({
  data: {
    restaurantId: 'rest-syn',
    zone,
    unreadZone: null,
    readable: true,
    reason: null,
    ...over,
  },
})

describe('the document page reads every moment on the house’s clock', () => {
  beforeEach(() => {
    documentMock.mockReset()
    documentMock.mockResolvedValue(response())
    zoneMock.mockReset()
    eventMock.mockReset()
    eventMock.mockResolvedValue(event)
  })

  it.each([
    ['Europe/Istanbul', '14.11 06:28', '14.11.2026'],
    ['America/New_York', '13.11 22:28', '13.11.2026'],
    ['Pacific/Kiritimati', '14.11 17:28', '14.11.2026'],
  ])(
    '[REVERT-FAILS] a house on %s: the door, the agreement and the delivery day all say its clock',
    async (zone, stamp, day) => {
      zoneMock.mockResolvedValue(readout(zone))
      mount()
      // The door count: was `2026-11-14 03:28`, UTC's.
      await waitFor(() =>
        expect(screen.getByTestId('door-frame')).toHaveTextContent(`· ${stamp}`),
      )
      // The agreement: was the reader's clock.
      await waitFor(() =>
        expect(screen.getByTestId('delivery-gates')).toHaveTextContent(`Agreed ${stamp}`),
      )
      // The delivery day: was UTC's day, in the American shape.
      expect(screen.getByText(new RegExp(`documents · ${day.replace(/\./g, '\\.')}`))).toBeTruthy()
      expect(screen.queryByText(/2026-11-14 03:28/)).toBeNull()
      expect(screen.queryByText(/Nov 14, 2026/)).toBeNull()
      // On the house's clock, the page says nothing about clocks.
      expect(screen.queryByTestId('doc-clock-note')).toBeNull()
      expect(zoneMock).toHaveBeenCalledTimes(1)
    },
  )

  it('[REVERT-FAILS] a house with no time zone set keeps ONE clock, the device’s, and says so', async () => {
    zoneMock.mockResolvedValue(readout(null))
    mount()
    const note = await screen.findByTestId('doc-clock-note')
    expect(note).toHaveTextContent(
      'Times on this page are on this device’s clock: the house has no time zone set. An owner or a manager sets it in Settings.',
    )
    const reader = fmtStamp(AT, 'TR')
    await waitFor(() =>
      expect(screen.getByTestId('door-frame')).toHaveTextContent(`· ${reader}`),
    )
    await waitFor(() =>
      expect(screen.getByTestId('delivery-gates')).toHaveTextContent(`Agreed ${reader}`),
    )
    expect(screen.getByText(new RegExp(`documents · ${fmtDayOf(AT, 'TR').replace(/\./g, '\\.')}`))).toBeTruthy()
  })

  it('a time zone that cannot be read says so, and the page still renders on the device’s clock', async () => {
    zoneMock.mockRejectedValue(new Error('503'))
    mount()
    expect(await screen.findByTestId('doc-clock-note')).toHaveTextContent(
      'the house’s time zone could not be read.',
    )
    await waitFor(() =>
      expect(screen.getByTestId('delivery-gates')).toHaveTextContent(`Agreed ${fmtStamp(AT, 'TR')}`),
    )
  })
})

describe('the clock helpers', () => {
  it('[REVERT-FAILS] fmtStamp reads the instant on the zone it is given, in the document’s shape', () => {
    expect(fmtStamp(AT, 'TR', null, 'Europe/Istanbul')).toBe('14.11 06:28')
    expect(fmtStamp(AT, 'TR', null, 'America/New_York')).toBe('13.11 22:28')
    expect(fmtStamp(AT, 'US-CA', null, 'America/Los_Angeles')).toBe('Nov 13, 19:28')
    expect(fmtStamp(AT, null, 'TRY', 'Asia/Tokyo')).toBe('14.11 12:28')
  })

  it('midnight on the house’s clock is 00, never 24', () => {
    expect(fmtStamp('2026-11-13T21:00:00Z', 'TR', null, 'Europe/Istanbul')).toBe('14.11 00:00')
    expect(wallClock(new Date('2026-11-13T21:00:00Z'), 'Europe/Istanbul')).toEqual({
      year: 2026,
      month: 11,
      day: 14,
      hour: 0,
      minute: 0,
    })
  })

  it('[REVERT-FAILS] fmtDayOf names the day the instant fell on at the house, not UTC’s', () => {
    expect(fmtDayOf(AT, 'TR', null, 'Europe/Istanbul')).toBe('14.11.2026')
    expect(fmtDayOf(AT, 'TR', null, 'America/New_York')).toBe('13.11.2026')
    expect(fmtDayOf(AT, 'US-CA', null, 'America/Los_Angeles')).toBe('Nov 13, 2026')
    expect(fmtDayOf('2026-12-31T22:30:00Z', null, 'TRY', 'Europe/Istanbul')).toBe('01.01.2027')
  })

  it('no zone, or one this browser does not know, is the reader’s clock — never a throw', () => {
    const d = new Date(AT)
    const p = (n: number) => String(n).padStart(2, '0')
    const reader = `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
    expect(fmtStamp(AT, 'TR')).toBe(reader)
    expect(fmtStamp(AT, 'TR', null, 'Mars/Olympus_Mons')).toBe(reader)
    expect(knownZone('Mars/Olympus_Mons')).toBeNull()
    expect(knownZone('Europe/Istanbul')).toBe('Europe/Istanbul')
    expect(knownZone(null)).toBeNull()
    expect(fmtStamp(null, 'TR', null, 'Europe/Istanbul')).toBe('—')
    expect(fmtDayOf('not a time', 'TR', null, 'Europe/Istanbul')).toBe('—')
  })

  it('houseZoneOf: still reading is undefined; every failure is null; a known zone is itself', () => {
    expect(houseZoneOf({ isPending: true, isError: false })).toBeUndefined()
    expect(houseZoneOf({ isPending: false, isError: true })).toBeNull()
    expect(
      houseZoneOf({ isPending: false, isError: false, data: { zone: 'Europe/Istanbul', readable: false } }),
    ).toBeNull()
    expect(
      houseZoneOf({ isPending: false, isError: false, data: { zone: 'Europe/Istanbul', readable: true } }),
    ).toBe('Europe/Istanbul')
    expect(
      houseZoneOf({ isPending: false, isError: false, data: { zone: 'Mars/Olympus_Mons' } }),
    ).toBeNull()
  })

  it('deviceClockNote names why the device’s clock is in use, and is quiet otherwise', () => {
    const ok = { isPending: false, isError: false }
    expect(deviceClockNote({ isPending: true, isError: false })).toBeNull()
    expect(deviceClockNote({ ...ok, data: { zone: 'Europe/Istanbul' } })).toBeNull()
    expect(deviceClockNote({ ...ok, data: { zone: null, unreadZone: 'EET+3' } })).toMatch(
      /not one this browser knows\.$/,
    )
    expect(deviceClockNote({ ...ok, data: { zone: 'Mars/Olympus_Mons' } })).toMatch(
      /not one this browser knows\.$/,
    )
    expect(deviceClockNote({ ...ok, data: { zone: null, readable: false } })).toMatch(
      /could not be read\.$/,
    )
    expect(deviceClockNote({ isPending: false, isError: true })).toMatch(/could not be read\.$/)
  })
})
