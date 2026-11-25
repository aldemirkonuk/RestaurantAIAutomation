/**
 * The Menu page holds room for "Menus kept" and "Locked prices" until their
 * reads answer, so the sections below do not jump (perf p1-6: CLS 0.152 at 375).
 * Static room only: a min-height on the loading line, no motion.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuVersions } from './MenuVersions';
import { LockedPrices } from './LockedPrices';

vi.mock('../../../services/api/menus', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/menus')>(
    '../../../services/api/menus',
  );
  return { ...actual, listMenuVersions: vi.fn(() => new Promise(() => {})) };
});
vi.mock('../../../services/api/pricing', async () => {
  const actual = await vi.importActual<typeof import('../../../services/api/pricing')>(
    '../../../services/api/pricing',
  );
  return { ...actual, listPriceLocks: vi.fn(() => new Promise(() => {})) };
});

function mount(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

describe('room is held while the reads are pending', () => {
  it('Menus kept holds at least 80 px for its settled block', () => {
    mount(<MenuVersions canManage />);
    const loading = screen.getByTestId('menu-versions-loading');
    expect(parseInt(loading.style.minHeight, 10)).toBeGreaterThanOrEqual(80);
  });

  it('Locked prices holds at least 40 px for its settled block', () => {
    mount(<LockedPrices canManage />);
    const loading = screen.getByTestId('locked-prices-loading');
    expect(parseInt(loading.style.minHeight, 10)).toBeGreaterThanOrEqual(40);
  });
});
