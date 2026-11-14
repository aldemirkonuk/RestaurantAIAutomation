/**
 * r41 inventory audit gap 1: the command page (261 KB, 70 KB gz) is read only
 * for a house whose flag answers OFF, never on the way to InventoryNext.
 * Each test starts from a fresh module registry, so React.lazy has not read
 * the page yet and the mock's factory runs again when (and only when) it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  checkFeatureFlag: vi.fn(),
  commandRead: vi.fn(),
  gate: Promise.resolve() as Promise<void>,
}));
const { checkFeatureFlag, commandRead } = h;
vi.mock('../../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: (...a: unknown[]) => checkFeatureFlag(...a) },
}));
vi.mock('./InventoryNext', () => ({ default: () => <main data-testid="next" /> }));
vi.mock('../command/InventoryCommandPage', async () => {
  commandRead();
  await h.gate;
  return { InventoryCommandPage: () => <main data-testid="command" /> };
});

async function freshRoute() {
  vi.resetModules();
  const route = await import('./InventoryRoute');
  (await import('../../../lib/mudavym/useMudavymDesign')).clearMudavymDesignCache();
  return route.InventoryRoute;
}

describe('InventoryRoute reads the command page only when it draws it', () => {
  beforeEach(() => {
    checkFeatureFlag.mockReset();
    commandRead.mockReset();
    h.gate = Promise.resolve();
    window.localStorage.clear();
    window.localStorage.setItem('activeRestaurantId', 'r1');
  });
  afterEach(() => window.localStorage.clear());

  it('never reads the command page where InventoryNext is drawn', async () => {
    checkFeatureFlag.mockResolvedValue({ active: true, enabled: true });
    const InventoryRoute = await freshRoute();
    render(<InventoryRoute />);
    expect(await screen.findByTestId('next')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    expect(commandRead).not.toHaveBeenCalled();
  });

  it('says it is reading while the command page loads, then draws it', async () => {
    checkFeatureFlag.mockResolvedValue({ active: true, enabled: false });
    let release!: () => void;
    h.gate = new Promise<void>((r) => (release = r));
    const InventoryRoute = await freshRoute();
    render(<InventoryRoute />);
    expect(await screen.findByTestId('inventory-route-reading')).toBeTruthy();
    expect(screen.queryByTestId('command')).toBeNull();
    release();
    expect(await screen.findByTestId('command')).toBeTruthy();
    expect(commandRead).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('inventory-route-reading')).toBeNull();
  });
});
