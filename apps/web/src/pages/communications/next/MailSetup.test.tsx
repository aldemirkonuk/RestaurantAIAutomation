/**
 * The mail setup page and "which address letters leave from" (founder /goal
 * 2026-11-07), rendered for real against a stubbed gateway. Every write is a
 * mocked PUT: nothing here sends mail. "How mail arrives" and the test letter
 * are proved in MailArrival.test.tsx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));

import { MailSetup } from './MailSetup';
import type { MailSetupView } from './useMailSetup';
import type { MailStatus, SenderLineInput } from './mail-format';

const MINE = 'c1';
const CHEF = 'c2';
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

/** The chef's mailbox is the house's choice and sends now; mine is free to pick. */
function chefSending(): MailSetupView {
  return view({
    senders: {
      failed: null,
      chosenConnectionId: CHEF,
      choices: [
        { connectionId: MINE, address: 'me@house.test', personName: 'Deniz', mine: true, chosen: false, sending: false },
        { connectionId: CHEF, address: 'office@house.test', personName: 'Ayşe', mine: false, chosen: true, sending: true },
      ],
    },
  });
}

const CONNECTED: MailStatus = { state: 'connected', words: 'Connected · last letter 4 min ago', tone: 'seal' };
const SENDER: SenderLineInput = { kind: 'house_mailbox', address: 'me@house.test' };

const fail = (status: number, message?: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: message ? { message } : {} },
  });

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search + l.hash}</output>;
}

function mount(props: Partial<Parameters<typeof MailSetup>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onBack = vi.fn();
  render(
    <MemoryRouter initialEntries={['/communications?tab=mail&setup=1']}>
      <QueryClientProvider client={qc}>
        <MailSetup
          status={CONNECTED}
          sender={SENDER}
          senderFailed={false}
          conversationWords={null}
          onBack={onBack}
          {...props}
        />
        <Where />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onBack, qc };
}

const answer = (v: MailSetupView) => api.get.mockResolvedValue({ data: v });

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
});

describe('the setup page itself', () => {
  it('reads GET /communications/mail-setup and shows the status line the tab shows', async () => {
    answer(view());
    const { onBack } = mount();
    expect(screen.getByText('Reading the mail setup…')).toBeTruthy();
    expect(await screen.findByText('me@house.test · connected by you')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/communications/mail-setup');
    const status = screen.getByTestId('setup-status');
    expect(status.textContent).toBe('Connected · last letter 4 min ago');
    expect(status.getAttribute('data-state')).toBe('connected');
    fireEvent.click(screen.getByRole('button', { name: '← Back to the mail' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('shows "Not connected" when the tab says so, never "cannot tell"', async () => {
    answer(view());
    mount({ status: { state: 'not_connected', words: 'Not connected', tone: 'warn' } });
    await screen.findByTestId('setup-sender-line');
    expect(screen.getByTestId('setup-status').textContent).toBe('Not connected');
    expect(screen.queryByText(/cannot tell/i)).toBeNull();
  });

  // r21: a switched-off reader names the switch and, for an owner or a
  // manager, opens it; staff are told who can.
  it('switched off: names the Settings switch and opens it', async () => {
    answer(view());
    mount({ status: { state: 'switched_off', words: 'Connected, but reading is switched off for this house.', tone: 'warn' } });
    expect((await screen.findByTestId('setup-switched-off')).textContent).toMatch(
      /“Read this house’s mailbox” switch in Settings is off/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open the switch in Settings' }));
    expect(screen.getByTestId('where').textContent).toBe('/settings?tab=features');
  });

  it('switched off, staff: says who can turn it on, with no button', async () => {
    answer(view({ canChange: false }));
    mount({ status: { state: 'switched_off', words: 'Connected, but reading is switched off for this house.', tone: 'warn' } });
    expect((await screen.findByTestId('setup-switched-off')).textContent).toMatch(/An owner or a manager can turn it on\./);
    expect(screen.queryByRole('button', { name: 'Open the switch in Settings' })).toBeNull();
  });

  it('no switched-off line while the reader is connected', async () => {
    answer(view());
    mount();
    await screen.findByTestId('setup-sender-line');
    expect(screen.queryByTestId('setup-switched-off')).toBeNull();
  });

  it('a failed read says it failed and that it does not mean nothing is set up', async () => {
    api.get.mockRejectedValue(fail(503, 'upstream connect error or disconnect/reset before headers'));
    mount();
    const alert = await screen.findByTestId('setup-unread');
    expect(alert.textContent).toBe('The mail setup could not be read. That does not mean nothing is set up.');
    expect(alert.textContent).not.toMatch(/503|status code/);
    expect(screen.queryByText('Which address letters leave from')).toBeNull();
  });
});

describe('which address letters leave from', () => {
  it('names the sender, lists the connected mailboxes and marks the one sending now', async () => {
    answer(view());
    mount();
    expect((await screen.findByTestId('setup-sender-line')).textContent).toBe('Letters leave from me@house.test.');
    const rows = screen.getAllByTestId('setup-sender-choice');
    expect(rows.map((r) => r.textContent)).toEqual([
      'me@house.test · connected by you· letters leave from here now',
      'office@house.test · connected by Ayşe',
    ]);
    expect((within(rows[0]).getByRole('radio') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/No mailbox is chosen, so a letter leaves from the mailbox of the person/)).toBeTruthy();
  });

  it('a failed or unknown sender read says it could not be read, and invents no address', async () => {
    answer(view());
    mount({ sender: null, senderFailed: true });
    expect((await screen.findByTestId('setup-sender-line')).textContent).toBe(
      'Which address letters leave from could not be read.',
    );
  });

  it('a mailbox whose address was not recorded is said so', async () => {
    const v = view();
    v.senders.choices[1] = { ...v.senders.choices[1], address: null };
    answer(v);
    mount();
    expect(await screen.findByText('A mailbox whose address was not recorded · connected by Ayşe')).toBeTruthy();
  });

  it('saves the picked mailbox with PUT sender, and shows what the server now holds', async () => {
    answer(chefSending());
    const saved = view({
      senders: {
        failed: null,
        chosenConnectionId: MINE,
        choices: [
          { connectionId: MINE, address: 'me@house.test', personName: 'Deniz', mine: true, chosen: true, sending: true },
          { connectionId: CHEF, address: 'office@house.test', personName: 'Ayşe', mine: false, chosen: false, sending: false },
        ],
      },
    });
    api.put.mockResolvedValue({ data: saved });
    mount();
    const save = await screen.findByRole('button', { name: 'Save' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('radio')[0]);
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/communications/mail-setup/sender', { connectionId: MINE }),
    );
    const rows = await screen.findAllByTestId('setup-sender-choice');
    await waitFor(() => expect(rows[0].textContent).toMatch(/letters leave from here now/));
    expect(screen.getByRole('button', { name: 'Let Mudavym choose again' })).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('"Let Mudavym choose again" sends null', async () => {
    answer(view({ senders: { ...view().senders, chosenConnectionId: CHEF } }));
    api.put.mockResolvedValue({ data: view() });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Let Mudavym choose again' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/communications/mail-setup/sender', { connectionId: null }),
    );
  });

  it("a colleague's mailbox cannot be picked here, and the page says who can choose it", async () => {
    // QA round 26, #973 defect 2: only the person who connected a mailbox may
    // make it the house's. The server refuses it too; this is the plain door.
    answer(view());
    mount();
    const radios = await screen.findAllByRole('radio');
    expect((radios[0] as HTMLInputElement).disabled).toBe(false);
    expect((radios[1] as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId('setup-sender-own-only').textContent).toBe(
      'You can choose only a mailbox you connected yourself. A colleague’s mailbox is chosen by that colleague, here.',
    );
  });

  it("a refused save says it in the page's own words, never the server's or a status code", async () => {
    // QA round 26, #980 defect 3: whatever the server put in `message` was
    // printed as it came, so a validation or provider string reached the owner.
    answer(chefSending());
    api.put.mockRejectedValue(fail(400, 'connectionId must be a UUID'));
    mount();
    fireEvent.click((await screen.findAllByRole('radio'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const err = await screen.findByTestId('setup-save-failed');
    expect(err.textContent).toBe('That mailbox cannot send for this house any more. Nothing was changed.');
    expect(err.textContent).not.toMatch(/UUID|400/);
  });

  it('with no choice stored, Save pins the mailbox that is sending now (QA round 26, #980)', async () => {
    answer(view());
    api.put.mockResolvedValue({ data: view() });
    mount();
    const save = (await screen.findByRole('button', { name: 'Save' })) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/communications/mail-setup/sender', { connectionId: MINE }),
    );
  });

  it("with no choice stored and a colleague's mailbox sending, Save stays off: it is not yours to pin", async () => {
    answer(view({ senders: { ...chefSending().senders, chosenConnectionId: null } }));
    mount();
    const save = (await screen.findByRole('button', { name: 'Save' })) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('after a save, says "Saved." in a polite live region that was there before it spoke', async () => {
    answer(chefSending());
    api.put.mockResolvedValue({ data: view() });
    mount();
    const region = (await screen.findByTestId('setup-saved'));
    expect(region.textContent).toBe('');
    fireEvent.click(screen.getAllByRole('radio')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('setup-saved').textContent).toBe('Saved.'));
    expect(screen.getByTestId('setup-saved')).toBe(region);
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('a refused save does not say "Saved."', async () => {
    answer(chefSending());
    api.put.mockRejectedValue(fail(400));
    mount();
    fireEvent.click((await screen.findAllByRole('radio'))[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByTestId('setup-save-failed');
    expect(screen.getByTestId('setup-saved').textContent).toBe('');
  });

  it("says where a vendor's replies go, in the sentence the intake sheet uses", async () => {
    answer(view());
    const words = "Letters leave from me@house.test; replies still arrive through notifications@mudavym.com.";
    mount({ conversationWords: words });
    expect((await screen.findByTestId('setup-conversation-words')).textContent).toBe(words);
  });

  it('says nothing about replies when the tab has no sentence, and invents none', async () => {
    answer(view());
    mount({ conversationWords: null });
    await screen.findByTestId('setup-sender-line');
    expect(screen.queryByTestId('setup-conversation-words')).toBeNull();
  });

  it("a failed read of the house's chosen mailbox says so, never 'no mailbox is chosen'", async () => {
    answer(
      view({
        senders: { failed: "The house's chosen mailbox could not be read.", chosenConnectionId: null, choices: [] },
      }),
    );
    mount();
    expect((await screen.findByTestId('setup-senders-unread')).textContent).toMatch(
      /^The house's chosen mailbox could not be read\./,
    );
    expect(screen.queryByText(/No mailbox is chosen/)).toBeNull();
  });

  it('staff see the same list, read-only, with no Save', async () => {
    answer(view({ canChange: false }));
    mount();
    await screen.findAllByTestId('setup-sender-choice');
    for (const r of screen.getAllByRole('radio')) expect((r as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByTestId('setup-read-only').textContent).toBe(
      'Only an owner or a manager of this house can change this.',
    );
  });

  it('no connected mailbox points to Connections', async () => {
    answer(view({ senders: { failed: null, chosenConnectionId: null, choices: [] } }));
    mount();
    expect((await screen.findByTestId('setup-senders-none')).textContent).toMatch(/Connect one in Connections/);
    fireEvent.click(screen.getByRole('button', { name: 'Open Connections' }));
    // Lands on the register that holds the Gmail rows, not the page top (r12 walk).
    expect(screen.getByTestId('where').textContent).toBe('/connections#grants');
  });

  it('a failed mailbox-list read says it failed, never "none connected"', async () => {
    answer(
      view({
        senders: { failed: 'Which mailboxes this house can send from could not be read.', chosenConnectionId: null, choices: [] },
      }),
    );
    mount();
    expect((await screen.findByTestId('setup-senders-unread')).textContent).toBe(
      'Which mailboxes this house can send from could not be read. That does not mean none is connected.',
    );
    expect(screen.queryByTestId('setup-senders-none')).toBeNull();
  });
});
