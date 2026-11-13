import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { CanonicalDocument } from '../../../services/api/canonical'
import { DoorFrame } from '../DoorFrame'

/** r24: the door of a paper sends the paper's line, and says what the count did. */
const v = <T,>(value: T) => ({ value })
const line = (description: string, unit = 'liter') => ({
  description: v(description),
  sellerItemId: v<string | null>(null),
  unit: v(unit),
  vintage: v<number | null>(null),
  formatMl: v<number | null>(null),
})
const doc = (opts: { received?: (number | 'not_counted')[]; source?: ('line' | 'order' | null)[] } = {}) =>
  ({
    documentId: 'paper-1',
    docType: 'invoice',
    layer1: { seller: { name: v('SYNTHETIC Vendor') }, lines: [line('Zeytinyağı'), line('Tonik', 'bottle')] },
    layer2: {
      lines: [
        { lineIndex: 0, lineId: 'pl-1', inventoryIdSource: opts.source?.[0] ?? 'line' },
        { lineIndex: 1, lineId: 'pl-2', inventoryIdSource: opts.source?.[1] ?? 'line' },
      ],
    },
    layer3: {
      lines: [0, 1].map((i) => ({
        lineIndex: i,
        ordered: null,
        shipped: null,
        billed: 5,
        received: opts.received?.[i] ?? 'not_counted',
      })),
    },
  }) as unknown as CanonicalDocument

describe('DoorFrame on a paper (r24)', () => {
  it("sends each counted line's own paper line", async () => {
    const sent: { lines: { lineNo: number; sourceLineId?: string }[] }[] = []
    render(<DoorFrame doc={doc()} onSubmitCount={async (i) => void sent.push(i)} />)
    await userEvent.type(screen.getAllByTestId('door-count-input')[1], '12')
    await userEvent.click(screen.getByTestId('door-submit'))
    expect(sent[0].lines).toEqual([expect.objectContaining({ lineNo: 2, qty: 12, sourceLineId: 'pl-2' })])
  })

  it('a paper counted before says so, and each counted line says what it holds', () => {
    render(<DoorFrame doc={doc({ received: [5, 'not_counted'] })} onSubmitCount={async () => {}} />)
    expect(screen.getByTestId('door-frame').textContent).toContain('Counted at the door')
    expect(screen.getByTestId('door-frame').textContent).not.toContain('Nobody has counted this yet')
    const soFar = screen.getAllByTestId('door-counted-so-far')
    expect(soFar).toHaveLength(1)
    // r26 walk: "5 liter" is said in words, "5 liters" (one is "1 liter").
    expect(soFar[0].textContent).toContain('Counted so far: 5 liters.')
    expect(screen.getByTestId('door-frame').textContent).toContain('The paperwork says 5 liters')
  })

  it('one of a unit is said in the singular, and a unit code in words', () => {
    const one = doc({ received: [1, 'not_counted'] })
    ;(one.layer1.lines[1] as { unit: { value: string } }).unit.value = 'split_case'
    render(<DoorFrame doc={one} onSubmitCount={async () => {}} />)
    expect(screen.getAllByTestId('door-counted-so-far')[0].textContent).toContain('Counted so far: 1 liter.')
    expect(screen.getByTestId('door-frame').textContent).toContain('5 split cases')
    expect(screen.getByTestId('door-frame').textContent).not.toContain('split_case')
  })

  it('a paper nobody counted says so', () => {
    render(<DoorFrame doc={doc()} onSubmitCount={async () => {}} />)
    expect(screen.getByTestId('door-frame').textContent).toContain('Nobody has counted this yet')
  })

  it('a line the paper has not paired (or only through its order) warns it goes on no shelf', () => {
    render(<DoorFrame doc={doc({ source: ['line', 'order'] })} onSubmitCount={async () => {}} />)
    expect(screen.getAllByTestId('door-unpaired')).toHaveLength(1)
  })

  it('says what the count put on the shelf, and why a line did not go', () => {
    render(
      <DoorFrame
        doc={doc()}
        onSubmitCount={async () => {}}
        booking={{
          booked: [{ lineNo: 1, inventoryId: 'oil', delta: 5000 }],
          notBooked: [{ lineNo: 2, label: 'Tonik', reason: 'this line names no item on the shelf.' }],
        }}
      />,
    )
    const note = screen.getByTestId('door-booking').textContent ?? ''
    expect(note).toContain('1 line went on the shelf')
    expect(note).toContain('Not on the shelf: Tonik — this line names no item on the shelf.')
  })

  it('a failed booking is said, never a quiet success', () => {
    render(
      <DoorFrame doc={doc()} onSubmitCount={async () => {}} booking={{ failed: true, error: 'boom', booked: [], notBooked: [] }} />,
    )
    expect(screen.getByTestId('door-booking').textContent).toContain('nothing was put on the shelf: boom')
  })
})
