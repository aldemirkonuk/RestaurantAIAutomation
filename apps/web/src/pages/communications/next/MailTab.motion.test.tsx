/** The Mail tab's quiet motion (r102 mail-motion-3/4/5): opacity steps only; reduced motion draws the end state. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));

import { MailArrival } from './MailArrival';
import { MailTab } from './MailTab';
import { FadeAway, MAIL_MOTION_CSS, useEnteringKeys } from './mail-motion';
import type { MailSetupView, MailTestLetter } from './useMailSetup';

const SUMMARY = {
  waitingPeople: 0, oldestWaitAt: null, inToday: 0, outToday: 0, heldAtDoor: null,
  doors: { houseMailbox: { lastStoredAt: null }, whatsapp: { lastStoredAt: null }, mudavymMail: { lastStoredAt: null } },
  address: { configured: true, address: 'bodega@in.mudavym.com' },
};
const person = (n: number, over: Record<string, unknown> = {}) => ({
  key: `vendor:p${n}`,
  kind: 'vendor',
  name: `Vendor ${n}`,
  lastLine: `Line ${n}`,
  lastAt: '2026-11-06T09:00:00Z',
  lastDirection: 'inbound',
  waiting: true,
  channels: ['email'],
  openThreads: 2,
  newestOpenOrderNumber: 'PO-7',
  newToYou: true,
  unsentStatus: 'queued',
  ...over,
});
const many = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => person(from + i, { waiting: false }));

function mountTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/communications?tab=mail']}>
      <QueryClientProvider client={qc}>
        <MailTab draftedOrderIds={new Set<string>()} onOpenReply={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const notFound = (): never => {
  throw Object.assign(new Error('Not Found'), { response: { status: 404 } });
};

function reduced(on: boolean) {
  window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

beforeEach(() => {
  api.get.mockReset();
  reduced(false);
});
afterEach(() => vi.useRealTimers());

describe('the people list', () => {
  it('"Show older people" fades only the appended rows in, a step apiece, batched after six; the rows already there stay still', async () => {
    api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => ({
      data:
        url === '/mail/summary'
          ? SUMMARY
          : url === '/mail/people'
            ? cfg?.params?.after === 'C2'
              ? { people: many(3, 10), next: null, storedKinds: ['vendor'] }
              : { people: many(1, 2), next: 'C2', storedKinds: ['vendor'] }
            : notFound(),
    }));
    mountTab();
    const first = await screen.findAllByTestId('mail-person');
    expect(first).toHaveLength(2);
    expect(document.querySelectorAll('[data-entering]')).toHaveLength(0);
    const older = screen.getByRole('button', { name: 'Show older people' });
    fireEvent.click(older);
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(10));
    await waitFor(() => expect(document.querySelectorAll('[data-entering]')).toHaveLength(8));
    const entering = Array.from(document.querySelectorAll<HTMLElement>('[data-entering]'));
    expect(entering.every((li) => li.className.includes('mail-fade-in'))).toBe(true);
    expect(entering.map((li) => li.style.animationDelay)).toEqual(['0ms', '24ms', '48ms', '72ms', '96ms', '120ms', '144ms', '144ms']);
    expect(first.every((b) => !b.closest('li')!.hasAttribute('data-entering'))).toBe(true);
  });

  it('a new search is a different list: it crossfades in whole, and no row is marked as appended', async () => {
    api.get.mockImplementation(async (url: string, cfg?: { params?: Record<string, string> }) => ({
      data:
        url === '/mail/summary'
          ? SUMMARY
          : url === '/mail/people'
            ? { people: cfg?.params?.q ? [person(7, { waiting: false })] : many(1, 2), next: null, storedKinds: ['vendor'] }
            : notFound(),
    }));
    mountTab();
    await screen.findAllByTestId('mail-person');
    const before = screen.getAllByTestId('mail-person')[0].closest('ul')!;
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search mail' }), { target: { value: 'fish' } });
    await waitFor(() => expect(screen.getAllByTestId('mail-person')).toHaveLength(1));
    const after = screen.getByTestId('mail-person').closest('ul')!;
    expect(after).not.toBe(before);
    expect(after.className).toContain('mail-fade-in');
    expect(document.querySelectorAll('[data-entering]')).toHaveLength(0);
  });
});

describe('rows that entered stop being marked as entering', () => {
  it('the mark is gone once the fade has run, so a reorder that re-inserts a row cannot play it again', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ keys }) => useEnteringKeys(keys, 'all', true), {
      initialProps: { keys: ['a', 'b'] },
    });
    expect(result.current.size).toBe(0);
    rerender({ keys: ['a', 'b', 'c', 'd'] });
    expect(Array.from(result.current.keys())).toEqual(['c', 'd']);
    act(() => void vi.advanceTimersByTime(6 * 24 + 160 + 1));
    expect(result.current.size).toBe(0);
    // A person jumps to the top and every row after them is re-inserted: none is entering again.
    rerender({ keys: ['d', 'a', 'b', 'c'] });
    expect(result.current.size).toBe(0);
    // A row that really is new still enters.
    rerender({ keys: ['e', 'd', 'a', 'b', 'c'] });
    expect(Array.from(result.current.keys())).toEqual(['e']);
  });
});

describe('the quiet motion rules', () => {
  it('every motion is opacity or colour only, and reduced motion turns each off', () => {
    expect(MAIL_MOTION_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.mail-fade-in[\s\S]*\.mail-fade-out[\s\S]*\.mail-arrive[\s\S]*animation: none/);
    expect(MAIL_MOTION_CSS).not.toMatch(/translate|scale|width|height|margin|infinite/);
    expect(MAIL_MOTION_CSS).toMatch(/mail-arrive \{ animation: mail-fade-in 320ms[^;]*mail-ink-step 160ms/);
  });

  it('a chip that goes away fades for one ink step, then gives its space up; reduced motion removes it at once', () => {
    vi.useFakeTimers();
    const chip = (show: boolean) => (
      <FadeAway show={show}>
        <span data-testid="chip">New</span>
      </FadeAway>
    );
    const { rerender } = render(chip(true));
    rerender(chip(false));
    const fading = screen.getByTestId('fading-away');
    expect(fading.className).toBe('mail-fade-out');
    act(() => void vi.advanceTimersByTime(159));
    expect(screen.queryByTestId('fading-away')).not.toBeNull();
    act(() => void vi.advanceTimersByTime(2));
    expect(screen.queryByTestId('chip')).toBeNull();

    reduced(true);
    rerender(chip(true));
    rerender(chip(false));
    expect(screen.queryByTestId('chip')).toBeNull();
  });
});

describe('the test letter arrives', () => {
  const LETTER = (over: Partial<MailTestLetter> = {}): MailTestLetter => ({
    code: 'K7QM-2RZD',
    subject: 'Mudavym test letter K7QM-2RZD',
    address: 'r-1a2b3c4d@in.example.test',
    mailto: 'mailto:r-1a2b3c4d@in.example.test',
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    arrivedAt: null,
    arrivedFrom: null,
    ...over,
  });
  const view = (latest: MailTestLetter): MailSetupView =>
    ({
      canChange: true,
      senders: { failed: null, chosenConnectionId: null, choices: [] },
      arrival: { domainReady: true, address: 'r-1a2b3c4d@in.example.test', failed: null },
      testLetter: { failed: null, latest },
    }) as MailSetupView;
  const tree = (v: MailSetupView) => (
    <QueryClientProvider client={new QueryClient()}>
      <MailArrival view={v} now={Date.now()} />
    </QueryClientProvider>
  );

  it('settles in when "Not arrived yet" turns to "Arrived", and not on a page that already says arrived', () => {
    const { rerender } = render(tree(view(LETTER())));
    expect(screen.getByTestId('setup-test-state').className).toBe('');
    rerender(tree(view(LETTER({ arrivedAt: new Date().toISOString(), arrivedFrom: 'a@b.test' }))));
    const arrived = screen.getByTestId('setup-test-state');
    expect(arrived.getAttribute('data-state')).toBe('arrived');
    expect(arrived.className).toBe('mail-arrive');

    document.body.innerHTML = '';
    render(tree(view(LETTER({ arrivedAt: new Date().toISOString() }))));
    expect(screen.getByTestId('setup-test-state').getAttribute('data-state')).toBe('arrived');
    expect(screen.getByTestId('setup-test-state').className).toBe('');
  });
});
