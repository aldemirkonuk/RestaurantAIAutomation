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
  matchLine,
  normalizeDoorOrder,
  readPaper,
  suggestOutcome,
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
  it('carries outcome, counts, signature and the draft to the desk', () => {
    const order = caseOrder(16);
    const notes = composeDoorNotes({
      outcome: 'short',
      reason: null,
      counted: 14,
      broken: 1,
      order,
      match: matchLine(14, order),
      hasPhoto: true,
      driverName: 'Miguel',
      initials: 'ak',
    });
    expect(notes).toContain('[door] outcome=short');
    expect(notes).toContain('counted=14 boxes');
    expect(notes).toContain('expected=16 boxes');
    expect(notes).toContain('broken=1');
    expect(notes).toContain('signedBy=AK');
    expect(notes).toContain('credit-draft (unsent):');
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
