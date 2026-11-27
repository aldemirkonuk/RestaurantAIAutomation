/**
 * The composer says, before Send, when a vendor's answer to the letter will
 * not reach Mail (r36 mail audit, gap 1).
 *
 * A letter written here leaves from the house's own mailbox. When the
 * deployment has no Mudavym address for the answer to come back to, and
 * nothing reads that mailbox, the answer lands where Mail never looks. The
 * gateway states that as `conversation.answerReachesMail === false`; the
 * sheet says it in one line with the way to Mail setup, and Send stays
 * open, so a day-1 owner can still write.
 */
import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('./useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useComposeData')>()),
  useComposeData: () => mockData.current,
  useLetterSenderStanding: () => ({
    restaurantId: 'r1',
    canRelease: true,
    noMailbox: false,
    basis: 'owner',
    checking: false,
    checkedAt: 0,
    recheck: () => {},
  }),
}));

vi.mock('../../../../services/api/client', () => ({
  apiClient: { post: vi.fn(), get: vi.fn() },
}));

import { ComposeSheet } from './ComposeSheet';

const SENDER = {
  kind: 'house_mailbox' as const,
  address: 'owner@house.test',
  sendable: true,
  ceremony: 'undo' as const,
  undoMs: 120000,
  words: 'Sends from owner@house.test, your own connected mailbox.',
  missing: [],
  deployment: { address: 'notifications@mudavym.com', refusedBecause: '' },
  subdomain: { provisioned: false, tier: 'paid' as const, words: '' },
  categories: [],
  dispatcher: null,
  sendOrAsk: {
    readable: true,
    maySend: true,
    mode: 'send' as const,
    basis: 'owner' as const,
    grant: null,
    sentence: null,
  },
};

function data(sender: Record<string, unknown> | null) {
  return {
    restaurantId: 'r1',
    sender,
    senderFailed: false,
    senderError: null,
    book: [
      {
        providerId: 'p1',
        providerName: 'Fikri Tarım Gıda',
        contactName: 'Fikri',
        email: 'fikri@fikritarim.com',
        source: 'provider' as const,
      },
    ],
    bookFailed: false,
    bookError: null,
    byProvider: new Map(),
    templates: [],
    templatesFailed: false,
    templatesError: null,
    insights: [],
    insightsFailed: false,
    insightsError: null,
    queued: [],
    queuedFailed: false,
    refetchQueued: vi.fn(),
  };
}

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>;
}

function open(sender: Record<string, unknown> | null, onClose = vi.fn(), onHold = vi.fn()) {
  mockData.current = data(sender);
  render(
    <MemoryRouter initialEntries={['/communications?tab=letters']}>
      <Routes>
        <Route
          path="/communications"
          element={
            <>
              <ComposeSheet open onClose={onClose} onHold={onHold} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { onClose, onHold };
}

const withAnswer = (answerReachesMail: boolean | null | undefined) => ({
  ...SENDER,
  conversation: {
    where: 'letters_leave_only',
    words: '…',
    ...(answerReachesMail === undefined ? {} : { answerReachesMail }),
  },
});

describe('the composer says where a vendor answer goes', () => {
  it('names the unread mailbox before Send, and leaves Send to the writer', () => {
    open(withAnswer(false));
    const note = screen.getByTestId('answer-unseen');
    expect(note).toHaveTextContent(
      "A vendor's answer to this letter goes back to owner@house.test. Nothing here reads that mailbox, so the answer will not show in Mail.",
    );
    fireEvent.click(screen.getByText('Fikri Tarım Gıda'));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Prices' } });
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba,' } });
    expect(screen.getByTestId('letter-send')).toBeEnabled();
  });

  it('with no recorded address, names the mailbox by what it is', () => {
    open({ ...withAnswer(false), address: null });
    expect(screen.getByTestId('answer-unseen')).toHaveTextContent(
      "goes back to the mailbox it leaves from. Nothing here reads that mailbox",
    );
  });

  it('says nothing when the answer reaches Mail, when it is not known, or on an older gateway', () => {
    for (const v of [true, null, undefined] as const) {
      open(withAnswer(v));
      expect(screen.queryByTestId('answer-unseen')).toBeNull();
      cleanup();
    }
  });

  it('says nothing for a house with no mailbox to send from', () => {
    open({ ...withAnswer(false), kind: 'none', sendable: false, address: null });
    expect(screen.queryByTestId('answer-unseen')).toBeNull();
  });

  it('says nothing for a mailbox that cannot send', () => {
    open({ ...withAnswer(false), sendable: false });
    expect(screen.queryByTestId('answer-unseen')).toBeNull();
  });

  it('Mail setup opens the setup page and keeps the words written so far', () => {
    const { onClose, onHold } = open(withAnswer(false));
    fireEvent.change(screen.getByLabelText('The letter'), { target: { value: 'Merhaba,' } });
    fireEvent.click(screen.getByTestId('answer-unseen-setup'));
    expect(screen.getByTestId('where')).toHaveTextContent('/communications?tab=mail&setup=1');
    expect(onHold).toHaveBeenCalledWith(expect.objectContaining({ body: 'Merhaba,' }));
    expect(onClose).toHaveBeenCalled();
  });
});
