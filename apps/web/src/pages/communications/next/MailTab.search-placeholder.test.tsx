/**
 * The search box names what it can find. A house that reads every conversation
 * finds a person by the name the row shows (r105 mail-4 search by name), so
 * its hint says "someone by name"; a vendor-only house keeps "vendor".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';

const SUMMARY = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: false, address: null },
};
let grants: Array<Record<string, unknown>>;

beforeEach(() => {
  grants = [];
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/summary') return { data: SUMMARY };
    if (url === '/communications/letters/sender')
      return { data: { address: null, words: null, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } } };
    if (url === '/integrations/oauth/house-grants') return { data: { success: true, grants, unattributed: 0 } };
    if (url === '/integrations/oauth/catalog') return { data: { success: true, integrations: [{ id: 'gmail_read_all', available: true }] } };
    if (url === '/mail/people') return { data: { people: [], next: null, storedKinds: ['vendor'] } };
    throw new Error(`unexpected GET ${url}`);
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?tab=mail']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('the Mail search hint', () => {
  it('a vendor-only house is told it finds a vendor', async () => {
    mount();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/integrations/oauth/house-grants'));
    expect(screen.getByTestId('mail-search')).toHaveAttribute('placeholder', 'Find a vendor, subject, order number or word');
  });

  it('a house that reads every conversation is told it finds someone by name', async () => {
    grants = [{ connectionId: 'c1', integrationId: 'gmail_read_all', houseAccess: { revoked: false } }];
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('mail-search')).toHaveAttribute(
        'placeholder',
        'Find someone by name, address, subject, order number or word',
      ),
    );
  });
});
