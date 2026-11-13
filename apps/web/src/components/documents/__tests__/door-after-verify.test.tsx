/**
 * A door count onto a delivery already verified says what happened to the
 * cost of what it added (r30, web half of r28 invoices G9). The paper fixture
 * follows door-frame-paper.test.tsx, cut to one line. All data SYNTHETIC.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DoorFrame } from '../DoorFrame'
import type { CanonicalDocument } from '../../../services/api/canonical'
import type { DoorBooking } from '../../../services/api/deliveries'

const v = <T,>(value: T) => ({ value })
function doc(): CanonicalDocument {
  return {
    documentId: 'paper-1',
    docType: 'invoice',
    layer1: {
      seller: { name: v('SYNTHETIC Vendor') },
      lines: [
        {
          description: v('SYNTHETIC Öküzgözü'),
          sellerItemId: v<string | null>(null),
          unit: v('bottle'),
          vintage: v<number | null>(null),
          formatMl: v<number | null>(null),
        },
      ],
    },
    layer2: { lines: [{ lineIndex: 0, lineId: 'pl-1', inventoryIdSource: 'line' }] },
    layer3: {
      lines: [{ lineIndex: 0, ordered: null, shipped: null, billed: 6, received: 6 }],
    },
  } as unknown as CanonicalDocument
}

const booked: DoorBooking = {
  booked: [{ lineNo: 1, inventoryId: 'inv-1', delta: 6 }],
  notBooked: [],
}

describe('the door note after a count onto a verified delivery (r28 G9)', () => {
  it('says the cost was posted now', () => {
    render(
      <DoorFrame
        doc={doc()}
        onSubmitCount={async () => {}}
        booking={{
          ...booked,
          afterVerify: {
            costed: 1,
            waitsForAManager: false,
            sentence: 'This delivery was already verified, so what this count added was costed at the agreed price now: 1 item.',
          },
        }}
      />,
    )
    expect(screen.getByTestId('door-after-verify').textContent).toBe(
      'This delivery was already verified, so what this count added was costed at the agreed price now: 1 item.',
    )
  })

  it('says the cost waits for an owner or a manager, in the warning colour', () => {
    render(
      <DoorFrame
        doc={doc()}
        onSubmitCount={async () => {}}
        booking={{
          ...booked,
          afterVerify: { costed: 0, waitsForAManager: true, sentence: 'SYNTHETIC: its cost waits.' },
        }}
      />,
    )
    const p = screen.getByTestId('door-after-verify')
    expect(p.textContent).toBe('SYNTHETIC: its cost waits.')
    expect(p.getAttribute('style')).toContain('rgb(148, 102, 26)')
  })

  it('says nothing about cost for a count onto an open delivery', () => {
    render(<DoorFrame doc={doc()} onSubmitCount={async () => {}} booking={booked} />)
    expect(screen.getByTestId('door-booking')).toBeTruthy()
    expect(screen.queryByTestId('door-after-verify')).toBeNull()
  })

  it('a failed booking never claims a cost', () => {
    render(
      <DoorFrame
        doc={doc()}
        onSubmitCount={async () => {}}
        booking={{
          failed: true,
          error: 'boom',
          booked: [],
          notBooked: [],
          afterVerify: { costed: 1, waitsForAManager: false, sentence: 'SYNTHETIC: costed.' },
        }}
      />,
    )
    expect(screen.queryByTestId('door-after-verify')).toBeNull()
  })
})
