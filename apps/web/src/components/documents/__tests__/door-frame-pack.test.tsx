import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { CanonicalDocument } from '../../../services/api/canonical'
import { DoorFrame, knownPack } from '../DoorFrame'

/**
 * r28 invoices audit, G1: a case the paper has no pack for asks the door.
 *
 * Two cases with an unread pack used to go on the shelf as 2 bottles. The
 * gateway now refuses such a count; this frame asks the person holding the
 * case how many bottles one holds, and sends it. SYNTHETIC goods.
 */
const v = <T,>(value: T) => ({ value })
const line = (description: string, unit: string) => ({
  description: v(description),
  sellerItemId: v<string | null>(null),
  unit: v(unit),
  vintage: v<number | null>(null),
  formatMl: v<number | null>(null),
})
const doc = (rakiPack: number | null, rakiUom = 'case') =>
  ({
    documentId: 'paper-1',
    docType: 'invoice',
    layer1: {
      seller: { name: v('SYNTHETIC Vendor') },
      lines: [line('SYNTHETIC Rakı', 'KOLİ'), line('SYNTHETIC Tonik', 'ADET')],
    },
    layer2: {
      lines: [
        { lineIndex: 0, lineId: 'pl-1', inventoryIdSource: 'line', canonicalUom: rakiUom, packSize: rakiPack },
        { lineIndex: 1, lineId: 'pl-2', inventoryIdSource: 'line', canonicalUom: 'each', packSize: 1 },
      ],
    },
    layer3: {
      lines: [0, 1].map((i) => ({ lineIndex: i, ordered: null, shipped: null, billed: 2, received: 'not_counted' })),
    },
  }) as unknown as CanonicalDocument

type Sent = { lines: { lineNo: number; qty: number; packSize?: number }[] }

describe('knownPack', () => {
  it.each([[12, 12], ['6', 6], [2, 2]])('%p is %p', (raw, n) => expect(knownPack(raw)).toBe(n))
  it.each([[1], [0], [2.5], [null], [undefined], [''], ['x']])('%p is no pack', (raw) =>
    expect(knownPack(raw)).toBeNull(),
  )
})

describe('DoorFrame asks for the pack the paper does not state (r28 G1)', () => {
  it.each([[1], [null]])('a case with paper pack %p asks, and holds the count until it is said', async (pack) => {
    const sent: Sent[] = []
    render(<DoorFrame doc={doc(pack)} onSubmitCount={async (i) => void sent.push(i as Sent)} />)
    expect(screen.getAllByTestId('door-pack')).toHaveLength(1)
    expect(screen.getByTestId('door-pack').textContent).toContain('Bottles in one case')
    expect(screen.queryByTestId('door-pack-missing')).toBeNull()

    await userEvent.type(screen.getAllByTestId('door-count-input')[0], '2')
    expect(screen.getByTestId('door-pack-missing').textContent).toMatch(/^Line 1 is counted\s+in cases/)
    expect(screen.getByTestId('door-submit')).toBeDisabled()

    await userEvent.type(screen.getByTestId('door-pack-input'), '1')
    expect(screen.getByTestId('door-submit')).toBeDisabled()
    await userEvent.clear(screen.getByTestId('door-pack-input'))
    await userEvent.type(screen.getByTestId('door-pack-input'), '12')
    expect(screen.queryByTestId('door-pack-missing')).toBeNull()
    expect(screen.getByTestId('door-submit')).toBeEnabled()

    await userEvent.click(screen.getByTestId('door-submit'))
    expect(sent[0].lines).toEqual([expect.objectContaining({ lineNo: 1, qty: 2, packSize: 12 })])
  })

  it('a case counted at zero does not wait for a pack', async () => {
    render(<DoorFrame doc={doc(null)} onSubmitCount={async () => {}} />)
    await userEvent.type(screen.getAllByTestId('door-count-input')[0], '0')
    expect(screen.queryByTestId('door-pack-missing')).toBeNull()
    expect(screen.getByTestId('door-submit')).toBeEnabled()
  })

  it('a case whose paper states its pack is not asked, sends no pack, and shows the size', async () => {
    const sent: Sent[] = []
    render(<DoorFrame doc={doc(12)} onSubmitCount={async (i) => void sent.push(i as Sent)} />)
    expect(screen.queryByTestId('door-pack')).toBeNull()
    expect(screen.getAllByTestId('door-line')[0].textContent).toContain('12 bottles to a case')
    await userEvent.type(screen.getAllByTestId('door-count-input')[0], '2')
    await userEvent.click(screen.getByTestId('door-submit'))
    expect(sent[0].lines[0]).not.toHaveProperty('packSize')
  })

  it('a piece line is never asked for a pack', async () => {
    const sent: Sent[] = []
    render(<DoorFrame doc={doc(null)} onSubmitCount={async (i) => void sent.push(i as Sent)} />)
    await userEvent.type(screen.getAllByTestId('door-count-input')[1], '3')
    expect(screen.getByTestId('door-submit')).toBeEnabled()
    await userEvent.click(screen.getByTestId('door-submit'))
    expect(sent[0].lines[0]).not.toHaveProperty('packSize')
  })

  it('a pack line says pack', async () => {
    render(<DoorFrame doc={doc(null, 'pack')} onSubmitCount={async () => {}} />)
    expect(screen.getByTestId('door-pack').textContent).toContain('Bottles in one pack')
  })

  it('a read-only frame asks nothing', () => {
    render(<DoorFrame doc={doc(null)} />)
    expect(screen.queryByTestId('door-pack')).toBeNull()
  })
})
