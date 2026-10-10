/**
 * F-729 — the door count's booking, in a restaurant owner's words. The page
 * used to drop this answer, so a count that put nothing on the shelf read the
 * same as one that did.
 */

import { describe, expect, it } from 'vitest'
import { doorBookingSentences } from './deliveries'

describe('doorBookingSentences', () => {
  it('says how many bottles went onto the shelf', () => {
    expect(
      doorBookingSentences({
        booked: [{ lineNo: 1, inventoryId: 'i1', delta: 12 }],
        notBooked: [],
        bottlesMoved: 12,
      }),
    ).toEqual(['12 bottles went onto the shelf.'])
  })

  it('names each line that did not go onto the shelf, and what to do', () => {
    const out = doorBookingSentences({
      booked: [],
      notBooked: [
        // The reason's words are the gateway's to change; the sentence keys on the code.
        { lineNo: 2, label: 'Kalecik Karası', code: 'no_item', reason: 'reworded by the gateway' },
        { lineNo: 3, label: 'Boğazkere', code: 'bad_quantity', reason: 'the counted quantity reads x, which is not a number of bottles' },
      ],
      bottlesMoved: 0,
    })
    expect(out).toEqual([
      'Line 2 (Kalecik Karası) did not go onto the shelf: it is not linked to an item yet. Link it on the sheet, then count it again.',
      'Line 3 (Boğazkere) did not go onto the shelf: its count could not be read.',
    ])
  })

  it('a count that matched the shelf says nothing changed', () => {
    expect(
      doorBookingSentences({
        booked: [{ lineNo: 1, inventoryId: 'i1', delta: 0 }],
        notBooked: [],
        bottlesMoved: 0,
      }),
    ).toEqual(['The shelf already matched this count, so nothing changed.'])
  })

  it('a lower recount says bottles came off', () => {
    expect(
      doorBookingSentences({ booked: [{ lineNo: 1, inventoryId: 'i1', delta: -1 }], notBooked: [], bottlesMoved: -1 }),
    ).toEqual(['1 bottle came off the shelf to match this count.'])
  })

  it('a failed booking and a count with no delivery are never read as a booking', () => {
    expect(
      doorBookingSentences({ failed: true, booked: [], notBooked: [], bottlesMoved: 0 })[0],
    ).toMatch(/no bottles went onto the shelf/)
    expect(doorBookingSentences(null)[0]).toMatch(/not attached to a delivery/)
  })
})
