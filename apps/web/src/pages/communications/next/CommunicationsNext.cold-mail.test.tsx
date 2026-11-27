/**
 * A cold ?tab=mail asks for none of Letters' reads (r108 mail-r108-2).
 *
 * #2188 said a cold Mail "asks for neither the book nor the drafts"; the r107
 * walk counted 7 requests under /communications/letters/ on a bare visit,
 * because the page's own drafts hook and the always-mounted composer read on
 * mount. The real hooks run here; only the transport and the Mail tab are
 * replaced, and every GET the page makes is checked against Letters' reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const gets = vi.hoisted(() => ({ list: [] as string[] }));
const auth = vi.hoisted(() => ({ role: 'owner' }));
vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: vi.fn(async (url: string) => {
      gets.list.push(url);
      // One answer every consumer can read: a list that also carries each
      // wrapper key the page's reads unwrap.
      return { data: Object.assign([], { drafts: [], requests: [], entries: [], templates: [], insights: [], queued: [] }) };
    }),
    post: vi.fn(async () => ({ data: {} })),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: auth.role, restaurantId: 'r1' }, activeRestaurantId: 'r1', activeRole: auth.role }),
}));
vi.mock('./MailTab', () => ({ MailTab: () => <section aria-label="Mail" /> }));
vi.mock('./WhoIsWriting', () => ({ default: () => null }));
vi.mock('./QueuedPullBack', () => ({ QueuedPullBack: () => null }));
vi.mock('./useMailData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMailData')>()),
  useMailSummary: () => ({ data: undefined }),
}));

import CommunicationsNext from './CommunicationsNext';

const LETTERS_READS = /\/letters\/(book|drafts|templates|queued|requests)\b/;

function mount(at: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[at]}>
      <QueryClientProvider client={qc}>
        <CommunicationsNext />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('a cold Mail tab does not read Letters', () => {
  beforeEach(() => {
    gets.list.length = 0;
    auth.role = 'owner';
  });

  it.each([['owner'], ['staff']])('?tab=mail as %s asks for no book, drafts, templates, queued or requests', async (role) => {
    auth.role = role;
    mount('/communications?tab=mail');
    await settle();
    expect(gets.list.filter((u) => LETTERS_READS.test(u))).toEqual([]);
  });

  it('a bare /communications opens on Mail and asks for none of them', async () => {
    mount('/communications');
    await settle();
    expect(gets.list.filter((u) => LETTERS_READS.test(u))).toEqual([]);
  });

  it('?tab=letters still reads the drafts and the requests', async () => {
    mount('/communications?tab=letters');
    await waitFor(() => {
      expect(gets.list.some((u) => /\/letters\/drafts/.test(u))).toBe(true);
      expect(gets.list.some((u) => /\/letters\/requests/.test(u))).toBe(true);
    });
  });

  it('the composer reads the book only once it is opened, once', async () => {
    mount('/communications?tab=letters');
    await settle();
    expect(gets.list.filter((u) => /\/letters\/book/.test(u))).toEqual([]);
    fireEvent.click(await screen.findByRole('button', { name: /write a letter/i }));
    await waitFor(() => expect(gets.list.filter((u) => /\/letters\/book/.test(u))).toHaveLength(1));
  });
});
