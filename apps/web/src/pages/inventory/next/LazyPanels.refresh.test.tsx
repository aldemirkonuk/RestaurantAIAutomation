/**
 * The /inventory panels and the command page load through lazyWithRefresh, as
 * every other lazy page does, and a command page that cannot load says so
 * instead of throwing to the app's error screen (r104 finding).
 */
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seam = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../../../lib/lazyWithRefresh', async () => {
  const { lazy } = await import('react');
  return {
    lazyWithRefresh: (factory: () => Promise<{ default: never }>) => {
      seam.calls += 1;
      return lazy(factory);
    },
  };
});
vi.mock('../command/InventoryCommandPage', () => ({
  get InventoryCommandPage(): never {
    throw new Error('chunk gone');
  },
}));
const checkFeatureFlag = vi.fn();
vi.mock('../../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: (...a: unknown[]) => checkFeatureFlag(...a) },
}));
vi.mock('./InventoryNext', () => ({ default: () => <main data-testid="next" /> }));

import './LazyPanels';
import { PAGE_LOAD_FAILED } from './LazyPanels';
import { InventoryRoute } from './InventoryRoute';
import { clearMudavymDesignCache } from '../../../lib/mudavym/useMudavymDesign';

beforeEach(() => {
  checkFeatureFlag.mockResolvedValue({ active: true, enabled: false });
  clearMudavymDesignCache();
  window.localStorage.setItem('activeRestaurantId', 'r1');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the lazy files go through the one refresh helper', () => {
  it('the seven panels and the command page are each built by lazyWithRefresh', () => {
    expect(seam.calls).toBe(8);
  });

  it('a command page that cannot load says so in words, and the page does not throw', async () => {
    render(<InventoryRoute />);
    expect((await screen.findByRole('alert')).textContent).toBe(PAGE_LOAD_FAILED);
  });
});
