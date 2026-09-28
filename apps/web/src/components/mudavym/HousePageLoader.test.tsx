/**
 * The loader ladder: silent for the first 400ms (most chunks are cached and
 * load faster than that — showing anything reads as a stutter), a quiet mark
 * + skeleton from 400ms, and past 12s the copy says it is taking a while.
 * Legacy (shell off) is unchanged: the original instant spinner, no ladder.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { HousePageLoader } from './HousePageLoader';
import { clearMudavymDesignCache } from '../../lib/mudavym/useMudavymDesign';

beforeEach(() => {
  clearMudavymDesignCache();
  window.localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("shell off (the QA override '0' -- since 2026-09-25 the only way to legacy)", () => {
  beforeEach(() => window.localStorage.setItem('mudavym.design.shell', '0'));

  it('renders the legacy spinner immediately — no ladder, no staging', () => {
    render(<HousePageLoader />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });
});

describe('shell on (the default: live in code since 2026-09-25, no override, no flag row)', () => {

  it('renders nothing for the first 400ms', () => {
    const { container } = render(<HousePageLoader />);
    act(() => vi.advanceTimersByTime(399));
    expect(container.textContent).toBe('');
  });

  it('shows a quiet mark and a skeleton from 400ms', () => {
    render(<HousePageLoader />);
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByText('Reading…')).toBeTruthy();
    expect(document.querySelector('.mdv-skel')).toBeTruthy();
  });

  it('says it is taking a while only past 12s, not before', () => {
    render(<HousePageLoader />);
    act(() => vi.advanceTimersByTime(11_999));
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText(/taking longer than usual/)).toBeTruthy();
  });
});
