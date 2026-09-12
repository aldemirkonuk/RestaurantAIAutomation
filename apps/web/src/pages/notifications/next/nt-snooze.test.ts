/**
 * Snooze's two wake edges, and the one thing it must never do.
 *
 * Each case here corresponds to a way this feature is usually got wrong: a
 * pause that never ends, a pause that survives the situation getting worse, a
 * pause that outlives the line it belongs to, and a record that grows without
 * bound in one browser's storage.
 */

import { describe, expect, it } from 'vitest';
import { SnoozeRecord, resolveSnoozes, sleepsFor } from './nt-snooze';

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);
const rec = (over: Partial<SnoozeRecord> = {}): SnoozeRecord => ({
  id: 'n1',
  until: NOW + 3_600_000,
  seenAt: NOW - 3_600_000,
  seenFolded: 0,
  ...over,
});
const row = (over: Partial<{ id: string; stampedAt: number; folded: number; unread: boolean }> = {}) => ({
  id: 'n1',
  stampedAt: NOW - 3_600_000,
  folded: 0,
  unread: true,
  ...over,
});

describe('resolveSnoozes', () => {
  it('keeps a line asleep while nothing has changed and the time is not up', () => {
    const out = resolveSnoozes([rec()], [row()], NOW);
    expect([...out.asleep]).toEqual(['n1']);
    expect(out.woke).toEqual([]);
    expect(out.keep).toHaveLength(1);
  });

  it('wakes it when the deadline passes', () => {
    const out = resolveSnoozes([rec({ until: NOW - 1 })], [row()], NOW);
    expect(out.asleep.size).toBe(0);
    expect(out.woke).toEqual([{ id: 'n1', reason: 'deadline' }]);
    expect(out.keep).toEqual([]);
  });

  it('wakes it when the register writes about it again — a newer stamp', () => {
    const out = resolveSnoozes([rec()], [row({ stampedAt: NOW - 60_000 })], NOW);
    expect(out.woke).toEqual([{ id: 'n1', reason: 'activity' }]);
  });

  it('wakes it when the alert simply repeats — one more folded duplicate', () => {
    const out = resolveSnoozes([rec({ seenFolded: 2 })], [row({ folded: 3 })], NOW);
    expect(out.woke).toEqual([{ id: 'n1', reason: 'activity' }]);
  });

  it('drops the record when the line was dealt with elsewhere', () => {
    const out = resolveSnoozes([rec()], [row({ unread: false })], NOW);
    expect(out.woke).toEqual([{ id: 'n1', reason: 'settled' }]);
    expect(out.keep).toEqual([]);
  });

  it('keeps a line down while its page has not been read, and announces nothing', () => {
    // The row is absent from the book — it may be twelve pages back. Waking it
    // would make "read further back" un-snooze everything it touched, and
    // announcing it would name a line the reader cannot see.
    const out = resolveSnoozes([rec()], [], NOW);
    expect(out.keep).toHaveLength(1);
    expect([...out.asleep]).toEqual(['n1']);
    expect(out.woke).toEqual([]);
  });

  it('forgets a record once its deadline has passed, even if the row never came back', () => {
    const out = resolveSnoozes([rec({ until: NOW - 1 })], [], NOW);
    expect(out.keep).toEqual([]);
    expect(out.woke).toEqual([]); // nothing on screen to announce
  });
});

describe('sleepsFor', () => {
  it('says how long is left, and never guesses a past deadline', () => {
    expect(sleepsFor(NOW + 90 * 60_000, NOW)).toBe('1h 30m');
    expect(sleepsFor(NOW + 20 * 60_000, NOW)).toBe('20m');
    expect(sleepsFor(NOW - 1, NOW)).toBe('due back now');
    expect(sleepsFor(Number.NaN, NOW)).toBe('due back now');
  });
});
