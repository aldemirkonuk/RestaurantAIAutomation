/**
 * ADR 0315's 2026-10-30 amendment: `/inventory` draws InventoryNext only for a
 * house whose `mudavym_design_inventory_next` is ON. OFF, unread or failed —
 * the command page every house runs today.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
    await vi.waitFor(() => expect(checkFeatureFlag).toHaveBeenCalled());
    expect(screen.getByTestId('command')).toBeTruthy();
    expect(screen.queryByTestId('next')).toBeNull();
  });

  it('keeps the command page when the flag read fails', async () => {
    checkFeatureFlag.mockRejectedValue(new Error('network'));
    render(<InventoryRoute />);
    await vi.waitFor(() => expect(checkFeatureFlag).toHaveBeenCalled());
    expect(screen.getByTestId('command')).toBeTruthy();
  });

  it('draws the command page on the first render, before any read lands', () => {
    checkFeatureFlag.mockReturnValue(new Promise(() => {}));
    render(<InventoryRoute />);
    expect(screen.getByTestId('command')).toBeTruthy();
  });
});
