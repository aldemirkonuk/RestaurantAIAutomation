/**
 * Connecting Gmail from Mail setup, and coming back to it (r28 mail audit,
 * gap 10). Before, Mail setup sent an owner to Connections, and Google's
 * permission returned to Connections, never to Mail setup. Now the permission
 * starts here and returns here, and the return says only what the provider
 * said: whether a mailbox is connected is what the page's own lists read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));

import { MAIL_SETUP_RETURN, MailSetup, consentPath } from './MailSetup';
import type { MailSetupView } from './useMailSetup';
import type { MailStatus } from './mail-format';

const STATUS: MailStatus = { state: 'not_connected', words: 'Not connected', tone: 'warn' };

function view(over: Partial<MailSetupView> = {}): MailSetupView {
  return {
    canChange: true,
    senders: { failed: null, chosenConnectionId: null, choices: [] },
    arrival: { domainReady: true, address: 'r-1a2b3c4d@in.example.test', failed: null },
    testLetter: { failed: null, latest: null },
    ...over,
  };
}

const entry = (id: string, available: boolean) => ({
  id,
  provider: 'google',
  label: id,
  providerLabel: 'Google',
  description: '',
  scopes: [],
  notRequested: [],
  available,
  unavailableReason: available ? null : 'Not configured.',
});

let setup: () => MailSetupView;
let catalog: () => unknown;

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search + l.hash}</output>;
}

function mount(at = MAIL_SETUP_RETURN, props: Partial<Parameters<typeof MailSetup>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <MailSetup
          status={STATUS}
          sender={null}
          senderFailed={false}
          conversationWords={null}
          readerGranted={false}
          onBack={vi.fn()}
          {...props}
        />
        <Where />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  setup = () => view();
  catalog = () => ({ success: true, integrations: [entry('gmail_send', true), entry('gmail_read', true)] });
  api.get.mockReset();
  api.get.mockImplementation(async (url: string) => {
    if (url === '/communications/mail-setup') return { data: setup() };
    if (url === '/integrations/oauth/catalog') return { data: catalog() };
    throw new Error(`unexpected GET ${url}`);
  });
});

const catalogReads = () => api.get.mock.calls.filter(([u]) => u === '/integrations/oauth/catalog').length;

describe('connecting from Mail setup', () => {
  it('the permission returns to Mail setup, not to Connections', () => {
    expect(consentPath('gmail_send')).toBe('/authorize/gmail_send?returnPath=%2Fcommunications%3Ftab%3Dmail%26setup%3D1');
    expect(consentPath('gmail_read')).toBe('/authorize/gmail_read?returnPath=%2Fcommunications%3Ftab%3Dmail%26setup%3D1');
  });

  it('no sending mailbox: an owner connects Gmail from here', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Connect your Gmail to send from it' }));
    expect(screen.getByTestId('where').textContent).toBe(consentPath('gmail_send'));
    expect(screen.getByTestId('setup-senders-none').textContent).toMatch(/come straight back to this page/);
    expect(screen.queryByRole('button', { name: 'Open Connections' })).toBeNull();
  });

  it('no mailbox is read: an owner lets vendor replies in their Gmail land here, and is told about the switch', async () => {
    mount();
    const box = await screen.findByTestId('setup-reader-none');
    expect(box.textContent).toMatch(/“Read this house’s mailbox” switch in Settings/);
    fireEvent.click(screen.getByRole('button', { name: 'Let vendor replies in your Gmail land here' }));
    expect(screen.getByTestId('where').textContent).toBe(consentPath('gmail_read'));
  });

  it('a reader that is granted, or not known, offers no reading consent', async () => {
    for (const readerGranted of [true, 'unknown'] as const) {
      mount(MAIL_SETUP_RETURN, { readerGranted });
      await screen.findByTestId('setup-senders-none');
      await waitFor(() => expect(catalogReads()).toBeGreaterThan(0));
      // The catalogue offers reading, so only the reader's own state holds it back.
      expect(await screen.findByTestId('setup-connect-send')).toBeTruthy();
      expect(screen.queryByTestId('setup-reader-none')).toBeNull();
      cleanup();
    }
  });

  it('a connection this deployment does not offer falls back to Connections', async () => {
    catalog = () => ({ success: true, integrations: [entry('gmail_send', false), entry('gmail_read', false)] });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Open Connections' }));
    expect(screen.getByTestId('where').textContent).toBe('/connections#grants');
    expect(screen.queryByTestId('setup-connect-send')).toBeNull();
    expect(screen.queryByTestId('setup-reader-none')).toBeNull();
  });

  it('an unread catalogue offers nothing it cannot back, and keeps the way to Connections', async () => {
    catalog = () => {
      throw Object.assign(new Error('x'), { response: { status: 503 } });
    };
    mount();
    expect(await screen.findByRole('button', { name: 'Open Connections' })).toBeTruthy();
    await waitFor(() => expect(catalogReads()).toBeGreaterThan(0));
    expect(screen.queryByTestId('setup-connect-send')).toBeNull();
    expect(screen.queryByTestId('setup-connect-read')).toBeNull();
  });

  it('staff are offered neither, and the catalogue is not read for them', async () => {
    setup = () => view({ canChange: false });
    mount();
    expect(await screen.findByTestId('setup-senders-none')).toBeTruthy();
    expect(screen.queryByTestId('setup-connect-send')).toBeNull();
    expect(screen.queryByTestId('setup-reader-none')).toBeNull();
    expect(catalogReads()).toBe(0);
  });

  it('a house with a sending mailbox is not asked to connect one', async () => {
    setup = () =>
      view({
        senders: {
          failed: null,
          chosenConnectionId: null,
          choices: [{ connectionId: 'c1', address: 'me@house.test', personName: 'Deniz', mine: true, chosen: false, sending: true }],
        },
      });
    mount();
    expect(await screen.findByText('me@house.test · connected by you')).toBeTruthy();
    expect(screen.queryByTestId('setup-connect-send')).toBeNull();
  });
});

describe('coming back from Google', () => {
  it('a "connected" return points at the page\'s own lists, and claims nothing', async () => {
    mount(`${MAIL_SETUP_RETURN}&integration_status=connected&integration=gmail_send`);
    const back = await screen.findByTestId('setup-consent-return');
    expect(back.getAttribute('data-state')).toBe('returned');
    expect(back.textContent).toMatch(
      /^Sending from your Gmail: Google sent you back here\. Whether it is connected is what this page reads below, not the return itself\./,
    );
  });

  it('an unfinished return says nothing was connected, and why, in words', async () => {
    mount(`${MAIL_SETUP_RETURN}&integration_status=error&integration=gmail_read&integration_reason=denied`);
    const back = await screen.findByTestId('setup-consent-return');
    expect(back.getAttribute('data-state')).toBe('unfinished');
    expect(back.textContent).toMatch(
      /^Reading vendor replies in your Gmail did not finish, so nothing was connected\. The provider returned a declined permission\./,
    );
  });

  it('an unknown reason still says nothing was connected', async () => {
    mount(`${MAIL_SETUP_RETURN}&integration_status=error&integration_reason=zzz`);
    expect((await screen.findByTestId('setup-consent-return')).textContent).toMatch(
      /^The permission did not finish, so nothing was connected\. The provider flow returned without a confirmed connection\./,
    );
  });

  it('Dismiss drops the return and keeps the page', async () => {
    mount(`${MAIL_SETUP_RETURN}&integration_status=connected&integration=gmail_send`);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('setup-consent-return')).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe(MAIL_SETUP_RETURN);
  });

  it('no return, no notice', async () => {
    mount();
    await screen.findByTestId('setup-senders-none');
    expect(screen.queryByTestId('setup-consent-return')).toBeNull();
  });
});
