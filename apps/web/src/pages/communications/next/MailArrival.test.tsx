/**
 * "How mail arrives" on the mail setup page (founder /goal 2026-11-07),
 * rendered for real against a stubbed gateway through the page's own read.
 * Every write is a mocked POST: nothing here sends mail, and the test letter
 * is only ever a `mailto:` link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));

import { MailArrival } from './MailArrival';
import { useMailSetup, type MailSetupView, type MailTestLetter } from './useMailSetup';

const MINE = 'c1';
const CHEF = 'c2';
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const LETTER = (over: Partial<MailTestLetter> = {}): MailTestLetter => ({
  code: 'K7QM-2RZD',
  subject: 'Mudavym test letter K7QM-2RZD',
  address: 'r-1a2b3c4d@in.example.test',
  mailto: 'mailto:r-1a2b3c4d@in.example.test?subject=Mudavym%20test%20letter%20K7QM-2RZD&body=x',
  startedAt: ago(2 * 60_000),
  arrivedAt: null,
  arrivedFrom: null,
  ...over,
});

function view(over: Partial<MailSetupView> = {}): MailSetupView {
  return {
    canChange: true,
    senders: {
      failed: null,
      chosenConnectionId: null,
      choices: [
        { connectionId: MINE, address: 'me@house.test', personName: 'Deniz', mine: true, chosen: false, sending: true },
        { connectionId: CHEF, address: 'office@house.test', personName: 'Ayşe', mine: false, chosen: false, sending: false },
      ],
    },
    arrival: { domainReady: true, address: 'r-1a2b3c4d@in.example.test', failed: null },
    testLetter: { failed: null, latest: null },
    ...over,
  };
}


const fail = (status: number, message?: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: message ? { message } : {} },
  });

/** The page's own read, then the part under test, as MailSetup renders it. */
function Harness() {
  const q = useMailSetup();
  return q.data ? <MailArrival view={q.data} now={Date.now()} /> : null;
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Harness />
    </QueryClientProvider>,
  );
}

const answer = (v: MailSetupView) => api.get.mockResolvedValue({ data: v });

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('how mail arrives', () => {
  it('shows the address, copies it, and gives the forwarding steps in plain words', async () => {
    answer(view());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mount();
    const box = await screen.findByTestId('setup-address');
    expect(box.getAttribute('data-state')).toBe('ready');
    expect(within(box).getByText('r-1a2b3c4d@in.example.test')).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'Copy' }));
    expect((await screen.findByTestId('setup-copy')).textContent).toBe('Copied.');
    expect(writeText).toHaveBeenCalledWith('r-1a2b3c4d@in.example.test');
    const steps = screen.getByTestId('setup-forwarding').textContent ?? '';
    expect(steps).toMatch(/cannot be confirmed from here today/);
  });

  // r28 gap 11: the page told owners to do what order letters already do, and
  // that a hand-forwarded letter keeps the vendor's name. Neither was true.
  it('says order letters already ask for replies here, and that a letter forwarded by hand is not the vendor\'s', async () => {
    answer(view());
    mount();
    expect((await screen.findByTestId('setup-forwarding-give')).textContent).toBe(
      'Give this address to your vendors. The order letters Mudavym sends already ask vendors to reply to it.',
    );
    const byHand = screen.getByTestId('setup-forwarding-by-hand').textContent ?? '';
    expect(byHand).toMatch(/^A letter you forward by hand arrives from you, not from the vendor, so it is not filed as the vendor’s\./);
    expect(byHand).toMatch(/keeps it only when it carries an attachment or reads as an offer/);
    const steps = screen.getByTestId('setup-forwarding').textContent ?? '';
    expect(steps).not.toMatch(/keeps the vendor|put it on your orders/);
  });

  it('a failed copy says so and never claims it copied', async () => {
    answer(view());
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    expect((await screen.findByTestId('setup-copy')).textContent).toBe(
      'It could not be copied; select it and copy it by hand.',
    );
  });

  it('no address yet: an owner can make one with POST address', async () => {
    answer(view({ arrival: { domainReady: true, address: null, failed: null } }));
    api.post.mockResolvedValue({ data: view() });
    mount();
    expect((await screen.findByTestId('setup-address')).getAttribute('data-state')).toBe('none');
    fireEvent.click(screen.getByRole('button', { name: 'Make the address' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/communications/mail-setup/address'));
    await waitFor(() => expect(screen.getByTestId('setup-address').getAttribute('data-state')).toBe('ready'));
  });

  it('an address that could not be made says why', async () => {
    answer(view({ arrival: { domainReady: true, address: null, failed: null } }));
    api.post.mockRejectedValue(fail(500, 'Internal server error'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Make the address' }));
    expect((await screen.findByTestId('setup-make-failed')).textContent).toBe(
      "The house's Mudavym address could not be made; try again.",
    );
  });

  it('when Mudavym cannot receive mail for houses, says so plainly, with no jargon', async () => {
    answer(view({ arrival: { domainReady: false, address: null, failed: null } }));
    mount();
    const box = await screen.findByTestId('setup-address');
    expect(box.getAttribute('data-state')).toBe('cannot_receive');
    expect(box.textContent).toMatch(/Mudavym cannot receive mail for houses yet/);
    expect(screen.queryByTestId('setup-test-letter')).toBeNull();
    const words = document.body.textContent ?? '';
    expect(words).not.toMatch(/inbound|domain|doors?\b|invalid_grant/i);
  });

  it('a failed address read says it failed, never "no address"', async () => {
    answer(view({ arrival: { domainReady: true, address: null, failed: "The house's Mudavym address could not be read." } }));
    mount();
    expect((await screen.findByTestId('setup-address-unread')).textContent).toBe(
      "The house's Mudavym address could not be read. That does not mean the house has none.",
    );
    expect(screen.queryByText(/has no Mudavym address yet/)).toBeNull();
  });
});

describe('the test letter', () => {
  it('none yet: starting one POSTs, then offers the mailto with the code', async () => {
    answer(view());
    api.post.mockResolvedValue({ data: view({ testLetter: { failed: null, latest: LETTER({ startedAt: ago(0) }) } }) });
    mount();
    expect((await screen.findByTestId('setup-test-state')).textContent).toBe('No test letter has been sent yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Send a test letter' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/communications/mail-setup/test-letter'));
    const link = await screen.findByTestId('setup-test-mailto');
    expect(link.getAttribute('href')).toMatch(/^mailto:r-1a2b3c4d@in\.example\.test\?subject=/);
    expect(screen.getByText('K7QM-2RZD')).toBeTruthy();
    expect(screen.getByTestId('setup-test-state').getAttribute('data-state')).toBe('waiting');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('arrived: says when, and who the letter only claims to be from', async () => {
    // QA round 26, #974 defect 3: the From line of a letter is not checked by
    // anyone, so the page does not vouch for it.
    answer(view({ testLetter: { failed: null, latest: LETTER({ arrivedAt: ago(4 * 60_000 + 5_000), arrivedFrom: 'me@gmail.test' }) } }));
    mount();
    const s = await screen.findByTestId('setup-test-state');
    expect(s.getAttribute('data-state')).toBe('arrived');
    expect(s.textContent).toBe('Arrived 4 min ago. It claims to be from me@gmail.test; nothing checks that. Mail reaches this house.');
    expect(screen.getByRole('button', { name: 'Send another test letter' })).toBeTruthy();
  });

  it('an earlier test letter that arrived after the newest was started is shown', async () => {
    // QA round 26, #974 defect 2 (probe B6-older-arrives).
    answer(
      view({
        testLetter: {
          failed: null,
          latest: LETTER({ startedAt: ago(5 * 60_000) }),
          lastArrival: { code: 'AAAA-AAAA', arrivedAt: ago(60_000 + 5_000), arrivedFrom: 'me@gmail.test' },
        },
      }),
    );
    mount();
    expect((await screen.findByTestId('setup-test-earlier')).textContent).toBe(
      'An earlier test letter, AAAA-AAAA, arrived 1 min ago. It claims to be from me@gmail.test; nothing checks that. Mail reaches this house.',
    );
    expect(screen.getByTestId('setup-test-state').getAttribute('data-state')).toBe('waiting');
  });

  it('an arrival from before the newest letter was started is not shown as news', async () => {
    answer(
      view({
        testLetter: {
          failed: null,
          latest: LETTER({ startedAt: ago(5 * 60_000) }),
          lastArrival: { code: 'AAAA-AAAA', arrivedAt: ago(60 * 60_000), arrivedFrom: 'me@gmail.test' },
        },
      }),
    );
    mount();
    await screen.findByTestId('setup-test-state');
    expect(screen.queryByTestId('setup-test-earlier')).toBeNull();
  });

  it('late: past the wait it says it has not arrived and what to check', async () => {
    answer(view({ testLetter: { failed: null, latest: LETTER({ startedAt: ago(2 * 3_600_000) }) } }));
    mount();
    const s = await screen.findByTestId('setup-test-state');
    expect(s.getAttribute('data-state')).toBe('late');
    expect(s.textContent).toBe('Not arrived 2 h after it was started. Check that it went to the address above, or send another.');
  });

  it('a failed read says it failed', async () => {
    answer(view({ testLetter: { failed: 'Whether the test letter arrived could not be read.', latest: null } }));
    mount();
    expect((await screen.findByTestId('setup-test-unread')).textContent).toBe(
      'Whether the test letter arrived could not be read.',
    );
    expect(screen.queryByText('No test letter has been sent yet.')).toBeNull();
  });

  it('staff see the state but cannot start a test letter', async () => {
    answer(view({ canChange: false, testLetter: { failed: null, latest: LETTER() } }));
    mount();
    expect((await screen.findByTestId('setup-test-state')).getAttribute('data-state')).toBe('waiting');
    expect(screen.queryByRole('button', { name: /test letter/ })).toBeNull();
    expect(screen.getByText('Only an owner or a manager of this house can send a test letter.')).toBeTruthy();
  });

  it('a test letter that could not be started says why', async () => {
    answer(view());
    api.post.mockRejectedValue(fail(503, 'invalid_grant: Token has been expired or revoked.'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Send a test letter' }));
    expect((await screen.findByTestId('setup-test-failed')).textContent).toBe(
      'The test letter could not be started; try again.',
    );
  });

  it('while waiting, the page reads again on its own and shows the arrival', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.get
      .mockResolvedValueOnce({ data: view({ testLetter: { failed: null, latest: LETTER() } }) })
      .mockResolvedValue({
        data: view({ testLetter: { failed: null, latest: LETTER({ arrivedAt: ago(1_000), arrivedFrom: 'me@gmail.test' }) } }),
      });
    mount();
    expect((await screen.findByTestId('setup-test-state')).getAttribute('data-state')).toBe('waiting');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    await waitFor(() => expect(screen.getByTestId('setup-test-state').getAttribute('data-state')).toBe('arrived'));
    expect(api.get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not poll when nothing is on its way', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answer(view());
    mount();
    await screen.findByTestId('setup-test-state');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});
