/**
 * COMMS-W34 — the words a person left a sheet holding. What this pins: a
 * discarded hold is never handed back on reopen, Put it back returns it, and
 * a new hold draws a new stub (a fresh `n`) rather than reusing a spent one.
 */

import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { changedLine, heldLine, useHeldWords } from './held-words';

describe('useHeldWords (COMMS-W34)', () => {
  it('holds, discards, puts back and drops by key', () => {
    const { result } = renderHook(() => useHeldWords<string>());
    act(() => result.current.hold('new', 'Merhaba'));
    expect(result.current.words('new')).toBe('Merhaba');
    expect(result.current.words('t')).toBeNull();
    const first = result.current.get('new')?.n;

    act(() => result.current.discard('new'));
    expect(result.current.get('new')?.discarded).toBe(true);
    expect(result.current.words('new')).toBeNull();

    act(() => result.current.restore('new'));
    expect(result.current.words('new')).toBe('Merhaba');

    act(() => result.current.hold('new', 'Merhaba again'));
    expect(result.current.get('new')?.n).not.toBe(first);
    expect(result.current.get('new')?.discarded).toBe(false);

    act(() => result.current.drop('new'));
    expect(result.current.get('new')).toBeUndefined();
  });
});

describe('changedLine — a drafted letter quotes what was changed (COMMS-W34)', () => {
  const drafted = { subject: 'Credit note for PO-009', body: 'Hello Marta,\n\nTwo bottles arrived corked.\n\nSim Meyhouse' };

  it('quotes the first paragraph that is not the draft’s, not the opening', () => {
    const held = { subject: drafted.subject, body: 'Hello Marta,\n\nTwo bottles arrived corked. Credit both, please.\n\nSim Meyhouse' };
    expect(changedLine(held, drafted)).toBe('Two bottles arrived corked. Credit both, please.');
  });

  it('a new subject comes first', () => {
    const held = { subject: 'Credit for PO-009, both bottles', body: drafted.body };
    expect(changedLine(held, drafted)).toBe('Credit for PO-009, both bottles');
  });

  it('a paragraph added at the end is the one quoted', () => {
    const held = { subject: drafted.subject, body: `${drafted.body}\n\nPS: this week if you can.` };
    expect(changedLine(held, drafted)).toBe('PS: this week if you can.');
  });

  it('when no paragraph differs, it falls back to the opening', () => {
    const held = { subject: drafted.subject, body: 'Hello Marta,\n\nTwo bottles arrived corked.' };
    expect(changedLine(held, drafted)).toBe('Credit note for PO-009 — Hello Marta, Two bottles arrived corked.');
  });
});

describe('heldLine (COMMS-W34)', () => {
  it('quotes the subject, then the letter on one line', () => {
    expect(heldLine('Standing order', 'Merhaba,\n\nNext week:  6 cases')).toBe('Standing order — Merhaba, Next week: 6 cases');
    expect(heldLine('', 'Merhaba,')).toBe('Merhaba,');
  });

  it('cuts a long letter with an ellipsis, inside the limit', () => {
    const line = heldLine('Subject', 'x'.repeat(300), 40);
    expect(line.length).toBe(40);
    expect(line.endsWith('…')).toBe(true);
  });
});
