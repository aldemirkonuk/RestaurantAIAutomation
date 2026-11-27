/**
 * 'Check now' and the read cadence on the mailbox door (DD-r106-9 /
 * DD-r108-47). The sheet, the hook and the query client are real; only the
 * gateway is stubbed. The once-a-minute floor and the staff refusal are the
 * server's (house-inbox-read-now.spec.ts, house-letters-read-now-roles.spec.ts);
 * here the page says the cadence, offers the button only to whom it serves,
 * and says the server's answer, a refusal inside the minute included.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 'u1', restaurantId: 'rest-A', role: 'owner' }, activeRestaurantId: 'rest-A' }),
}));

import { IntakeHealthSheet } from './IntakeHealthSheet';
import type { MailboxReader } from './mail-format';

const READING: MailboxReader = {
  granted: true,
  enabled: true,
  lastReadAt: new Date(Date.now() - 120_000).toISOString(),
  lastError: null,
  bookAddresses: 3,
};

function draw(opts: { canCheck: boolean; reader?: MailboxReader }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IntakeHealthSheet
          open
          onClose={() => {}}
          summary={null}
          summaryFailed={false}
          reader={opts.reader ?? READING}
          readerFailed={false}
          sender={null}
          senderFailed={false}
          conversationWords={null}
          intake={{ kind: 'absent' }}
          now={Date.now()}
          canCheck={opts.canCheck}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: {} });
  api.post.mockReset();
});

describe('the mailbox door says how often it is read', () => {
  it('says every 5 minutes, and offers Check now to an owner or manager', async () => {
    api.post.mockResolvedValue({ data: { outcome: 'read', mirrored: 2, says: 'Checked. 2 new letters were filed.' } });
    draw({ canCheck: true });
    expect(screen.getByTestId('read-cadence')).toHaveTextContent('Read every 5 minutes.');
    fireEvent.click(screen.getByTestId('check-now'));
    expect(await screen.findByTestId('check-now-result')).toHaveTextContent('Checked. 2 new letters were filed.');
    expect(api.post).toHaveBeenCalledWith('/communications/letters/reader/check');
  });

  it('keeps the 44 px touch floor on a phone, as the Mail tab\'s own buttons do', () => {
    draw({ canCheck: true });
    expect(screen.getByTestId('check-now').className).toContain('max-md:min-h-[44px]');
  });

  it('offers no button to staff, and still says the cadence', () => {
    draw({ canCheck: false });
    expect(screen.getByTestId('read-cadence')).toBeInTheDocument();
    expect(screen.queryByTestId('check-now')).toBeNull();
  });

  it('says the server’s wait when pressed inside the minute', async () => {
    api.post.mockRejectedValue({
      response: { status: 429, data: { message: 'The mailbox was read less than a minute ago. Check again in 42 s.' } },
    });
    draw({ canCheck: true });
    fireEvent.click(screen.getByTestId('check-now'));
    // The server's own sentence, not wrapped as a failed save: nothing failed.
    expect((await screen.findByTestId('check-now-result')).textContent).toBe(
      'The mailbox was read less than a minute ago. Check again in 42 s.',
    );
  });

  it('says nothing about a cadence when reading is switched off', () => {
    draw({ canCheck: true, reader: { ...READING, enabled: false } });
    expect(screen.queryByTestId('read-cadence')).toBeNull();
    expect(screen.queryByTestId('check-now')).toBeNull();
  });
});
