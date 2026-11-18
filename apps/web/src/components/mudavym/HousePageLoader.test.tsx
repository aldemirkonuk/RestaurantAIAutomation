/**
 * The loader ladder: the shell frame at once, a quiet "Reading…" status from
 * 800ms, and past 12s the copy says it is taking a while.
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

  it('paints the shell frame at once and says nothing for the first 800ms', () => {
    const { container } = render(<HousePageLoader />);
    expect(screen.getByTestId('shell-skeleton')).toBeTruthy();
    act(() => vi.advanceTimersByTime(799));
    expect(container.textContent).toBe('');
  });

  it('keeps one aria-live status region from the start and gives it words from 800ms', () => {
    render(<HousePageLoader />);
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    act(() => vi.advanceTimersByTime(800));
    expect(screen.getByRole('status').textContent).toBe('Reading…');
  });

  it('says it is taking a while only past 12s, not before', () => {
    render(<HousePageLoader />);
    act(() => vi.advanceTimersByTime(11_999));
    expect(screen.queryByText(/taking longer than usual/)).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByText(/taking longer than usual/)).toBeTruthy();
  });
});
