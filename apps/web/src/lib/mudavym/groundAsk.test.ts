/**
 * The gate for the theme question (N-08 / P0-1): after a first task of the
 * person's own, quiet for 30 days after "Not now", never on an unread account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  GROUND_ASK_SNOOZE_MS,
  applyAccountGroundAsk,
  getGroundAskGate,
  groundAskDue,
  noteGroundTaskDone,
  registerGroundAskWriter,
  resetGroundAsk,
  resetGroundAskForTests,
  snoozeGroundAsk,
  watchFirstTask,
  type GroundAskRecord,
} from './groundAsk';
import { applyAccountGround, resetGroundChoiceForTests, setGroundOwner } from './groundChoice';

const T = Date.parse('2026-11-18T12:00:00.000Z');

beforeEach(() => {
  resetGroundChoiceForTests();
  resetGroundAskForTests();
});
afterEach(() => {
  resetGroundChoiceForTests();
  resetGroundAskForTests();
});

describe('groundAskDue', () => {
  const known = { known: true, firstTaskAt: '2026-11-18T11:00:00.000Z', snoozedUntil: null };
  it('is closed until the account has answered', () => {
    expect(groundAskDue({ ...known, known: false }, T)).toBe(false);
  });
  it('is closed before a first task', () => {
    expect(groundAskDue({ ...known, firstTaskAt: null }, T)).toBe(false);
  });
  it('is open after a first task with no snooze', () => {
    expect(groundAskDue(known, T)).toBe(true);
  });
  it('is closed inside a snooze and open at its end', () => {
    const until = new Date(T + 1000).toISOString();
    expect(groundAskDue({ ...known, snoozedUntil: until }, T)).toBe(false);
    expect(groundAskDue({ ...known, snoozedUntil: until }, T + 1000)).toBe(true);
  });
  it('treats an unreadable stamp as no stamp', () => {
    expect(groundAskDue({ ...known, firstTaskAt: 'not a date' }, T)).toBe(false);
    expect(groundAskDue({ ...known, snoozedUntil: 'not a date' }, T)).toBe(true);
  });
});

describe('writing', () => {
  it('writes the first task once, as a whole record, and not before the account answered', () => {
    const sent: GroundAskRecord[] = [];
    registerGroundAskWriter((r) => (sent.push(r), Promise.resolve()));
    noteGroundTaskDone(T);
    expect(sent).toEqual([]);
    applyAccountGroundAsk(undefined);
    noteGroundTaskDone(T);
    noteGroundTaskDone(T + 5000);
    expect(sent).toEqual([{ firstTaskAt: new Date(T).toISOString() }]);
  });

  it('a snooze keeps the first-task stamp in the same write and lasts 30 days', () => {
    const sent: GroundAskRecord[] = [];
    registerGroundAskWriter((r) => (sent.push(r), Promise.resolve()));
    applyAccountGroundAsk({ firstTaskAt: '2026-11-01T00:00:00.000Z' });
    snoozeGroundAsk(T);
    expect(sent).toEqual([
      {
        firstTaskAt: '2026-11-01T00:00:00.000Z',
        snoozedUntil: new Date(T + GROUND_ASK_SNOOZE_MS).toISOString(),
      },
    ]);
  });

  it('a refetch that raced our own write cannot un-snooze or un-stamp', () => {
    applyAccountGroundAsk({ firstTaskAt: '2026-11-01T00:00:00.000Z' });
    snoozeGroundAsk(T);
    applyAccountGroundAsk({ firstTaskAt: '2026-11-01T00:00:00.000Z' });
    expect(getGroundAskGate().snoozedUntil).toBe(new Date(T + GROUND_ASK_SNOOZE_MS).toISOString());
    applyAccountGroundAsk(undefined);
    expect(getGroundAskGate().firstTaskAt).toBe('2026-11-01T00:00:00.000Z');
  });

  it('a failed write is swallowed: the page still honours the snooze it holds', async () => {
    registerGroundAskWriter(() => Promise.reject(new Error('503')));
    applyAccountGroundAsk({ firstTaskAt: '2026-11-01T00:00:00.000Z' });
    snoozeGroundAsk(T);
    await Promise.resolve();
    expect(getGroundAskGate().snoozedUntil).not.toBeNull();
  });

  it('resetGroundAsk forgets the previous person', () => {
    applyAccountGroundAsk({ firstTaskAt: '2026-11-01T00:00:00.000Z' });
    resetGroundAsk();
    expect(getGroundAskGate()).toEqual({ known: false, firstTaskAt: null, snoozedUntil: null });
  });
});

describe('watchFirstTask', () => {
  let client: QueryClient;
  let stop: () => void;
  beforeEach(() => {
    client = new QueryClient();
    setGroundOwner('u1');
    applyAccountGround(undefined);
    applyAccountGroundAsk(undefined);
    stop = watchFirstTask(client);
  });
  afterEach(() => {
    stop();
    client.clear();
  });

  async function run(fn: () => Promise<unknown>) {
    await client.getMutationCache().build(client, { mutationFn: fn }).execute(undefined);
  }

  it('[REVERT-FAILS] counts a save a person started with a tap', async () => {
    window.dispatchEvent(new Event('pointerdown'));
    await run(() => Promise.resolve('ok'));
    expect(getGroundAskGate().firstTaskAt).not.toBeNull();
  });

  it('[REVERT-FAILS] does not count a write the app made on its own', async () => {
    await run(() => Promise.resolve('ok'));
    expect(getGroundAskGate().firstTaskAt).toBeNull();
  });

  it('does not count a save that failed', async () => {
    window.dispatchEvent(new Event('pointerdown'));
    await run(() => Promise.reject(new Error('no'))).catch(() => {});
    expect(getGroundAskGate().firstTaskAt).toBeNull();
  });

  it('does not count a tap from long before the save', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T);
      window.dispatchEvent(new Event('pointerdown'));
      vi.setSystemTime(T + 60_000);
      await run(() => Promise.resolve('ok'));
      expect(getGroundAskGate().firstTaskAt).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('notes it for someone who has already chosen a theme too (the tour banner waits on it)', async () => {
    applyAccountGround('charcoal');
    window.dispatchEvent(new Event('pointerdown'));
    await run(() => Promise.resolve('ok'));
    expect(getGroundAskGate().firstTaskAt).not.toBeNull();
  });
});
