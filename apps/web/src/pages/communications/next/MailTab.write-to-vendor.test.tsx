/**
 * "Write to <vendor>" on a vendor's person page (r107 DD-r106-8): shown for a
 * vendor-kind person only, and only to an owner or a manager. A team member, a
 * guest, a vendor with no provider behind them and a staff reader get no such act.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn() }));
const auth = vi.hoisted(() => ({ role: 'owner' }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { role: auth.role, restaurantId: 'r1' },
    activeRestaurantId: 'r1',
    activeRole: auth.role,
  }),
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
let person: Record<string, unknown>;

beforeEach(() => {
  auth.role = 'owner';
  person = { key: 'vendor:p1', kind: 'vendor', providerId: 'p1', name: 'Fikri Tarim' };
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/summary') return { data: SUMMARY };
    if (url === '/communications/letters/sender')
      return { data: { address: null, words: null, reader: { granted: true, enabled: true, lastReadAt: null, lastError: null } } };
    if (url === '/integrations/oauth/house-grants') return { data: { success: true, grants: [], unattributed: 0 } };
    if (url === '/integrations/oauth/catalog') return { data: { success: true, integrations: [] } };
    if (url === '/mail/threads') return { data: { person, threads: [], next: null } };
    throw new Error(`unexpected GET ${url}`);
  });
});

function mount(onWriteTo = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?tab=mail&with=vendor:p1']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} onWriteTo={onWriteTo} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return onWriteTo;
}

const settled = () => waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument());

describe('Write to a vendor from its person page', () => {
  it.each(['owner', 'manager'])('is offered to %s, and opens the composer for that provider', async (role) => {
    auth.role = role;
    const onWriteTo = mount();
    await settled();
    fireEvent.click(await screen.findByTestId('mail-write-to'));
    expect(onWriteTo).toHaveBeenCalledWith('p1');
    expect(screen.getByTestId('mail-write-to')).toHaveTextContent('Write to Fikri Tarim');
  });

  it('is absent for staff', async () => {
    auth.role = 'staff';
    mount();
    await settled();
    expect(screen.queryByTestId('mail-write-to')).toBeNull();
  });

  it.each(['team', 'guest'])('is absent on a %s person, whoever reads', async (kind) => {
    person = { key: `${kind}:x@y.example`, kind, providerId: 'p1', name: 'Someone' };
    mount();
    await settled();
    expect(screen.queryByTestId('mail-write-to')).toBeNull();
  });

  it('is absent when no provider stands behind the vendor', async () => {
    person = { key: 'vendor:p1', kind: 'vendor', providerId: null, name: 'Fikri Tarim' };
    mount();
    await settled();
    expect(screen.queryByTestId('mail-write-to')).toBeNull();
  });
});
