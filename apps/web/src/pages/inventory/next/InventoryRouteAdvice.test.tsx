/**
 * /pricing/advice is read once on /inventory (perf p7 s3). Both pages key the
 * read ['pricing-advice', rid], and the app's QueryClient refetches on every
 * mount ('always'), so a page drawn on the way to the other one would make a
 * second 171 KB read. The route draws neither until the house flag is known
 * (#2187), so a house with the flag on reads the advice exactly once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

const checkFeatureFlag = vi.fn();
const getPriceAdvice = vi.fn();
vi.mock('../../../services/api/settings', () => ({
  settingsApi: { checkFeatureFlag: (...a: unknown[]) => checkFeatureFlag(...a) },
}));
vi.mock('../../../services/api/pricing', () => ({
  getPriceAdvice: (...a: unknown[]) => getPriceAdvice(...a),
}));

// Each page reads the advice the way the real one does: same key, same fn,
// same staleTime (InventoryCommandPage.tsx:203, useInventoryNextData.ts:638).
async function advice() {
  const { getPriceAdvice: read } = await import('../../../services/api/pricing');
  return read();
}
function useAdvice() {
  return useQuery({ queryKey: ['pricing-advice', 'r1'], queryFn: advice, staleTime: 30_000, retry: 1 });
}
vi.mock('./InventoryNext', () => ({
  default: () => {
    useAdvice();
    return <main data-testid="next" />;
  },
}));
vi.mock('../command/InventoryCommandPage', () => ({
  InventoryCommandPage: () => {
    useAdvice();
    return <main data-testid="command" />;
  },
}));

import { InventoryRoute } from './InventoryRoute';
import { clearMudavymDesignCache } from '../../../lib/mudavym/useMudavymDesign';

function app() {
  // The App.tsx defaults that make a second observer refetch.
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: 5_000, refetchOnMount: 'always', retry: 1 } },
  });
  return (
    <QueryClientProvider client={client}>
      <InventoryRoute />
    </QueryClientProvider>
  );
}

describe('InventoryRoute advice read', () => {
  beforeEach(() => {
    clearMudavymDesignCache();
    checkFeatureFlag.mockReset();
    getPriceAdvice.mockReset();
    getPriceAdvice.mockResolvedValue({ wines: [], target: { set: true } });
    window.localStorage.clear();
    window.localStorage.setItem('activeRestaurantId', 'r1');
  });

  it('reads /pricing/advice once for a house with InventoryNext on', async () => {
    checkFeatureFlag.mockResolvedValue({ active: true, enabled: true });
    render(app());
    expect(await screen.findByTestId('next')).toBeTruthy();
    await vi.waitFor(() => expect(getPriceAdvice).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(getPriceAdvice).toHaveBeenCalledTimes(1);
  });

  it('reads /pricing/advice once for a house on the command page', async () => {
    checkFeatureFlag.mockResolvedValue({ active: true, enabled: false });
    render(app());
    expect(await screen.findByTestId('command')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(getPriceAdvice).toHaveBeenCalledTimes(1);
  });
});
