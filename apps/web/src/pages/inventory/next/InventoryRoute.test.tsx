/**
 * ADR 0315's 2026-10-30 amendment: `/inventory` picks its page by the house's
 * `mudavym_design_inventory_next`. Since the r28 inventory audit (gap 5) the
 * default-ON flag no longer holds the page back: InventoryNext draws at once
 * and stays when the read fails; only an explicit OFF draws the command page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const checkFeatureFlag = vi.fn();
vi.mock('../../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: (...a: unknown[]) => checkFeatureFlag(...a) },
}));
vi.mock('./InventoryNext', () => ({ default: () => <main data-testid="next" /> }));
vi.mock('../command/InventoryCommandPage', () => ({
  InventoryCommandPage: () => <main data-testid="command" />,
}));

import { InventoryRoute } from './InventoryRoute';
import { clearMudavymDesignCache } from '../../../lib/mudavym/useMudavymDesign';

describe('InventoryRoute', () => {
  beforeEach(() => {
    clearMudavymDesignCache();
    checkFeatureFlag.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem('activeRestaurantId', 'r1');
  });
  afterEach(() => window.localStorage.clear());

  it('draws InventoryNext where the house flag is on', async () => {
    checkFeatureFlag.mockResolvedValue({ active: true, enabled: true });
    render(<InventoryRoute />);
    expect(await screen.findByTestId('next')).toBeTruthy();
    expect(checkFeatureFlag).toHaveBeenCalledWith('r1', 'mudavym_design_inventory_next');
  });

  it('keeps the command page where the flag is off', async () => {
    checkFeatureFlag.mockResolvedValue({ active: true, enabled: false });
    render(<InventoryRoute />);
    expect(await screen.findByTestId('command')).toBeTruthy();
    expect(checkFeatureFlag).toHaveBeenCalled();
    expect(screen.queryByTestId('next')).toBeNull();
  });

  it('keeps InventoryNext when the flag read fails, never the command page', async () => {
    let fail!: (e: Error) => void;
    checkFeatureFlag.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    render(<InventoryRoute />);
    fail(new Error('429'));
    await waitFor(() => expect(checkFeatureFlag).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId('next')).toBeTruthy();
    expect(screen.queryByTestId('command')).toBeNull();
  });

  it('draws InventoryNext at once, without waiting on the flag read', () => {
    checkFeatureFlag.mockReturnValue(new Promise(() => {}));
    render(<InventoryRoute />);
    expect(screen.getByTestId('next')).toBeTruthy();
    expect(screen.queryByTestId('command')).toBeNull();
    expect(screen.queryByTestId('inventory-route-reading')).toBeNull();
  });

  it('asks again on the next visit after a failed read, rather than keeping the failure', async () => {
    checkFeatureFlag.mockRejectedValueOnce(new Error('429'));
    const first = render(<InventoryRoute />);
    await waitFor(() => expect(checkFeatureFlag).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    first.unmount();
    checkFeatureFlag.mockResolvedValueOnce({ active: true, enabled: false });
    render(<InventoryRoute />);
    expect(await screen.findByTestId('command')).toBeTruthy();
    expect(checkFeatureFlag).toHaveBeenCalledTimes(2);
  });

  it('never draws the command page on the way to InventoryNext', async () => {
    checkFeatureFlag.mockResolvedValue({ active: true, enabled: true });
    const seen: string[] = [];
    const { container } = render(<InventoryRoute />);
    if (container.querySelector('[data-testid="command"]')) seen.push('command');
    const observer = new MutationObserver(() => {
      if (container.querySelector('[data-testid="command"]')) seen.push('command');
    });
    observer.observe(container, { childList: true, subtree: true });
    expect(await screen.findByTestId('next')).toBeTruthy();
    observer.disconnect();
    expect(seen).toEqual([]);
    expect(screen.queryByTestId('command')).toBeNull();
  });

  it('keeps the command page, without waiting, where no house is chosen', () => {
    window.localStorage.removeItem('activeRestaurantId');
    render(<InventoryRoute />);
    expect(screen.getByTestId('command')).toBeTruthy();
    expect(checkFeatureFlag).not.toHaveBeenCalled();
  });
});
