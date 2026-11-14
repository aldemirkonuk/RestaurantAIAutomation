/**
 * r33 walk F3: the door note says what a count moved, and a recorded count is
 * not followed by "Nothing counted yet". The paper fixture follows
 * door-after-verify.test.tsx. All data SYNTHETIC.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DoorFrame } from '../DoorFrame'
import type { CanonicalDocument } from '../../../services/api/canonical'
import type { DoorBooking } from '../../../services/api/deliveries'

const v = <T,>(value: T) => ({ value })
function doc(received: number | 'not_counted' = 'not_counted'): CanonicalDocument {
  const line = {
    description: v('SYNTHETIC Öküzgözü'),
    sellerItemId: v<string | null>(null),
    unit: v('bottle'),
    vintage: v<number | null>(null),
    formatMl: v<number | null>(null),
  }
  return {
    documentId: 'paper-1',
    docType: 'invoice',
    layer1: { seller: { name: v('SYNTHETIC Vendor') }, lines: [line, line] },
    layer2: {
      lines: [
        { lineIndex: 0, lineId: 'pl-1', inventoryIdSource: 'line' },
        { lineIndex: 1, lineId: 'pl-2', inventoryIdSource: 'line' },
      ],
    },
    layer3: {
      lines: [
        { lineIndex: 0, ordered: null, shipped: null, billed: 6, received },
        { lineIndex: 1, ordered: null, shipped: null, billed: 6, received: 'not_counted' },
      ],
    },
  } as unknown as CanonicalDocument
}

const note = (booking: DoorBooking) => {
  render(<DoorFrame doc={doc()} onSubmitCount={async () => {}} booking={booking} />)
  return screen.getByTestId('door-booking').textContent ?? ''
}

describe('what a door count moved, in words (r33 F3)', () => {
  it('a count that added says how many lines went on the shelf', () => {
    expect(note({ booked: [{ lineNo: 1, inventoryId: 'i1', delta: 6 }], notBooked: [] })).toBe(
      'The count is recorded. 1 line went on the shelf.',
    )
  })

  it('a lower recount says its line came off the shelf, never that it went on', () => {
    const text = note({ booked: [{ lineNo: 1, inventoryId: 'i1', delta: -2 }], notBooked: [] })
    expect(text).toBe(
      'The count is recorded. 1 line came off it, since its new count is lower than the one it replaces.',
    )
    expect(text).not.toContain('went on the shelf')
  })

  it('a count that added one line and lowered two says both, in the plural', () => {
    expect(
      note({
        booked: [
          { lineNo: 1, inventoryId: 'i1', delta: 3 },
          { lineNo: 2, inventoryId: 'i2', delta: -1 },
          { lineNo: 3, inventoryId: 'i3', delta: -4 },
        ],
        notBooked: [],
      }),
    ).toBe(
      'The count is recorded. 1 line went on the shelf. 2 lines came off it, since their new counts are lower than the ones they replace.',
    )
  })

  it('a count the shelf already held says nothing moved', () => {
    expect(note({ booked: [{ lineNo: 1, inventoryId: 'i1', delta: 0 }], notBooked: [] })).toBe(
      'The count is recorded. The shelf already held it, so nothing moved.',
    )
  })

  it('a count whose every line was refused says nothing went on the shelf, then each reason', () => {
    const text = note({ booked: [], notBooked: [{ lineNo: 1, label: 'SYNTHETIC line', reason: 'not paired' }] })
    expect(text).toContain('The count is recorded, but nothing went on the shelf.')
    expect(text).toContain('Not on the shelf: SYNTHETIC line — not paired')
    expect(text).not.toContain('0 lines')
  })

  it('a failed booking still says so in the gateway’s words', () => {
    expect(note({ failed: true, error: 'boom', booked: [], notBooked: [] })).toBe(
      'The count is recorded, but nothing was put on the shelf: boom.',
    )
  })
})

describe('the hint under the count (r33 F3)', () => {
  const hint = () => screen.getByTestId('door-count-hint').textContent ?? ''

  it('after a recorded count it does not say "Nothing counted yet"', () => {
    render(
      <DoorFrame
        doc={doc()}
        onSubmitCount={async () => {}}
        booking={{ booked: [{ lineNo: 1, inventoryId: 'i1', delta: 6 }], notBooked: [] }}
      />,
    )
    expect(hint()).toBe(
      'Nothing new is being counted. A line counted again replaces its earlier count; a line you do not touch keeps the count it has.',
    )
  })

  it('on a paper already counted at an earlier visit it says the same', () => {
    render(<DoorFrame doc={doc(6)} onSubmitCount={async () => {}} />)
    expect(hint()).toMatch(/^Nothing new is being counted/)
  })

  it('on a paper nobody has counted it still says nothing is counted yet', () => {
    render(<DoorFrame doc={doc()} onSubmitCount={async () => {}} />)
    expect(hint()).toMatch(/^Nothing counted yet\./)
  })

  it('after a count whose booking failed it still does not say "Nothing counted yet": the count is recorded', () => {
    render(
      <DoorFrame doc={doc()} onSubmitCount={async () => {}} booking={{ failed: true, error: 'boom', booked: [], notBooked: [] }} />,
    )
    expect(hint()).toMatch(/^Nothing new is being counted/)
  })
})
