/**
 * WineRegister holds still while the book is read (walk p12, /wines CLS 0.70 at a
 * phone, 0.49 at a desk). Until the read answers, the table frame and the control
 * rail keep the room they settle at, the signature waits (data-settling), and the
 * live note is not mounted; none of it moves, so no transition (ADR 0112).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import WineRegister from './WineRegister';
import type { CellarData } from './useCellarNextData';

vi.mock('../../../hooks/queries/useInventoryQueries', () => ({
  useCreateInventoryItem: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/queries/useProviderQueries', () => ({
  useRecommendedProviders: () => ({ data: undefined, isError: false }),
}));

function mount(over: Record<string, unknown>) {
  const data = {
    activeRestaurantId: 'r1',
    authLoading: false,
    bottles: null,
    building: { titles: 0, bottles: 0, belowPar: 0, offBook: 0, parUnset: 0 },
    providers: [],
    bookTruncated: false,
    bookLimit: 500,
    loadingMoreBook: false,
    loadMoreBook: vi.fn(),
    booking: true,
    bookError: null,
    cellarKnown: false,
    cellarError: null,
    vendorsError: null,
    registers: null,
    registersLoading: false,
    registersError: null,
    live: { touched: {}, lastApplyMs: null },
    refetch: vi.fn(),
    ...over,
  } as unknown as CellarData;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <WineRegister data={data} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('/wines holds still while the book is read', () => {
  it('holds the table frame and the rail, marks the page settling, and mounts no live note', () => {
    const { container } = mount({ booking: true });
    expect(container.querySelector('.cl-book-hold')).toHaveTextContent('Opening the book…');
    expect(container.querySelector('.cl-row-controls')).toHaveAttribute('data-hold', 'true');
    expect(screen.getByTestId('wine-register')).toHaveAttribute('data-settling', 'true');
    expect(screen.queryByTestId('wine-live-note')).not.toBeInTheDocument();
  });

  it('lets go once the book has answered', () => {
    const { container } = mount({ booking: false, bottles: [] });
    expect(container.querySelector('.cl-book-hold')).toBeNull();
    expect(container.querySelector('.cl-row-controls')).not.toHaveAttribute('data-hold');
    expect(screen.getByTestId('wine-register')).not.toHaveAttribute('data-settling');
    expect(screen.getByTestId('wine-live-note')).toBeInTheDocument();
  });
});

describe('the held room, in the stylesheet', () => {
  const css = readFileSync(resolve(__dirname, 'cellar-next.css'), 'utf8');
  it('holds 185px for the rail and 249px / 484px for the frame, and moves nothing', () => {
    expect(css).toMatch(/\.cl-row-controls\[data-hold='true'\]\s*\{\s*min-height:\s*185px/);
    expect(css).toMatch(/max-width:\s*481px\)\s*\{[^}]*\{[^}]*\}\s*\.cl-book-hold\s*\{\s*min-height:\s*249px/);
    expect(css).toMatch(/min-width:\s*1001px\)\s*\{\s*\.cl-book-hold\s*\{\s*min-height:\s*484px/);
    expect(css.match(/\.cl-book-hold[^{]*\{[^}]*\}|\.cl-row-controls\[data-hold[^{]*\{[^}]*\}/g)?.join('')).not.toMatch(
      /transition|animation/,
    );
  });
});
