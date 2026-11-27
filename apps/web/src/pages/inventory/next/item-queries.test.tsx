/**
 * The drawer's three reads honour the hover prefetch under the app's own
 * QueryClient defaults (App.tsx: refetchOnMount 'always', staleTime 5 s).
 * Without `refetchOnMount: true` on the three queries, opening the drawer
 * asked the same three reads again (r105 F3). A write still rereads them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { figuresQuery, nutritionQuery, usedInQuery } from './item-queries';

const api = vi.hoisted(() => ({ figures: vi.fn(), usedIn: vi.fn(), nutrition: vi.fn() }));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getItemFigures: api.figures,
  getItemUsedIn: api.usedIn,
  getItemNutrition: api.nutrition,
}));

// Mirrors App.tsx's QueryClient; the first test fails if App.tsx's defaults drift from this.
const appClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, refetchOnMount: 'always', retry: 1, throwOnError: false } } });

function Drawer() {
  useQuery(figuresQuery('r1', 'a'));
  useQuery(nutritionQuery('r1', 'a'));
  useQuery(usedInQuery('r1', 'a'));
  return null;
}

const counts = () => [api.figures.mock.calls.length, api.nutrition.mock.calls.length, api.usedIn.mock.calls.length];

afterEach(cleanup);

describe('drawer reads under the app QueryClient defaults', () => {
  it('the app defaults are the ones this file mirrors', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toContain("refetchOnMount: 'always'");
    expect(app).toContain('staleTime: 5_000');
  });

  it('a hover prefetch then opening the drawer fires no extra reads', async () => {
    api.figures.mockReset().mockResolvedValue({});
    api.nutrition.mockReset().mockResolvedValue({});
    api.usedIn.mockReset().mockResolvedValue({});
    const qc = appClient();
    await Promise.all([qc.prefetchQuery(figuresQuery('r1', 'a')), qc.prefetchQuery(nutritionQuery('r1', 'a')), qc.prefetchQuery(usedInQuery('r1', 'a'))]);
    expect(counts()).toEqual([1, 1, 1]);
    // The hover's reads are 6 s old: past the app's 5 s default, inside the queries' own 30/60 s.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6_000);
    render(<QueryClientProvider client={qc}><Drawer /></QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 20));
    vi.useRealTimers();
    expect(counts()).toEqual([1, 1, 1]);
  });

  it('a count or write-off, which invalidates the inventory prefix, rereads them', async () => {
    api.figures.mockReset().mockResolvedValue({});
    api.nutrition.mockReset().mockResolvedValue({});
    api.usedIn.mockReset().mockResolvedValue({});
    const qc = appClient();
    render(<QueryClientProvider client={qc}><Drawer /></QueryClientProvider>);
    await waitFor(() => expect(counts()).toEqual([1, 1, 1]));
    await qc.invalidateQueries({ queryKey: ['inventory'] });
    await waitFor(() => expect(counts()).toEqual([2, 2, 2]));
  });
});
