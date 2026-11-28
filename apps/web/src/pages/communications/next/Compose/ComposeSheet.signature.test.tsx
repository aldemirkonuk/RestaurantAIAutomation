/** r110 mail-gap g3: a signature per sending address, in the composer's body and in MailSetup. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));

vi.mock('./useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useComposeData')>()),
  useComposeData: () => mockData.current,
  useLetterSenderStanding: () => ({
    restaurantId: 'r1', canRelease: true, noMailbox: false, basis: 'owner', checking: false, checkedAt: 0, recheck: () => {},
  }),
}));
vi.mock('../../../../services/api/client', () => ({ apiClient: api }));
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'owner', restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: 'owner' }),
}));

import { ComposeSheet } from './ComposeSheet';
import { SignatureEditor, swapSignature } from '../MailSignature';

const MAY_SEND = { readable: true, maySend: true, mode: 'send' as const, basis: 'manager' as const, grant: null, sentence: null };
const mailbox = (address: string, basis: 'owner' | 'manager' | 'grant' | null = 'manager') => ({
  kind: 'house_mailbox' as const,
  address,
  sendable: true,
  ceremony: 'undo' as const,
  undoMs: 120000,
  words: `Sends as ${address}.`,
  missing: [],
  categories: [],
  dispatcher: null,
  sendOrAsk: { ...MAY_SEND, basis },
});
const BOOK = [{ providerId: 'p1', providerName: 'Fikri Tarım Gıda', contactName: 'Fikri', email: 'fikri@fikritarim.com', source: 'provider' as const }];
const SIG = 'Deniz\nKitchenette, Antalya';
const BLOCK = `\n\n-- \n${SIG}`;
const base = {
  restaurantId: 'r1',
  sender: mailbox('me@house.test'),
  senderFailed: false,
  senderError: null,
  signature: { address: 'me@house.test', body: SIG, updatedAt: null },
  book: BOOK,
  bookFailed: false,
  bookError: null,
  byProvider: new Map(),
  templates: [{ id: 't1', name: 'Price', subject: 'Prices', body: 'Could you send this week’s prices?', type: 'letter' }],
  templatesFailed: false,
  templatesError: null,
  insights: [],
  insightsFailed: false,
  insightsError: null,
  queued: [],
  queuedFailed: false,
  refetchQueued: vi.fn(),
  refetchRequests: vi.fn(),
};

const bodyBox = () => screen.getByLabelText('The letter') as HTMLTextAreaElement;
function sheet(props: Partial<Parameters<typeof ComposeSheet>[0]> = {}) {
  const r = render(
    <MemoryRouter>
      <ComposeSheet open onClose={() => {}} {...props} />
    </MemoryRouter>,
  );
  return {
    ...r,
    again: (over: Partial<Parameters<typeof ComposeSheet>[0]> = {}) =>
      r.rerender(
        <MemoryRouter>
          <ComposeSheet open onClose={() => {}} {...props} {...over} />
        </MemoryRouter>,
      ),
  };
}

beforeEach(() => {
  mockData.current = { ...base };
  api.get.mockReset();
  api.put.mockReset();
  api.post.mockReset();
});

describe('the composer puts the address’s signature in the body', () => {
  it('a new letter opens with "-- " and the signature below an empty first line', async () => {
    sheet();
    await waitFor(() => expect(bodyBox().value).toBe(BLOCK));
  });

  it.each([
    ['no signature for the address', { address: 'me@house.test', body: null, updatedAt: null }],
    ['no signature read', null],
  ])('%s: an empty letter', (_w, signature) => {
    mockData.current = { ...base, signature };
    sheet();
    expect(bodyBox().value).toBe('');
  });

  it.each([`Hello${BLOCK}`, ''])('held words resume as held, never signed again (%j)', (body) => {
    sheet({ prefill: { subject: 'Prices', body } });
    expect(bodyBox().value).toBe(body);
  });

  it('a drafted letter keeps its own words', () => {
    sheet({ prefill: { draftId: 'd1', subject: 'Credit', body: 'We ask for a credit.', to: null } });
    expect(bodyBox().value).toBe('We ask for a credit.');
  });

  it('the signature alone is not a letter: Send waits for words', async () => {
    sheet();
    await waitFor(() => expect(bodyBox().value).toBe(BLOCK));
    fireEvent.click(screen.getByText('Fikri Tarım Gıda'));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Prices' } });
    expect(screen.getByTestId('letter-send')).toBeDisabled();
    fireEvent.change(bodyBox(), { target: { value: `Merhaba,${BLOCK}` } });
    expect(screen.getByTestId('letter-send')).toBeEnabled();
  });

  it('an untouched letter with its signature closes holding nothing', async () => {
    const onHold = vi.fn();
    const onClose = vi.fn();
    sheet({ onHold, onClose });
    await waitFor(() => expect(bodyBox().value).toBe(BLOCK));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onHold).not.toHaveBeenCalled();
  });

  it('a held letter carries the signature as part of its words', async () => {
    const onHold = vi.fn();
    sheet({ onHold });
    await waitFor(() => expect(bodyBox().value).toBe(BLOCK));
    fireEvent.change(bodyBox(), { target: { value: `Merhaba,${BLOCK}` } });
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(onHold).toHaveBeenCalledWith(expect.objectContaining({ body: `Merhaba,${BLOCK}` })));
  });

  it('"See it as it leaves" shows the signature, because it is in the body', async () => {
    api.post.mockResolvedValue({
      data: { from: { name: null, address: 'me@house.test' }, to: 'f@f.test', replyTo: null, subject: 'Prices', body: `Merhaba,${BLOCK}` },
    });
    sheet();
    await waitFor(() => expect(bodyBox().value).toBe(BLOCK));
    fireEvent.click(screen.getByText('Fikri Tarım Gıda'));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Prices' } });
    fireEvent.change(bodyBox(), { target: { value: `Merhaba,${BLOCK}` } });
    fireEvent.click(screen.getByTestId('letter-see'));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/communications/letters/preview', expect.objectContaining({ body: `Merhaba,${BLOCK}` })),
    );
  });

  it('a template keeps the signature below its words', async () => {
    sheet();
    await waitFor(() => expect(bodyBox().value).toBe(BLOCK));
    fireEvent.change(screen.getByLabelText('Start from'), { target: { value: 't1' } });
    expect(bodyBox().value).toBe(`Could you send this week’s prices?${BLOCK}`);
  });
});

describe('a change of address', () => {
  it('swaps the block, keeping the words above it, while the block is untouched', async () => {
    const s = sheet();
    await waitFor(() => expect(bodyBox().value).toBe(BLOCK));
    fireEvent.change(bodyBox(), { target: { value: `Merhaba,${BLOCK}` } });
    mockData.current = { ...base, sender: mailbox('office@house.test'), signature: { address: 'office@house.test', body: 'The office', updatedAt: null } };
    s.again();
    await waitFor(() => expect(bodyBox().value).toBe('Merhaba,\n\n-- \nThe office'));
  });

  it('to an address with no signature takes the block out', async () => {
    const s = sheet();
    await waitFor(() => expect(bodyBox().value).toBe(BLOCK));
    fireEvent.change(bodyBox(), { target: { value: `Merhaba,${BLOCK}` } });
    mockData.current = { ...base, sender: mailbox('office@house.test'), signature: { address: 'office@house.test', body: null, updatedAt: null } };
    s.again();
    await waitFor(() => expect(bodyBox().value).toBe('Merhaba,'));
  });

  it('leaves an edited block alone, and never swaps again', async () => {
    const s = sheet();
    await waitFor(() => expect(bodyBox().value).toBe(BLOCK));
    fireEvent.change(bodyBox(), { target: { value: `Merhaba,${BLOCK} (on leave)` } });
    mockData.current = { ...base, sender: mailbox('office@house.test'), signature: { address: 'office@house.test', body: 'The office', updatedAt: null } };
    s.again();
    await new Promise((r) => setTimeout(r, 30));
    expect(bodyBox().value).toBe(`Merhaba,${BLOCK} (on leave)`);
    // Put back exactly as it was put in: still not the sheet's after the change of address.
    fireEvent.change(bodyBox(), { target: { value: `Merhaba,${BLOCK}` } });
    mockData.current = { ...base, sender: mailbox('bar@house.test'), signature: { address: 'bar@house.test', body: 'Bar', updatedAt: null } };
    s.again();
    await new Promise((r) => setTimeout(r, 30));
    expect(bodyBox().value).toBe(`Merhaba,${BLOCK}`);
  });

  it('a block edited and put back before the change is still the sheet’s', async () => {
    const s = sheet();
    await waitFor(() => expect(bodyBox().value).toBe(BLOCK));
    fireEvent.change(bodyBox(), { target: { value: `Merhaba,${BLOCK}!` } });
    fireEvent.change(bodyBox(), { target: { value: `Merhaba,${BLOCK}` } });
    mockData.current = { ...base, sender: mailbox('office@house.test'), signature: { address: 'office@house.test', body: 'The office', updatedAt: null } };
    s.again();
    await waitFor(() => expect(bodyBox().value).toBe('Merhaba,\n\n-- \nThe office'));
  });

  it('swapSignature: an empty block gains the next at the end; a missing one is not the sheet’s', () => {
    expect(swapSignature('Hi \n', '', BLOCK)).toEqual({ body: `Hi${BLOCK}`, block: BLOCK });
    expect(swapSignature('Hi', '', '')).toEqual({ body: 'Hi', block: '' });
    expect(swapSignature('Hi', null, BLOCK)).toBeNull();
    expect(swapSignature('It is null', null, BLOCK)).toBeNull();
    expect(swapSignature('Hi', BLOCK, '')).toBeNull();
  });
});

describe('who is asked for the signature', () => {
  const sigAsks = () => api.get.mock.calls.filter((c) => String(c[0]).includes('letters/signature'));
  async function hook(from: string, basis: 'owner' | 'manager' | 'grant', answers: string) {
    const { useComposeData } = await vi.importActual<typeof import('./useComposeData')>('./useComposeData');
    api.get.mockImplementation(async (url: string) => ({
      data: url.endsWith('/letters/sender')
        ? mailbox(from, basis)
        : url.endsWith('/letters/signature')
          ? { address: answers, body: SIG, updatedAt: null }
          : { entries: [], templates: [], queued: [], insights: [] },
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useComposeData(), { wrapper });
    await waitFor(() => expect(result.current.sender).not.toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    return result;
  }

  it.each(['owner', 'manager'] as const)('an %s, for the address lower-cased', async (basis) => {
    const result = await hook('Me@House.test', basis, 'me@house.test');
    expect(sigAsks()).toEqual([['/communications/letters/signature', { params: { address: 'me@house.test' } }]]);
    expect(result.current.signature?.body).toBe(SIG);
  });

  it('not a grantee', async () => {
    const result = await hook('me@house.test', 'grant', 'me@house.test');
    expect(sigAsks()).toHaveLength(0);
    expect(result.current.signature).toBeNull();
  });

  it('an answer that names another address is not this letter’s signature', async () => {
    const result = await hook('office@house.test', 'manager', 'me@house.test');
    expect(sigAsks()).toHaveLength(1);
    expect(result.current.signature).toBeNull();
  });
});

describe('MailSetup: Signature for <address>', () => {
  const editor = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <SignatureEditor address="me@house.test" />
      </QueryClientProvider>,
    );
  };

  it('Save writes it and then shows the value the server stored, read back', async () => {
    api.get.mockResolvedValue({ data: { address: 'me@house.test', body: 'Old', updatedAt: null } });
    api.put.mockResolvedValue({ data: { address: 'me@house.test', body: 'Deniz', updatedAt: '2026-11-27T10:00:00Z' } });
    editor();
    const box = (await screen.findByLabelText('Signature for me@house.test')) as HTMLTextAreaElement;
    await waitFor(() => expect(box.value).toBe('Old'));
    fireEvent.change(box, { target: { value: 'Deniz   \n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the signature' }));
    await waitFor(() => expect(screen.getByTestId('setup-signature-saved')).toHaveTextContent('Saved.'));
    expect(api.put).toHaveBeenCalledWith('/communications/letters/signature', { address: 'me@house.test', body: 'Deniz   \n' });
    expect(box.value).toBe('Deniz');
    expect(api.get).toHaveBeenCalledWith('/communications/letters/signature', { params: { address: 'me@house.test' } });
  });

  it('a refused save says why and that nothing was saved', async () => {
    api.get.mockResolvedValue({ data: { address: 'me@house.test', body: null, updatedAt: null } });
    api.put.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 404 } }));
    editor();
    const box = (await screen.findByLabelText('Signature for me@house.test')) as HTMLTextAreaElement;
    await waitFor(() => expect(box).toBeEnabled());
    fireEvent.change(box, { target: { value: 'Deniz' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the signature' }));
    expect(await screen.findByTestId('setup-signature-failed')).toHaveTextContent(
      'This house does not send from me@house.test any more. Nothing was saved.',
    );
    expect(box.value).toBe('Deniz');
  });

  it('an unread signature says so and cannot be overwritten blind', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 500 } }));
    editor();
    expect(await screen.findByTestId('setup-signature-unread')).toHaveTextContent('That does not mean there is none.');
    expect(screen.getByLabelText('Signature for me@house.test')).toBeDisabled();
  });
});
