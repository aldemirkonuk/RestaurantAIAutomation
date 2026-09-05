/**
 * `nt-format` — the reader-side emoji normaliser, unit-tested where the page
 * note names its behaviour.
 *
 * WHY THIS FILE EXISTS. The note's "At the reader" paragraph makes three
 * separate claims about `plainText()`, and the component test only ever
 * exercised a LEADING emoji: a title that is *only* a picture comes back empty
 * (so the caller's "Untitled entry" applies, rather than a title being
 * invented); an emoji mid-string is removed while the words around it survive;
 * and a bare variation selector — the invisible U+FE0F that a stripped
 * sequence leaves behind — is removed too. Each of those is a distinct branch
 * of the regex, and a regression in any one of them would have shipped.
 *
 * The counter-claim is tested as well: `©`, `®` and `™` are
 * `Extended_Pictographic`, so a naive sweep would delete the trademark out of
 * a wine name. The house range must not touch them.
 *
 * Every emoji in this file is written as an escape, so the page directory's
 * own emoji grep stays empty while the strings under test are byte-identical
 * to what production rows carry.
 */

import { describe, expect, it } from 'vitest';
import { hasEmoji, iconForKind, iconForType, kindOf, plainText } from './nt-format';

/** The exact literals production stores today (measured 2026-09-03). */
const SIREN = '\u{1F6A8}';
const WARNING = '\u26A0\uFE0F';
const CHART = '\u{1F4CA}';
const VS16 = '\uFE0F';

describe('plainText — the three behaviours the page note claims by name', () => {
  it('returns EMPTY for a title that is only a picture, so the caller can say "Untitled entry"', () => {
    expect(plainText(SIREN)).toBe('');
    expect(plainText(WARNING)).toBe('');
    expect(plainText(`${SIREN} ${CHART}`)).toBe('');
    // The point of the claim: nothing is invented in place of the picture.
    expect(plainText(SIREN)).not.toContain('Untitled');
  });

  it('removes an emoji from the MIDDLE of a string and keeps the words on both sides', () => {
    expect(plainText(`50 wines ${SIREN} dropped below par`)).toBe(
      '50 wines dropped below par',
    );
    expect(plainText(`Low-stock digest ${WARNING} 17 wines below par`)).toBe(
      'Low-stock digest 17 wines below par',
    );
    // and at the end, which is the same branch from the other side
    expect(plainText(`Weekly report ready ${CHART}`)).toBe('Weekly report ready');
  });

  it('removes a BARE variation selector — the invisible remainder of a stripped sequence', () => {
    expect(plainText(VS16)).toBe('');
    expect(plainText(`Verify delivery${VS16}: Rioja Reserva`)).toBe(
      'Verify delivery: Rioja Reserva',
    );
    // A string that looks clean but carries one must not keep it.
    const sneaky = `Schedule published${VS16}`;
    expect(sneaky).not.toBe('Schedule published');
    expect(plainText(sneaky)).toBe('Schedule published');
  });
});

describe('plainText — the leading case, and what it must NOT do', () => {
  it('strips the leading emoji and the space it left behind', () => {
    expect(plainText(`${SIREN} 50 wines dropped below par`)).toBe(
      '50 wines dropped below par',
    );
    expect(plainText(`${WARNING} Low-stock digest: 50 wines below par`)).toBe(
      'Low-stock digest: 50 wines below par',
    );
  });

  it('never deletes the trademark out of a wine name', () => {
    // ©, ® and ™ are Extended_Pictographic; a naive sweep would eat them, and
    // a house that edits its own records is the defect this rule exists against.
    expect(plainText('Opus One™ 2019')).toBe('Opus One™ 2019');
    expect(plainText('Bodega Álvaro® Rioja')).toBe('Bodega Álvaro® Rioja');
    expect(plainText('Cave de Tain © 2026')).toBe('Cave de Tain © 2026');
  });

  it('leaves ordinary text, accents and the house em dash untouched', () => {
    expect(plainText('3 wines dropped below par — 1 critical')).toBe(
      '3 wines dropped below par — 1 critical',
    );
    expect(plainText('Sancerre Les Monts Damnés')).toBe('Sancerre Les Monts Damnés');
    expect(plainText('—')).toBe('—');
  });

  it('answers empty for an absent value rather than throwing or printing "null"', () => {
    expect(plainText(null)).toBe('');
    expect(plainText(undefined)).toBe('');
    expect(plainText('')).toBe('');
    expect(plainText('   ')).toBe('');
  });
});

describe('hasEmoji — the stateful-regex trap', () => {
  it('is not order-dependent: the shared /g regex is reset between calls', () => {
    // `EMOJI_RE` carries the `g` flag, so `.test()` advances `lastIndex`.
    // Called twice on the same string it would return true, then false, if the
    // reset were dropped — which is exactly how this kind of guard rots.
    const s = `${SIREN} 50 wines dropped below par`;
    expect(hasEmoji(s)).toBe(true);
    expect(hasEmoji(s)).toBe(true);
    expect(hasEmoji(s)).toBe(true);
  });

  it('agrees with plainText about what counts as an emoji', () => {
    expect(hasEmoji('Opus One™ 2019')).toBe(false);
    expect(hasEmoji('Weekly report ready')).toBe(false);
    expect(hasEmoji(VS16)).toBe(true);
    expect(hasEmoji(null)).toBe(false);
  });
});

describe('the mark drawn in the emoji’s place', () => {
  it('maps every register a real producer writes to a named register, not "Other"', () => {
    // Each of these is a `type` a producer verified in the gateway actually writes.
    for (const [type, register] of [
      ['inventory_low_stock', 'Stock'],
      ['low_stock', 'Stock'],
      ['report', 'Reports'],
      ['generated_report', 'Reports'],
      ['order_pending', 'Orders'],
      // Split out on 2026-09-03 at the founder's request: deliveries, invoice
      // confirmations, sale records and a goal reached are registers of their
      // own now, and each `type` below is what the producer in
      // `notifications/producers/` actually writes.
      ['delivery_scheduled', 'Deliveries'],
      ['order_delivered', 'Deliveries'],
      ['service_closed', 'Sales'],
      ['goal_reached', 'Goals'],
      ['price_change', 'Market'],
      // The seventh producer, committed 2026-09-04 as `5962901a`
      // (`notifications/producers/grant-suspended.producer.ts`): a
      // model-context server changed or withdrew a tool a manager had granted.
      // Its rows landed under *Other* until this row existed, which is exactly
      // how a new register goes invisible.
      ['grant_suspended', 'Connections'],
      ['mcp_tool_added', 'Connections'],
      ['overdue_order', 'Orders'],
      ['order_inquiry', 'Orders'],
      ['custom_reminder', 'Calendar'],
      ['calendar_reminder', 'Calendar'],
      ['draft_ready', 'Vendor mail'],
      ['unknown_sender', 'Vendor mail'],
      ['vendor_reply', 'Vendor mail'],
      ['invoice_received', 'Invoices'],
      ['email_classified_operational', 'Vendor mail'],
      ['email_classified_promo', 'Vendor mail'],
      ['system', 'System'],
      ['system_alert', 'System'],
      ['payment_due', 'Payments'],
      ['ai_suggestion', 'Advice'],
      ['constraint_triggered', 'Advice'],
    ] as const) {
      expect(kindOf(type), `${type} must not fall to Other`).toBe(register);
    }
  });

  it('gives the seventh producer’s register its own mark, not the Other inbox', () => {
    // A register that draws the fallback mark is a register nobody can pick
    // out of a list — the same absence-as-health shape as falling to *Other*.
    expect(iconForType('grant_suspended')).toBe(iconForKind('Connections'));
    expect(iconForType('grant_suspended')).not.toBe(iconForKind('Other'));
    expect(iconForType('mcp_tool_added')).toBe(iconForKind('Connections'));
    expect(iconForType('mcp_tool_added')).not.toBe(iconForKind('Other'));
  });

  it('still gives an unknown type a real mark rather than nothing', () => {
    expect(kindOf('a_type_nobody_writes_yet')).toBe('Other');
    expect(iconForType('a_type_nobody_writes_yet')).toBeDefined();
    expect(iconForType(null)).toBeDefined();
    expect(iconForKind('not a register')).toBeDefined();
  });

  it('draws the same icon for a type and for the register it belongs to', () => {
    // The chip on the line and the rail's tally row read from these two
    // functions separately; if they ever disagreed the page would show one
    // register two ways.
    expect(iconForType('inventory_low_stock')).toBe(iconForKind('Stock'));
    expect(iconForType('draft_ready')).toBe(iconForKind('Vendor mail'));
    expect(iconForType('report')).toBe(iconForKind('Reports'));
  });
});
