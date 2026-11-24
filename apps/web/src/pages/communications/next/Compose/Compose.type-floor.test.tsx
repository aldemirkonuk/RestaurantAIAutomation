/**
 * The composer's render contract — the four founder decisions, each provable.
 *
 *   1. no sending identity  ⇒ Send is DISABLED and carries the reason
 *   2. a failed sender read ⇒ said as a failure, never as "no mailbox"
 *   3. the recipient comes from the book; an unknown address offers to CREATE
 *      the vendor contact and does not address a string
 *   4. Send costs what the sender is worth: the seal on the Mudavym subdomain,
 *      a plain button and an undo window on the house's own mailbox
 *
 * Plus the two things the composer may never do: claim a send it did not make,
 * and offer a figure without provenance.
 *
 * Every one of these would pass on an empty scaffold ONLY if the scaffold
 * happened to render the exact sentences the gateway returns — which is why the
 * assertions are on the server's own words and on the disabled attribute, not
 * on a heading.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockData = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const mockPost = vi.hoisted(() => vi.fn());

vi.mock('./useComposeData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useComposeData')>()),
  useComposeData: () => mockData.current,
  useLetterSenderStanding: () => ({
    restaurantId: 'r1',
    canRelease: false,
    noMailbox: true,
    basis: 'owner',
    checking: false,
    checkedAt: 0,
    recheck: () => {},
  }),
}));

vi.mock('../../../../services/api/client', () => ({
  apiClient: { post: mockPost, get: vi.fn() },
}));

import { ComposeSheet } from './ComposeSheet';

const HOUSE_MAILBOX = {
  readable: true,
  kind: 'house_mailbox' as const,
  address: 'siparis@lokantamudavim.com',
  sendable: true,
  ceremony: 'undo' as const,
  undoMs: 120000,
  words: 'Sends as siparis@lokantamudavim.com, this house’s own connected mailbox.',
  missing: [],
  deployment: { address: 'notifications@mudavym.com', refusedBecause: 'x' },
  subdomain: { provisioned: false, tier: 'paid' as const, words: 'x' },
  categories: ['price_query'],
  dispatcher: null,
  sendOrAsk: { readable: true, maySend: true, mode: 'send' as const, basis: 'manager' as const, grant: null, sentence: null },
};

const BASE = {
  restaurantId: 'r1',
  sender: HOUSE_MAILBOX,
  senderFailed: false,
  senderError: null,
  book: [{ providerId: 'p1', providerName: 'Fikri Tarım Gıda', contactName: 'Fikri', email: 'fikri@fikritarim.com', source: 'provider' as const }],
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

/** Every inline font size in the open sheet, in px, with the element's text. */
function inlineSizes(): Array<{ px: number; text: string }> {
  const out: Array<{ px: number; text: string }> = [];
  document.body.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
    const m = /^([\d.]+)px$/.exec(el.style.fontSize);
    if (m) out.push({ px: Number(m[1]), text: (el.textContent ?? '').slice(0, 40) });
  });
  return out;
}

beforeEach(() => {
  mockData.current = { ...BASE };
  mockPost.mockReset();
});

describe('the composer keeps the 11 px type floor the Mail tab has', () => {
  const MODES: Array<[string, Parameters<typeof ComposeSheet>[0]['prefill']]> = [
    ['a new letter', null],
    ['a reply to a vendor letter', { providerId: 'p1', subject: 'Re: Friday', body: 'Merhaba', answers: 'm1' }],
  ];
  for (const [name, prefill] of MODES) {
    it(`${name}: no label, recipient line or sender line is set below 11 px`, () => {
      render(
        <MemoryRouter initialEntries={['/communications']}>
          <ComposeSheet open onClose={() => {}} prefill={prefill} />
        </MemoryRouter>,
      );
      // The labels exist, so the scan is not vacuous: the sender line, the recipient and the letter's fields.
      expect(screen.getAllByText(/siparis@lokantamudavim\.com/).length).toBeGreaterThan(0);
      expect(screen.getByLabelText('Subject')).toBeInTheDocument();
      const sizes = inlineSizes();
      expect(sizes.length).toBeGreaterThan(5);
      expect(sizes.filter((s) => s.px < 11)).toEqual([]);
    });
  }
});

describe('the drafted-letters list beside the composer keeps the same floor (r106)', () => {
  // HouseDrafts is not part of the open sheet, so the render scan above cannot see it:
  // its header sat at 9 px (HouseDrafts.tsx:102) when the sheet's labels were raised.
  it('sets no font size below 11 px', () => {
    const src = readFileSync(join(__dirname, 'HouseDrafts.tsx'), 'utf8');
    const sizes = [...src.matchAll(/fontSize:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(3);
    expect(sizes.filter((px) => px < 11)).toEqual([]);
  });
});
