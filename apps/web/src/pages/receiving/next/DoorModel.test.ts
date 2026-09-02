/**
 * DoorModel — the pure door arithmetic and language.
 *
 * The dev tenant has no orders, so the live "14 of 16 — two short" line
 * cannot be exercised against real data in a browser session; these tests
 * pin the model that renders it instead. The rules under test are the ones
 * the spec argues for: the delta in words, no faked comparison across units,
 * refusal never suggested by arithmetic, and the credit drafted calm and
 * complete.
 */

import { describe, expect, it } from 'vitest';
import type { Order } from '@/services/api/types';
import {
  composeDoorNotes,
  creditDraft,
  doorFacts,
  matchLine,
  normalizeDoorOrder,
  readPaper,
  suggestOutcome,
  NOTES_MAX,
} from './DoorModel';

function caseOrder(quantity: number, extras: Record<string, unknown> = {}) {
  return normalizeDoorOrder({
    id: 'o1',
    orderNumber: 'ORD-2026-00042',
    wineName: 'Barolo Riserva',
    providerName: 'Vinifera Imports',
    quantity,
    unitType: 'cases',
    bottlesTotal: quantity * 12,
    ...extras,
  } as unknown as Order);
}

describe('normalizeDoorOrder', () => {
  it('exposes expected boxes only when the order unit is cases', () => {
    expect(caseOrder(16)?.expectedBoxes).toBe(16);
    const bottles = normalizeDoorOrder({
      quantity: 96,
      unitType: 'bottles',
    } as unknown as Order);
    expect(bottles?.expectedBoxes).toBeNull();
    expect(bottles?.expectedBottles).toBe(96);
  });

  it('treats a missing unit as incomparable, not as cases', () => {
    const vm = normalizeDoorOrder({ quantity: 10 } as unknown as Order);
    expect(vm?.expectedBoxes).toBeNull();
  });
});

describe('matchLine — the delta in words', () => {
  const order = caseOrder(16);

  it('says "14 of 16 — two short"', () => {
    const m = matchLine(14, order);
    expect(m?.text).toBe('14 of 16 — two short.');
    expect(m?.tone).toBe('short');
    expect(m?.deltaBoxes).toBe(-2);
  });

  it('says all there on an even count', () => {
    expect(matchLine(16, order)?.text).toBe('16 of 16 — all there.');
  });

  it('states an overage without alarm', () => {
    expect(matchLine(18, order)?.text).toBe('18 of 16 — two more than ordered.');
  });

  it('refuses to compare boxes against a bottles-only order', () => {
    const bottles = normalizeDoorOrder({
      quantity: 96,
      unitType: 'bottles',
    } as unknown as Order);
    const m = matchLine(5, bottles);
    expect(m?.tone).toBe('incomparable');
    expect(m?.deltaBoxes).toBeNull();
    expect(m?.text).toContain('96 bottles');
  });

  it('is null when nothing is known — the page states the fetch failure itself', () => {
    expect(matchLine(5, null)).toBeNull();
  });
});

describe('suggestOutcome', () => {
  it('suggests short only on a short count, never refused', () => {
    const order = caseOrder(16);
    expect(suggestOutcome(matchLine(14, order))).toBe('short');
    expect(suggestOutcome(matchLine(16, order))).toBe('accepted');
    expect(suggestOutcome(matchLine(18, order))).toBe('accepted');
    expect(suggestOutcome(null)).toBe('accepted');
  });
});

describe('creditDraft — calm, complete, unsent', () => {
  const order = caseOrder(16);

  it('is null for an accepted delivery', () => {
    expect(
      creditDraft({
        outcome: 'accepted',
        reason: null,
        counted: 16,
        order,
        hasPhoto: true,
        driverName: '',
        initials: 'AK',
      }),
    ).toBeNull();
  });

  it('drafts the short with the delta, the photo, the driver and the signature', () => {
    const d = creditDraft({
      outcome: 'short',
      reason: null,
      counted: 14,
      order,
      hasPhoto: true,
      driverName: 'Miguel',
      initials: 'ak',
    });
    expect(d).toContain('Vinifera Imports');
    expect(d).toContain('order ORD-2026-00042');
    expect(d).toContain('14 of 16 boxes — two short');
    expect(d).toContain('photographed at the door');
    expect(d).toContain('Miguel');
    expect(d).toContain('signed by AK');
  });

  it('drafts a refusal with its reason', () => {
    const d = creditDraft({
      outcome: 'refused',
      reason: 'temperature',
      counted: 3,
      order,
      hasPhoto: false,
      driverName: '',
      initials: 'AK',
    });
    expect(d).toContain('refused at the door — temperature');
    expect(d).not.toContain('photographed');
  });
});

describe('composeDoorNotes', () => {
  const shortShip = (extras: Record<string, unknown> = {}) => {
    const order = caseOrder(16);
    return composeDoorNotes({
      outcome: 'short',
      reason: null,
      counted: 14,
      broken: 1,
      order,
      match: matchLine(14, order),
      hasPhoto: true,
      driverName: 'Miguel',
      initials: 'ak',
      ...extras,
    } as Parameters<typeof composeDoorNotes>[0]);
  };

  it('carries the drafted credit — the one thing here that has no column', () => {
    const notes = shortShip();
    expect(notes).toContain('credit-draft (unsent):');
    expect(notes).toContain('14 of 16 boxes — two short');
  });

  it('no longer flattens the structured facts into prose', () => {
    // outcome, reason, counted, expected, broken, signedBy and driver are
    // COLUMNS on procurement_receipt_events now. Repeating them here is what
    // made a real delivery unsaveable.
    const notes = shortShip();
    for (const dead of [
      '[door] outcome=',
      'counted=14 boxes',
      'expected=16 boxes',
      'broken=1',
      'signedBy=',
      'driver=',
    ])
      expect(notes).not.toContain(dead);
  });

  it('cannot exceed the gateway cap, even for the longest real names', () => {
    // THE BLOCKING BUG. `notes` is @MaxLength(500) and doorOutbox.ts treats a
    // 4xx as PERMANENT, so one character too many was not a retry — it was a
    // receiver who could not save the delivery at all while a driver waited.
    //
    // Measured against the pre-fix composer: the fixed skeleton alone was 344
    // characters, and this exact pair of real names produced 546.
    const notes = shortShip({
      order: normalizeDoorOrder({
        orderNumber: 'PO-2026-000148-REV-B-SPLIT-2',
        wineName:
          'Château Pichon Longueville Comtesse de Lalande, Pauillac 2ème Cru Classé 2016, 12x750ml',
        providerName: 'Southern Glazer’s Wine & Spirits of New York, LLC',
        quantity: 16,
        unitType: 'cases',
        bottlesTotal: 192,
      } as unknown as Order),
      driverName: 'Giancarlo Maximiliano Fernandes-Oliveira da Silva Junior',
    });

    expect(notes.length).toBeLessThanOrEqual(NOTES_MAX);
    // And it is still a usable letter, not a stub.
    expect(notes).toContain('credit-draft (unsent):');
    expect(notes).toContain('Southern Glazer');
  });

  it('is bounded by construction, not by arithmetic', () => {
    // A 4000-character name is not realistic; a sentence someone adds later is.
    // The bound has to hold without anyone re-doing the measurement.
    const notes = shortShip({
      order: normalizeDoorOrder({
        orderNumber: 'X'.repeat(400),
        wineName: 'W'.repeat(4000),
        providerName: 'P'.repeat(4000),
        quantity: 16,
        unitType: 'cases',
        bottlesTotal: 192,
      } as unknown as Order),
      driverName: 'D'.repeat(4000),
    });
    expect(notes.length).toBeLessThanOrEqual(NOTES_MAX);
  });

  it('says nothing at all for an accepted delivery', () => {
    expect(shortShip({ outcome: 'accepted' })).toBe('');
  });
});

describe('doorFacts — the structured half, in columns', () => {
  it('sends both quantities in the unit the door counts in', () => {
    const order = caseOrder(16);
    const facts = doorFacts({
      outcome: 'refused',
      reason: 'broken_case',
      counted: 3,
      broken: 1,
      order,
      match: matchLine(3, order),
      hasPhoto: false,
      driverName: '  Miguel  ',
      initials: 'ak',
    });
    // A refusal takes nothing in — and says so in BOXES, which is the unit the
    // field name declares. Sent as bottles it would book 33 bottles of a
    // 36-bottle delivery that never entered the building.
    expect(facts.rejectedQtyInCountedUom).toBe(3);
    expect(facts.expectedQtyInCountedUom).toBe(16);
    expect(facts.refusalReason).toBe('broken_case');
    expect(facts.signedByInitials).toBe('AK');
    expect(facts.driverName).toBe('Miguel');
  });

  it('rejects only the visibly broken when the delivery was taken in', () => {
    const order = caseOrder(16);
    const facts = doorFacts({
      outcome: 'short',
      reason: 'wrong_wine',
      counted: 14,
      broken: 1,
      order,
      match: matchLine(14, order),
      hasPhoto: false,
      driverName: '',
      initials: 'AK',
    });
    expect(facts.rejectedQtyInCountedUom).toBe(1);
    // A reason without a refusal reads as a refusal downstream.
    expect(facts.refusalReason).toBeNull();
    expect(facts.driverName).toBeNull();
  });

  it('states no expectation it cannot compare against', () => {
    const bottles = normalizeDoorOrder({
      quantity: 96,
      unitType: 'bottles',
    } as unknown as Order);
    const facts = doorFacts({
      outcome: 'accepted',
      reason: null,
      counted: 8,
      broken: 0,
      order: bottles,
      match: matchLine(8, bottles),
      hasPhoto: false,
      driverName: '',
      initials: 'AK',
    });
    expect(facts.expectedQtyInCountedUom).toBeNull();
  });
});

describe('the second truck', () => {
  it('counts against the running total, not against the whole order', () => {
    // Truck one brought 8 of 16. Truck two brings 6. Compared against the whole
    // PO that reads "ten short" and starts a vendor claim the paperwork
    // disproves; against the running total it reads "14 of 16 — two short".
    const order = caseOrder(16);
    const line = matchLine(6, order, 8);
    expect(line?.text).toBe('14 of 16 with the earlier 8 — two short.');
    expect(line?.deltaBoxes).toBe(-2);

    const complete = matchLine(8, order, 8);
    expect(complete?.tone).toBe('even');
    expect(complete?.text).toContain('all there');
  });

  it('keeps the ordinary delivery sentence unchanged', () => {
    const order = caseOrder(16);
    expect(matchLine(14, order)?.text).toBe('14 of 16 — two short.');
    expect(matchLine(14, order, 0)?.text).toBe('14 of 16 — two short.');
  });

  it('drafts the credit against the running total too', () => {
    const order = caseOrder(16);
    const d = creditDraft({
      outcome: 'short',
      reason: null,
      counted: 6,
      order,
      hasPhoto: false,
      driverName: '',
      initials: 'AK',
      alreadyReceivedBoxes: 8,
    });
    expect(d).toContain('arrived 6 boxes, 14 of 16 boxes — two short');
    expect(d).not.toContain('ten short');
  });
});

describe('readPaper — the photograph doing work', () => {
  it('sums case lines into a box pre-fill', () => {
    const r = readPaper({
      docType: 'invoice',
      docNumber: 'INV-99',
      total: null,
      tiesOut: null,
      confidence: 0.9,
      warnings: [],
      lines: [
        { qty: 10, uom: 'case', packSize: 12, qtyBottles: 120 },
        { qty: 4, uom: 'case', packSize: 6, qtyBottles: 24 },
        { qty: 24, uom: 'bottle', packSize: 12, qtyBottles: 24 },
      ],
    });
    expect(r?.boxes).toBe(16); // 10 + 4 + 24/12
    expect(r?.bottles).toBe(168);
    expect(r?.lineCount).toBe(3);
  });

  it('pre-fills nothing from an unreadable parse', () => {
    const r = readPaper({
      docType: 'unknown',
      docNumber: null,
      total: null,
      tiesOut: null,
      confidence: 0,
      warnings: ['unreadable'],
      lines: [],
    });
    expect(r?.boxes).toBeNull();
    expect(r?.bottles).toBeNull();
  });
});
