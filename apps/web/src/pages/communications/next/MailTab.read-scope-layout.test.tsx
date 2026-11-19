/**
 * The read-scope line holds its place while the house's grants are read, the
 * chips and the consent button are finger-sized on a phone, and a house that
 * agreed to the wide reading is told the inbox switch must also be on (r77 w3
 * findings 2-4).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const Here = () => {
  const l = useLocation();
  return <span data-testid="here">{l.pathname + l.search}</span>;
};

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));

const auth = vi.hoisted(() => ({
  current: { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' } as Record<string, unknown>,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { READS_ALL_SWITCH_OFF_WORDS } from './mail-format';

const SUMMARY = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: false, address: null },
};
const LIVE = [{ connectionId: 'c1', integrationId: 'gmail_read_all', houseAccess: { revoked: false } }];

let reader: Record<string, unknown>;
let grantsAnswer: () => Promise<unknown>;

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?tab=mail']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
        <Here />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.current = { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' };
  reader = { granted: true, enabled: true, lastReadAt: null, lastError: null };
  grantsAnswer = async () => ({ data: { success: true, grants: [], unattributed: 0 } });
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/summary') return { data: SUMMARY };
    if (url === '/communications/letters/sender') return { data: { address: null, words: null, reader } };
    if (url === '/integrations/oauth/house-grants') return grantsAnswer();
    if (url === '/integrations/oauth/catalog')
      return { data: { success: true, integrations: [{ id: 'gmail_read_all', available: true }] } };
    if (url === '/mail/people') return { data: { people: [], next: null, storedKinds: ['vendor'] } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('the read-scope line holds its place (finding 2)', () => {
  it('an owner sees a reserved-height placeholder, 39 px narrow and 20 px wide, until the grants answer', async () => {
    let answer: (v: unknown) => void = () => {};
    grantsAnswer = () => new Promise((r) => (answer = r));
    mount();
    const hold = await screen.findByTestId('read-scope-pending');
    expect(hold).toHaveAttribute('aria-hidden', 'true');
    expect(hold.className).toContain('min-h-[39px]');
    expect(hold.className).toContain('md:min-h-[20px]');
    expect(screen.queryByTestId('read-scope')).toBeNull();
    answer({ data: { success: true, grants: [], unattributed: 0 } });
    await screen.findByTestId('read-scope');
    expect(screen.queryByTestId('read-scope-pending')).toBeNull();
  });

  it('staff, whose grants are never asked for, get the line at once and no placeholder', async () => {
    auth.current = { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
    mount();
    expect(await screen.findByTestId('read-scope')).toHaveTextContent('vendor mail only');
    expect(screen.queryByTestId('read-scope-pending')).toBeNull();
  });
});

describe('finger-sized targets on a phone (finding 3)', () => {
  it('every kind chip and the show chips are at least 44 px tall under the md width', async () => {
    mount();
    await screen.findByTestId('read-scope');
    const chips = screen.getByTestId('kind-filter').querySelectorAll('button');
    expect(chips.length).toBeGreaterThan(0);
    for (const c of Array.from(chips)) expect(c.className).toContain('max-md:min-h-[44px]');
    for (const name of ['All']) expect(screen.getAllByRole('button', { name })[0].className).toContain('max-md:min-h-[44px]');
  });

  it('"Review and agree" is at least 44 px tall under the md width', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('read-all-offer'));
    expect(screen.getByTestId('read-all-accept').className).toContain('max-md:min-h-[44px]');
  });
});

describe('the wide reading and the house inbox switch (finding 4)', () => {
  it('agreed but the switch is off: the line says the switch must also be on and opens it for an owner', async () => {
    grantsAnswer = async () => ({ data: { success: true, grants: LIVE, unattributed: 0 } });
    reader = { granted: true, enabled: false, lastReadAt: null, lastError: null };
    mount();
    const note = await screen.findByTestId('read-scope-switch-off');
    expect(note).toHaveTextContent(READS_ALL_SWITCH_OFF_WORDS);
    expect(note).toHaveTextContent('must also be on');
    fireEvent.click(screen.getByTestId('read-scope-open-switch'));
    expect(screen.getByTestId('here')).toHaveTextContent('/settings?tab=features');
  });

  it('staff never read the grants, so they are told nothing about the wide reading and no switch note', async () => {
    auth.current = { user: { role: 'staff', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'staff' };
    reader = { granted: true, enabled: false, lastReadAt: null, lastError: null };
    mount();
    await screen.findByTestId('read-scope');
    expect(screen.queryByTestId('read-scope-switch-off')).toBeNull();
  });

  it('agreed and the switch on: no switch note', async () => {
    grantsAnswer = async () => ({ data: { success: true, grants: LIVE, unattributed: 0 } });
    mount();
    await waitFor(() => expect(screen.getByTestId('read-scope').getAttribute('data-state')).toBe('all'));
    expect(screen.queryByTestId('read-scope-switch-off')).toBeNull();
  });

  it('not agreed and the switch off: no switch note (the setup line already says it)', async () => {
    reader = { granted: true, enabled: false, lastReadAt: null, lastError: null };
    mount();
    await waitFor(() => expect(screen.getByTestId('read-scope').getAttribute('data-state')).toBe('vendors'));
    expect(screen.queryByTestId('read-scope-switch-off')).toBeNull();
  });
});
