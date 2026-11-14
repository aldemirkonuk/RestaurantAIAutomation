/**
 * r35 mail, gap 9: a held letter can reach its vendor. A letter the receiving
 * server could not confirm came from its From names the vendor its address
 * belongs to; an owner or a manager can say it is theirs and file it there,
 * after reading what that vouches for. Staff see why they cannot. A letter
 * no single vendor lists, or whose vendor could not be read, says so.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ProspectDto } from '../../../hooks/queries/usePromotionsQueries';

const h = vi.hoisted(() => ({
  strangers: {} as Record<string, unknown>,
  fileHeld: { mutateAsync: vi.fn(), isPending: false },
  putAway: { mutateAsync: vi.fn(), isPending: false },
  auth: {} as Record<string, unknown>,
}));

vi.mock('./useSendersDeskData', () => ({
  SENDERS_SERVER_WINDOWS: { PROSPECTS: 100 },
  useSenderRegister: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useSetSenderTrust: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStrangers: () => h.strangers,
  usePromoteStranger: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePutAwayStranger: () => h.putAway,
  useRestoreStranger: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFileHeldLetter: () => h.fileHeld,
}));
vi.mock('../../../contexts/AuthContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../contexts/AuthContext')>()),
  useAuth: () => h.auth,
}));

import WhoIsWriting from './WhoIsWriting';
import { fmtDay } from './senders-format';

const render = () =>
  rtlRender(
    <MemoryRouter initialEntries={['/communications?senders=open']}>
      <WhoIsWriting />
    </MemoryRouter>,
  );

const held = (over: Partial<ProspectDto> = {}): ProspectDto => ({
  id: 'p-held',
  restaurant_id: 'r1',
  domain: 'dairy.example',
  sender_email: 'orders@dairy.example',
  sender_name: 'Dairy Orders',
  subject: 'Invoice 2211',
  snippet: null,
  body_preview: null,
  capture_reason: 'sender_unconfirmed',
  held_reason: 'sender_unconfirmed',
  held_vendor: { id: 'v-1', name: 'Quiet Dairy' },
  held_vendor_unread: false,
  has_attachments: true,
  attachments: [],
  message_count: 1,
  status: 'new',
  first_seen_at: '2026-11-12T09:30:00Z',
  last_seen_at: '2026-11-12T09:30:00Z',
  ...over,
});
const ok = (data: unknown) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
const FILE_ASK = `It is from Quiet Dairy: file it there… (Invoice 2211, ${fmtDay('2026-11-12T09:30:00Z')})`;

beforeEach(() => {
  vi.clearAllMocks();
  h.fileHeld.isPending = false;
  h.strangers = ok([held()]);
  h.auth = {
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    availableRestaurants: [{ id: 'r1', name: 'Müdavim Brooklyn', city: null, chain_id: null, chain_name: null }],
  };
});

describe('an owner files a held letter under its vendor', () => {
  it('asks first, saying what filing vouches for, and files nothing on the first click', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: FILE_ASK }));
    const ask = screen.getByRole('group', { name: 'File it under Quiet Dairy' });
    expect(ask).toHaveTextContent(
      'The receiving mail server could not confirm orders@dairy.example sent this letter. Filing it under Quiet Dairy says you know it is theirs: it joins their mail, and its files go where their files go, so an invoice in it is read as theirs.',
    );
    expect(h.fileHeld.mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: FILE_ASK })).toBeNull();
  });

  it('files it on confirm, then says where it went and links its thread in Mail', async () => {
    h.fileHeld.mutateAsync.mockResolvedValue({
      filed: true,
      conversationId: 'c-1',
      threadKey: 'gm:t-1',
      providerId: 'v-1',
      providerName: 'Quiet Dairy',
      alreadyStored: false,
    });
    render();
    fireEvent.click(screen.getByRole('button', { name: FILE_ASK }));
    fireEvent.click(screen.getByRole('button', { name: 'File it under Quiet Dairy' }));
    expect(h.fileHeld.mutateAsync).toHaveBeenCalledWith('p-held');
    const done = await screen.findByRole('status');
    expect(done).toHaveTextContent('Dairy Orders — filed under Quiet Dairy.');
    expect(within(done).getByRole('link', { name: 'Open it in Mail' })).toHaveAttribute(
      'href',
      '/communications?tab=mail&with=vendor%3Av-1&thread=gm%3At-1',
    );
    expect(screen.queryByRole('group', { name: 'File it under Quiet Dairy' })).toBeNull();
  });

  it('Cancel closes the ask and files nothing', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: FILE_ASK }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'File it under Quiet Dairy' })).toBeNull();
    expect(screen.getByRole('button', { name: FILE_ASK })).toBeInTheDocument();
    expect(h.fileHeld.mutateAsync).not.toHaveBeenCalled();
  });

  it('a refusal is said next to the act, in the gateway words, and the ask stays open', async () => {
    h.fileHeld.mutateAsync.mockRejectedValue({
      response: { status: 409, data: { message: 'That letter is already filed under a vendor.' } },
    });
    render();
    fireEvent.click(screen.getByRole('button', { name: FILE_ASK }));
    fireEvent.click(screen.getByRole('button', { name: 'File it under Quiet Dairy' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Filing Dairy Orders under Quiet Dairy was not saved (That letter is already filed under a vendor.).',
    );
    expect(screen.getByRole('group', { name: 'File it under Quiet Dairy' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows it is working while the filing is on its way, and takes no second click', () => {
    const view = render();
    fireEvent.click(screen.getByRole('button', { name: FILE_ASK }));
    h.fileHeld.isPending = true;
    view.rerender(
      <MemoryRouter initialEntries={['/communications?senders=open']}>
        <WhoIsWriting />
      </MemoryRouter>,
    );
    const going = screen.getByRole('button', { name: 'Filing…' });
    expect(going).toBeDisabled();
    expect(going).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Put Dairy Orders away' })).toBeDisabled();
  });
});

describe('who may file it, and when there is nothing to file under', () => {
  it('staff see the act disabled and why', () => {
    h.auth = { ...h.auth, activeRole: 'staff' };
    render();
    const b = screen.getByRole('button', { name: FILE_ASK });
    expect(b).toBeDisabled();
    expect(screen.getByText('Only an owner or manager can file it under Quiet Dairy.')).toBeInTheDocument();
  });

  it('says so when no single vendor lists the address, with no act', () => {
    h.strangers = ok([held({ held_vendor: null })]);
    render();
    expect(screen.getByText('No single vendor in your book lists orders@dairy.example, so it cannot be filed under one.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /file it there/ })).toBeNull();
  });

  it('says the book was unread rather than that no vendor lists it', () => {
    h.strangers = ok([held({ held_vendor: null, held_vendor_unread: true })]);
    render();
    expect(screen.getByText('Which vendor lists orders@dairy.example could not be read just now, so it cannot be filed yet.')).toBeInTheDocument();
    expect(screen.queryByText(/No single vendor/)).toBeNull();
    expect(screen.queryByRole('button', { name: /file it there/ })).toBeNull();
  });

  it('offers nothing for a letter whose sender could not be read, or a stranger, or an older gateway', () => {
    h.strangers = ok([
      held({ id: 'a', held_reason: 'sender_unreadable', held_vendor: undefined, held_vendor_unread: undefined }),
      held({ id: 'b', held_reason: null, capture_reason: 'attachment', held_vendor: undefined, held_vendor_unread: undefined, sender_name: 'Rep' }),
      held({ id: 'c', held_vendor: undefined, held_vendor_unread: undefined, sender_name: 'Old' }),
      // A From the server could not vouch for at all: even if a vendor lists the
      // address it claims, that claim is the thing nobody can check.
      held({ id: 'd', held_reason: 'sender_unreadable', sender_name: 'Forged' }),
    ]);
    render();
    expect(screen.queryByRole('button', { name: /file it there/ })).toBeNull();
    expect(screen.queryByText(/No single vendor|could not be read just now/)).toBeNull();
  });

  it("another house's held letter carries no file act", () => {
    h.strangers = ok([held({ restaurant_id: 'r2' })]);
    h.auth = {
      ...h.auth,
      availableRestaurants: [
        { id: 'r1', name: 'Müdavim Brooklyn', city: null, chain_id: null, chain_name: null },
        { id: 'r2', name: 'Müdavim Queens', city: null, chain_id: null, chain_name: null },
      ],
    };
    render();
    expect(screen.queryByRole('button', { name: /file it there/ })).toBeNull();
  });
});

// r37 walk w3 M-F3: focus is kept on the file-under act, and two held rows
// from one vendor are told apart by name.
describe('the file-under ask keeps the keyboard where it was', () => {
  it('takes focus when it opens, and gives it back to its button on Cancel', () => {
    render();
    const opener = screen.getByRole('button', { name: FILE_ASK });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'File it under Quiet Dairy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: FILE_ASK }));
  });

  it('Escape closes the ask like Cancel, files nothing, and gives focus back', () => {
    render();
    fireEvent.click(screen.getByRole('button', { name: FILE_ASK }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'File it under Quiet Dairy' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'File it under Quiet Dairy' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: FILE_ASK }));
    expect(h.fileHeld.mutateAsync).not.toHaveBeenCalled();
  });

  it('two held letters from one vendor get two names, each starting with what the button shows', () => {
    h.strangers = ok([
      held({ id: 'p-1', subject: 'Bank details changed' }),
      held({ id: 'p-2', subject: '  ' }),
    ]);
    render();
    const names = screen
      .getAllByRole('button', { name: /^It is from Quiet Dairy: file it there…/ })
      .map((b) => b.getAttribute('aria-label'));
    const day = fmtDay('2026-11-12T09:30:00Z');
    expect(names).toEqual([
      `It is from Quiet Dairy: file it there… (Bank details changed, ${day})`,
      `It is from Quiet Dairy: file it there… (no subject, ${day})`,
    ]);
    for (const b of screen.getAllByRole('button', { name: /^It is from Quiet Dairy/ }))
      expect(b).toHaveTextContent('It is from Quiet Dairy: file it there…');
  });
});
