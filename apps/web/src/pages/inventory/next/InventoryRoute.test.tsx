/**
 * ADR 0315's 2026-10-30 amendment: `/inventory` draws InventoryNext only for a
 * house whose `mudavym_design_inventory_next` is ON. OFF, unread or failed —
 * the command page every house runs today.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '../../../contexts/AuthContext';

const getInventory = vi.fn();
vi.mock('../../../services/api', () => ({
  inventoryApi: { getInventory: (...a: unknown[]) => getInventory(...a) },
}));
vi.mock('../../../services/api/inventory', () => ({
  normalizeInventoryItem: (x: unknown) => x,
}));

let qc: QueryClient;
/** The route as the app mounts it: a query client, and the house the session names. */
function render(ui: ReactElement) {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { activeRestaurantId: window.localStorage.getItem('activeRestaurantId'), isAuthenticated: true } as never;
  return rtlRender(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={auth}>{ui}</AuthContext.Provider>
    </QueryClientProvider>,
  );
}

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
    getInventory.mockReset();
    getInventory.mockResolvedValue([]);
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

  it('keeps the command page when the flag read fails', async () => {
    checkFeatureFlag.mockRejectedValue(new Error('network'));
    render(<InventoryRoute />);
    expect(await screen.findByTestId('command')).toBeTruthy();
    expect(checkFeatureFlag).toHaveBeenCalled();
  });

  it('mounts neither page while the flag is still being read', () => {
    checkFeatureFlag.mockReturnValue(new Promise(() => {}));
    render(<InventoryRoute />);
    expect(screen.getByTestId('inventory-route-reading')).toBeTruthy();
    expect(screen.queryByTestId('command')).toBeNull();
    expect(screen.queryByTestId('next')).toBeNull();
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

  it('starts the inventory list read while the flag is still being read, once', async () => {
    checkFeatureFlag.mockReturnValue(new Promise(() => {}));
    render(<InventoryRoute />);
    await waitFor(() => expect(getInventory).toHaveBeenCalledWith('r1'));
    expect(getInventory).toHaveBeenCalledTimes(1);
  });

  it('draws InventoryNext at the first render from the last answer for this house, and corrects a stale one', async () => {
    window.sessionStorage.setItem('mudavym.flagSeed:r1:mudavym_design_inventory_next', '1');
    checkFeatureFlag.mockResolvedValue({ active: true, enabled: false });
    render(<InventoryRoute />);
    expect(screen.getByTestId('next')).toBeTruthy(); // no wait for the read
    expect(await screen.findByTestId('command')).toBeTruthy(); // the answer that landed wins
    expect(window.sessionStorage.getItem('mudavym.flagSeed:r1:mudavym_design_inventory_next')).toBe('0');
  });
});
