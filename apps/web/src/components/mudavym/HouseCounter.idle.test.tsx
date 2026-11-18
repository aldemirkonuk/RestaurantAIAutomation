/**
 * The quiet counter: when every register answered and none holds anything the
 * 320 px column folds to a 56 px column of dots (r58, N-09). It never folds on
 * a read it has not got, opens on a tap, and folds back when something waits.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { HouseCounter, agoWord, isCounterIdle } from './HouseCounter';
import type { CounterRegister, HouseCounterRead } from '../../lib/mudavym/counterRead';
import type { HouseCounterState } from '../../lib/mudavym/useHouseCounter';
import { resetHouseSaid } from '../../lib/mudavym/houseSaid';

const T = '2026-09-21T14:02:11Z';

function empty(key: string, verb: CounterRegister['verb'], act: 'yours' | 'not_yours' = 'yours'): CounterRegister {
  return { key, verb, state: 'answered', readAt: T, ms: 1, count: 0, complete: true, act, rows: [] } as unknown as CounterRegister;
}
function read(registers: CounterRegister[]): HouseCounterRead {
  return { readAt: T, house: { id: 'h', currency: { state: 'recorded', code: 'USD' } }, role: 'owner', registers } as HouseCounterRead;
}
function state(registers: CounterRegister[], over: Partial<HouseCounterState> = {}): HouseCounterState {
  return { last: read(registers), reading: false, failure: null, offline: false, readNow: vi.fn(), ...over };
}
const QUIET = [empty('orders', 'seal'), empty('deliveries', 'verify'), empty('threads', 'reply', 'not_yours')];

function mount(s: HouseCounterState, width: 'open' | 'tucked' = 'open', onToggle = vi.fn()) {
  return render(
    <MemoryRouter>
      <HouseCounter state={s} onOpen={vi.fn()} width={width} onToggle={onToggle} />
    </MemoryRouter>,
  );
}

beforeEach(() => resetHouseSaid());
afterEach(() => vi.useRealTimers());

describe('isCounterIdle', () => {
  it('is quiet only when every answered register is empty', () => {
    expect(isCounterIdle(state(QUIET))).toBe(true);
    expect(isCounterIdle(state([{ ...QUIET[0], count: 2 } as CounterRegister]))).toBe(false);
  });
  it('never on a read it does not have', () => {
    expect(isCounterIdle(state(QUIET, { last: null }))).toBe(false);
    expect(isCounterIdle(state(QUIET, { offline: true }))).toBe(false);
    expect(isCounterIdle(state(QUIET, { failure: { sentence: 'x', at: T } as HouseCounterState['failure'] }))).toBe(false);
    const unread = { key: 'x', verb: 'verify', state: 'unreadable', readAt: T, ms: 1, status: 503, sentence: 's' } as unknown as CounterRegister;
    expect(isCounterIdle(state([...QUIET, unread]))).toBe(false);
  });
});

describe('the quiet column', () => {
  it('is five dots and no "none waiting" lines', () => {
    const { container } = mount(state(QUIET));
    expect(screen.getByLabelText('The counter, nothing waiting')).toBeTruthy();
    expect(container.querySelectorAll('.mdv-counter__dot')).toHaveLength(5);
    expect(screen.queryByText(/none waiting/)).toBeNull();
    expect(screen.queryByText('On the counter')).toBeNull();
  });

  it('opens the full counter on a tap and tucks back to the dots', () => {
    const onToggle = vi.fn();
    mount(state(QUIET), 'open', onToggle);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(screen.getByText('On the counter')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tuck the counter' }));
    expect(screen.queryByText('On the counter')).toBeNull();
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('is the full counter the moment something waits', () => {
    const { rerender } = mount(state(QUIET));
    rerender(
      <MemoryRouter>
        <HouseCounter
          state={state([{ ...QUIET[0], count: 1, rows: [] } as CounterRegister, QUIET[1], QUIET[2]])}
          onOpen={vi.fn()}
          width="open"
          onToggle={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('On the counter')).toBeTruthy();
  });
});

describe('the sync line', () => {
  it('says how long ago, each second', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T14:02:23Z'));
    mount(state([{ ...QUIET[0], count: 1 } as CounterRegister]));
    expect(screen.getByText(/synced 12 s ago/)).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/synced 15 s ago/)).toBeTruthy();
  });
  it('words the age in s, min and h', () => {
    expect([agoWord(12_000), agoWord(125_000), agoWord(3 * 3600_000)]).toEqual(['12 s', '2 min', '3 h']);
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(join(__dirname, 'house-shell.css'), 'utf8');
  const palette = readFileSync(join(__dirname, '../../styles/mudavym.css'), 'utf8');

  it('breathes the halo for 1.6 s and stills it under reduced motion', () => {
    expect(css).toMatch(/\.mdv-counter__dot\[data-kind='owner'\]::after\s*\{[^}]*animation: mdv-halo 1\.6s/);
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/mdv-counter__dot\[data-kind='owner'\]::after[\s\S]*animation: none/);
    expect(reduced).toMatch(/\.mdv-counter__arc/);
  });
  it('moves only transform and opacity', () => {
    const frames = css.match(/@keyframes mdv-(halo|idle-in|arc)\s*\{[\s\S]*?\n\}/g) ?? [];
    expect(frames).toHaveLength(3);
    for (const f of frames) expect(f.replace(/@keyframes[^{]*\{/, '')).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
  });
  it('draws its fill from --seal, which the charcoal ground also defines', () => {
    expect(css).toMatch(/\[data-kind='waits'\][\s\S]*?background: var\(--seal\)/);
    const dark = palette.slice(palette.indexOf('.mudavym[data-ground="charcoal"]'));
    expect(dark).toMatch(/--seal: #/);
  });
});
