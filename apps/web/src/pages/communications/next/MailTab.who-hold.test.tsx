/**
 * The Who is writing strip keeps its place (r109 mail-6, from the r108 walk). At 1440 the strip's code hold drew
 * 120 px and then collapsed to the 32 px line it really is, and the strip itself arrived into nothing, moving
 * whatever sits below Mail (CLS 0.0121 with an empty search). A wide page now keeps 32 px from the first frame
 * and holds 32 px while the code loads; a phone keeps its measured 120 px hold and nothing before it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { CODE_HOLD_STRIP_PX, CODE_HOLD_STRIP_WIDE_PX, whoHoldPx, whoSlotPx } from './mail-code';

const wide = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('min-width: 1024px'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
};

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?tab=mail']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} whoIsWriting={<p data-testid="who-child">Who is writing</p>} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation(() => new Promise(() => {}));
});
afterEach(cleanup);

describe('the Who is writing strip keeps its place', () => {
  it('a wide page holds 32 px from the first frame, before the strip is asked for', () => {
    wide(true);
    mount();
    const slot = screen.getByTestId('who-is-writing-slot');
    expect(slot).toHaveStyle({ minHeight: '32px' });
    expect(screen.queryByTestId('who-child')).toBeNull();
  });

  it('a phone keeps nothing before the strip: it is the last thing in the flow', () => {
    wide(false);
    mount();
    expect(screen.getByTestId('who-is-writing-slot')).toHaveStyle({ minHeight: '0px' });
  });

  it('the code hold is the strip\'s real height at each width', () => {
    wide(true);
    expect([whoSlotPx(), whoHoldPx()]).toEqual([CODE_HOLD_STRIP_WIDE_PX, CODE_HOLD_STRIP_WIDE_PX]);
    wide(false);
    expect([whoSlotPx(), whoHoldPx()]).toEqual([0, CODE_HOLD_STRIP_PX]);
  });
});
