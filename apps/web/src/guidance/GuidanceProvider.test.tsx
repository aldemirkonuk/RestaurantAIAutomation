/**
 * Page tips leave when told to, and "Don't show tips again" means every page
 * (founder, 2026-10-01): "if I say don't ever show again then I don't want to
 * see it again until I press or check for it."
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, MemoryRouter } from 'react-router-dom';

const updatePreferences = vi.fn();
vi.mock('../hooks/useUserPreferences', () => ({
  // The server copy never comes back in these tests, so anything that leaves
  // the screen does so on the provider's own local read.
  useUserPreferences: () => ({ preferences: {}, updatePreferences }),
}));
vi.mock('../stores', () => ({
  useAuthStore: (sel: (s: { user: { userId: string } }) => unknown) => sel({ user: { userId: 'u-1' } }),
}));
vi.mock('driver.js', () => ({ driver: () => ({ drive: vi.fn(), destroy: vi.fn() }) }));

import { GuidanceProvider, useGuidance } from './GuidanceProvider';
import { PageTipStrip } from './components/PageTipStrip';

function TipsSwitch() {
  const g = useGuidance();
  return (
    <button type="button" onClick={() => g.resetTips()}>
      {g.state.global.hide_all_tips ? 'tips off' : 'tips on'}
    </button>
  );
}

function mount(path: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <GuidanceProvider>
          <PageTipStrip />
          <Link to="/calendar">calendar</Link>
          <Link to="/inventory">inventory</Link>
          <TipsSwitch />
        </GuidanceProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tip = () => screen.queryByRole('region', { name: 'Page tip' });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  updatePreferences.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('page tips', () => {
  it('shows on a page the person has not seen', () => {
    mount('/orders');
    expect(tip()).toBeTruthy();
  });

  it('is a margin note with three verbs: Show me, Not now, Don\'t show tips again', () => {
    mount('/orders');
    expect(tip()).toHaveClass('mdv-tipnote');
    expect(screen.getByRole('button', { name: /^Show me — \d+ steps?$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Don't show tips again" })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take tour' })).toBeNull();
  });

  it('"Not now" takes it off the screen at once', () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(tip()).toBeNull();
  });

  it('"Don\'t show tips again" takes it off at once and keeps every other page\'s tip off', () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: "Don't show tips again" }));
    expect(tip()).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'calendar' }));
    expect(tip()).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'inventory' }));
    expect(tip()).toBeNull();
    expect(screen.getByRole('button', { name: 'tips off' })).toBeTruthy();
  });

  it('stays off after a reload, from the local mirror alone', () => {
    const first = mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: "Don't show tips again" }));
    first.unmount();
    window.sessionStorage.clear(); // a new sitting
    mount('/calendar');
    expect(tip()).toBeNull();
  });

  it('comes back only when the person turns tips back on', () => {
    mount('/orders');
    fireEvent.click(screen.getByRole('button', { name: "Don't show tips again" }));
    fireEvent.click(screen.getByRole('button', { name: 'tips off' }));
    fireEvent.click(screen.getByRole('link', { name: 'calendar' }));
    expect(tip()).toBeTruthy();
  });
});
