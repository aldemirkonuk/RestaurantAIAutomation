/**
 * Rows that mount after the first wave (the table now draws a long book in
 * slices, PERF p5) must not each re-ask for the research list. App.tsx sets
 * refetchOnMount: 'always' for every query, so the hook has to opt back to
 * "only when stale" or one slice means one more read.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const inv = vi.hoisted(() => ({ research: vi.fn() }));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  fetchHouseItemResearch: inv.research,
}));

import { NameHint } from './NameThisWine';

describe('NameHint research read', () => {
  it('reads the research list once however many rows mount in later slices', async () => {
    inv.research.mockResolvedValue([]);
    // The same defaults the app sets in App.tsx.
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 5_000, refetchOnMount: 'always', retry: 1 } },
    });
    const Rows = ({ n }: { n: number }) => (
      <QueryClientProvider client={client}>
        {Array.from({ length: n }, (_, i) => (
          <NameHint key={i} inventoryId={`i${i}`} />
        ))}
      </QueryClientProvider>
    );
    const view = render(<Rows n={3} />);
    await waitFor(() => expect(inv.research).toHaveBeenCalledTimes(1));
    await act(async () => {});
    view.rerender(<Rows n={6} />);
    await act(async () => {});
    view.rerender(<Rows n={9} />);
    await act(async () => {});
    expect(inv.research).toHaveBeenCalledTimes(1);
  });
});
