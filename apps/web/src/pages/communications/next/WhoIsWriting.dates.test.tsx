/**
 * Who is writing says its dates the way the rest of Mail does (r41 mail gap
 * 8): the house's day, and the year once it is not this one. The zone is
 * UTC+14, which no test machine runs in, so a date read in the browser's own
 * zone lands a day early and fails; "1 Jun" with no year fails the year check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  senders: {} as Record<string, unknown>,
  strangers: {} as Record<string, unknown>,
  zone: null as string | null,
}));

vi.mock('./useSendersDeskData', () => ({
  SENDERS_SERVER_WINDOWS: { PROSPECTS: 100 },
  useSenderRegister: () => h.senders,
  useSetSenderTrust: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStrangers: () => h.strangers,
  usePromoteStranger: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePutAwayStranger: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRestoreStranger: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('./useMailData', () => ({ useHouseZone: () => h.zone }));
vi.mock('../../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../contexts/AuthContext')>()),
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    availableRestaurants: [{ id: 'r1', name: 'House', city: null, chain_id: null, chain_name: null }],
  }),
}));

import WhoIsWriting from './WhoIsWriting';

const AT = '2025-06-01T12:00:00Z';
const ok = (data: unknown) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T12:00:00Z'));
  h.zone = 'Pacific/Kiritimati';
  h.senders = ok([
    { id: 's1', domain: 'skurnik.com', provider_id: 'p1', trusted: false, suspended: false, suspended_reason: null, injection_signals: 0, spam_signals: 0, completed_orders: 1, score: 0, updated_at: AT },
  ]);
  h.strangers = ok([
    { id: 'x1', restaurant_id: 'r1', domain: 'tuscandirect.co', sender_email: 'sales@tuscandirect.co', sender_name: 'Tuscan Direct', subject: 'Prices', snippet: null, body_preview: null, capture_reason: 'attachment', has_attachments: false, attachments: [], message_count: 1, status: 'open', first_seen_at: AT, last_seen_at: AT },
  ]);
});
afterEach(() => vi.useRealTimers());

function mount() {
  render(
    <MemoryRouter initialEntries={['/communications?senders=open']}>
      <WhoIsWriting />
    </MemoryRouter>,
  );
}

describe("Who is writing's dates are the house's, and say their year", () => {
  it('a sender updated last year says the house day and the year', () => {
    mount();
    expect(screen.getByText(/not trusted · updated 2 Jun 2025/)).toBeInTheDocument();
  });

  it('a stranger last seen last year says the house day and the year', () => {
    mount();
    expect(screen.getByText(/<sales@tuscandirect\.co> · 2 Jun 2025/)).toBeInTheDocument();
  });

  it('with no house zone the year is still said', () => {
    h.zone = null;
    mount();
    expect(screen.getByText(/not trusted · updated \d{1,2} Jun 2025/)).toBeInTheDocument();
  });
});
