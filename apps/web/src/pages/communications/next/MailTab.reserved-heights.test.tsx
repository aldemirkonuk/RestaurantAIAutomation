/**
 * First paint equals the loaded layout (r81 walk w1, finding 3). The status
 * block above the Mail list grew 97 -> 152 px at 375 as the summary arrived
 * and pushed the list down (CLS 0.056-0.089), and the read-scope placeholder
 * was sized for one block while a house that agreed to the wide reading with
 * its inbox switch off draws two. The heights are reserved from the first
 * frame and pinned here; the pixel values are the walk's 152 px for the
 * narrow header and estimates elsewhere until a browser measures them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
const auth = vi.hoisted(() => ({
  current: { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' } as Record<string, unknown>,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab } from './MailTab';
import { MAIL_HEADER_RESERVE, READ_SCOPE_HOLD } from './mail-format';

const SUMMARY = {
  waitingPeople: 0,
  oldestWaitAt: null,
  inToday: 0,
  outToday: 0,
  heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: false, address: null },
};
let summaryAnswer: () => Promise<unknown>;
let reader: Record<string, unknown>;

function mount(path = '/communications?tab=mail') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.current = { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' };
  reader = { granted: true, enabled: true, lastReadAt: null, lastError: null };
  summaryAnswer = async () => ({ data: SUMMARY });
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/mail/summary') return summaryAnswer();
    if (url === '/communications/letters/sender') return { data: { address: null, words: null, reader } };
    if (url === '/integrations/oauth/house-grants') return new Promise(() => {});
    if (url === '/integrations/oauth/catalog') return { data: { success: true, integrations: [] } };
    if (url === '/mail/people') return { data: { people: [], next: null, storedKinds: ['vendor'] } };
    throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
  });
});

describe('the reserved heights are pinned', () => {
  it('names the header block and the two read-scope holds', () => {
    expect(MAIL_HEADER_RESERVE).toBe('min-h-[152px] md:min-h-[100px]');
    expect(READ_SCOPE_HOLD).toEqual({
      one: 'min-h-[38px] md:min-h-[20px]',
      two: 'min-h-[124px] md:min-h-[44px]',
    });
  });
});

describe('the status block holds its height from the first frame', () => {
  it('carries the reserve while the summary is pending and after it has arrived', async () => {
    let answer: (v: unknown) => void = () => {};
    summaryAnswer = () => new Promise((r) => (answer = r));
    mount();
    const block = await screen.findByTestId('mail-header-block');
    expect(block.className).toContain(MAIL_HEADER_RESERVE);
    expect(screen.getByTestId('mail-header')).toHaveTextContent('Reading who is waiting');
    answer({ data: SUMMARY });
    await screen.findByText(/No one is waiting|No vendor letter/);
    expect(screen.getByTestId('mail-header-block').className).toContain(MAIL_HEADER_RESERVE);
  });

  it('is the same block when the summary read fails', async () => {
    summaryAnswer = async () => {
      throw new Error('Network Error');
    };
    mount();
    await vi.waitFor(() => expect(screen.getByTestId('mail-header')).toHaveTextContent('could not be read'));
    expect(screen.getByTestId('mail-header-block').className).toContain(MAIL_HEADER_RESERVE);
  });
});

describe('the read-scope placeholder is sized for the state it will become', () => {
  it('one block while the inbox switch is on', async () => {
    mount();
    const hold = await screen.findByTestId('read-scope-pending');
    expect(hold.className).toContain(READ_SCOPE_HOLD.one);
    expect(hold.className).not.toContain(READ_SCOPE_HOLD.two);
  });

  it('two blocks (line + switch note) once the inbox door is known to be switched off', async () => {
    reader = { granted: true, enabled: false, lastReadAt: null, lastError: null };
    mount();
    const hold = await screen.findByTestId('read-scope-pending');
    await vi.waitFor(() => expect(screen.getByTestId('read-scope-pending').className).toContain(READ_SCOPE_HOLD.two));
    expect(hold).toBeTruthy();
  });
});
