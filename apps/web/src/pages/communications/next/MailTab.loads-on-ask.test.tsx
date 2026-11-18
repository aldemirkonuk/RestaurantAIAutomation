/**
 * The mail setup page and the intake sheet are read from their own files only
 * when first asked for, not with the Mail list (r56 mail).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'manager', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'manager' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

const loaded = vi.hoisted(() => ({ setup: 0, sheet: 0 }));
vi.mock('./MailSetup', () => {
  loaded.setup += 1;
  return { MailSetup: () => <p data-testid="fake-setup">setup page</p> };
});
vi.mock('./IntakeHealthSheet', () => {
  loaded.sheet += 1;
  return { IntakeHealthSheet: ({ open }: { open: boolean }) => (open ? <p data-testid="fake-sheet">intake</p> : null) };
});

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

function mount(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[url]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/people') return { data: { people: [], next: null, storedKinds: ['vendor'] } };
    if (url === '/mail/summary') return { data: SUMMARY };
    if (url === '/communications/letters/sender') return { data: { address: null, words: null } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('the setup page and the intake sheet load when asked for', () => {
  it('the Mail list alone reads neither file', async () => {
    mount('/communications?tab=mail');
    await screen.findByTestId('people-empty');
    expect(loaded).toEqual({ setup: 0, sheet: 0 });
  });

  it('?setup=1 reads the setup page and shows it', async () => {
    mount('/communications?tab=mail&setup=1');
    expect(await screen.findByTestId('fake-setup')).toBeTruthy();
    expect(loaded.setup).toBe(1);
  });

  it('the status line opens the intake sheet, which is read then', async () => {
    mount('/communications?tab=mail');
    await screen.findByTestId('people-empty');
    expect(loaded.sheet).toBe(0);
    fireEvent.click(await screen.findByTestId('intake-line'));
    expect(await screen.findByTestId('fake-sheet')).toBeTruthy();
    expect(loaded.sheet).toBe(1);
  });
});
