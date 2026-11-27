/**
 * First paint equals the loaded layout (r81 walk w1, finding 3). The status
 * block above the Mail list grew 97 -> 152 px at 375 as the summary arrived
 * and pushed the list down (CLS 0.056-0.089), and the read-scope placeholder
 * was sized for one block while a house that agreed to the wide reading with
 * its inbox switch off draws two. The heights are reserved from the first
 * frame and pinned here; the pixel values were measured in a browser (r83 walk w1):
 * the header loads at 155 px (375) and 111 px (1440), the read-scope blocks at 38.4/19.7 (one) and 126/45 (two).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn(), put: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
const auth = vi.hoisted(() => ({
  current: { user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' } as Record<string, unknown>,
}));
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => auth.current }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailTab, readLastHeaderHeight, rememberHeaderHeight } from './MailTab';
import { MAIL_HEADER_RESERVE, MAIL_HEADER_RESERVE_HELD, MAIL_HEADLINE_HOLD, READ_SCOPE_HOLD } from './mail-format';

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
    expect(MAIL_HEADER_RESERVE).toBe('min-h-[176px] md:min-h-[112px]');
    expect(READ_SCOPE_HOLD).toEqual({
      one: 'min-h-[39px] md:min-h-[20px]',
      two: 'min-h-[127px] md:min-h-[46px]',
    });
  });
});

describe('the header holds the height it settled at (r108 mail-r108-6)', () => {
  it('reserves 176 px below md for the three-line time-zone sentence, and the headline holds two lines', async () => {
    expect(MAIL_HEADER_RESERVE).toContain('min-h-[176px]');
    expect(MAIL_HEADLINE_HOLD).toBe('min-h-[45px] md:min-h-0');
    mount();
    expect((await screen.findByTestId('mail-header')).className).toContain(MAIL_HEADLINE_HOLD);
  });

  it('remembers the settled content height per house and starts the next load there', async () => {
    window.sessionStorage.clear();
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const t = this.getAttribute('data-testid');
      return { top: 100, bottom: t === 'mail-header-block' ? 100 : 262.2, height: 0, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    try {
      mount();
      await vi.waitFor(() => expect(readLastHeaderHeight('r1')).toBe(163));
      expect(screen.getByTestId('mail-header-block').style.getPropertyValue('--mail-held')).toBe('');
      cleanup();
      mount();
      const held = await screen.findByTestId('mail-header-block');
      expect(held.style.getPropertyValue('--mail-held')).toBe('163px');
      // A floor on top of the reserve, never an inline height that replaces it: a short visit's
      // 163 px must not let the next load reserve less than the 176 px a wrapped sentence needs.
      expect(held.style.minHeight).toBe('');
      expect(held.className).toContain(MAIL_HEADER_RESERVE_HELD);
      expect(held.className).not.toContain(MAIL_HEADER_RESERVE);
    } finally {
      rect.mockRestore();
      window.sessionStorage.clear();
    }
  });

  it('holds the reserve at both widths, with the remembered height only as a floor over it', () => {
    expect(MAIL_HEADER_RESERVE_HELD).toBe('min-h-[max(176px,var(--mail-held,0px))] md:min-h-[max(112px,var(--mail-held,0px))]');
  });

  it('keeps nothing when the height is nonsense', () => {
    rememberHeaderHeight('r1', 0);
    rememberHeaderHeight('', 150);
    expect(readLastHeaderHeight('r1')).toBeNull();
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
