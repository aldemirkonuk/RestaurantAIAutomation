/**
 * The posted-price index register's render contract.
 *
 * The founder's call of 2026-09-04 — *"Run it, labelled tier 4, never beside a
 * quote"*, *"Show as a labelled index line, own register"* — turns into four
 * assertions this file makes and the scaffold could not pass:
 *
 *  - a line is LABELLED: its class, its issuer, its issue date, its posted unit
 *    and basis are all on the line, and the price is printed as posted;
 *  - the four silences are told apart, each in the endpoint's own words: no
 *    state recorded, an unrecognised jurisdiction, a state with no posting
 *    regime, and a register that could not be read;
 *  - a withheld publisher (Michigan) is NAMED even when the register is silent
 *    for some other reason — absence is never reported as health;
 *  - it never prints an empty box and never prints a zero.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockIndex = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('./useHouseIndex', () => ({
  INDEX_POLL_MS: 300_000,
  useHouseIndex: () => mockIndex.current,
}));

import MarketIndexPanel from './MarketIndexPanel';

const READY = {
  state: 'ready',
  failure: null,
  jurisdiction: null,
  requested: 'me',
  lines: [] as Array<Record<string, unknown>>,
  sources: [] as Array<Record<string, unknown>>,
  silence: null as string | null,
  refresh: vi.fn(),
};

/** Shaped exactly like `IndexLine` from `price-index.service.ts:31-60`. */
function line(over: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    sourceClass: 'retail_reference',
    issuer: 'Iowa Alcoholic Beverages Division',
    issuedAt: '2026-09-01',
    priceBasis: 'retail_shelf',
    productName: 'Templeton Rye 4yr',
    brand: 'Templeton',
    region: null,
    price: 34.99,
    currency: 'USD',
    priceUnit: 'per bottle',
    sizeValue: 750,
    sizeUnit: 'ml',
    packageDesc: null,
    sourceUrl: 'https://iowaabd.com',
    ...over,
  };
}

beforeEach(() => {
  mockIndex.current = { ...READY };
});

describe('MarketIndexPanel — the index line is its own labelled register', () => {
  it('prints the line with its class, issuer, date, posted unit and basis', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-IA',
      lines: [line()],
    };
    render(<MarketIndexPanel />);

    // The heading names the CLASS actually held, not a generic "index".
    expect(screen.getByRole('heading', { name: /Control-state shelf price · US-IA/ })).toBeTruthy();
    expect(screen.getByText(/Templeton Rye 4yr/)).toBeTruthy();
    expect(screen.getByText('$34.99')).toBeTruthy();
    // Posted unit and basis, not a 750ml normalisation of them.
    expect(screen.getByText(/750ml · per bottle · to retail_shelf/)).toBeTruthy();
    expect(
      screen.getByText(
        /Control-state shelf price · Iowa Alcoholic Beverages Division · issued Sep 1, 2026/,
      ),
    ).toBeTruthy();
  });

  it('says out loud that an index line is never compared with a vendor quote', () => {
    mockIndex.current = { ...READY, jurisdiction: 'US-IA', lines: [line()] };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(/never compared with a price a vendor gave this house/),
    ).toBeTruthy();
    expect(
      screen.getByText(/never placed beside, ranked against or averaged with a vendor quote/),
    ).toBeTruthy();
  });

  it('a posted list is named as such, and its class label is not borrowed from another line', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-CA',
      lines: [line({ sourceClass: 'posted_wholesale_list', issuer: 'California ABC' })],
    };
    render(<MarketIndexPanel />);
    expect(screen.getByRole('heading', { name: /State posted list · US-CA/ })).toBeTruthy();
  });

  it('a date-only issue date is not shifted a day by the browser’s timezone', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-IA',
      lines: [line({ issuedAt: '2026-09-01' })],
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/issued Sep 1, 2026/)).toBeTruthy();
    expect(screen.queryByText(/issued Aug 31, 2026/)).toBeNull();
  });

  it('an unmapped class prints its own key rather than being relabelled', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-IA',
      lines: [line({ sourceClass: 'board_bulletin' })],
    };
    render(<MarketIndexPanel />);
    expect(screen.getByRole('heading', { name: /board_bulletin · US-IA/ })).toBeTruthy();
  });

  it('unknown fields on a line are em dashes, never zeroes', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-IA',
      lines: [
        line({ price: null, priceUnit: null, priceBasis: null, sizeValue: null, issuedAt: null }),
      ],
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/— · — · to —/)).toBeTruthy();
    expect(screen.getByText(/issued —/)).toBeTruthy();
    expect(screen.queryByText('$0.00')).toBeNull();
  });
});

describe('MarketIndexPanel — the four silences, each in the endpoint’s own words', () => {
  it('a house with no state recorded gets the endpoint sentence, not an empty box', () => {
    const silence =
      'This house has no state recorded, so no jurisdiction can be scoped. Set the address in Settings to draw an index line.';
    mockIndex.current = { ...READY, silence };
    render(<MarketIndexPanel />);
    expect(screen.getByRole('status').textContent).toContain(silence);
  });

  it('an unrecognised jurisdiction says so rather than guessing a state', () => {
    const silence =
      '"Turkey" is not a jurisdiction this register recognises. No index line is drawn rather than guessing a state.';
    mockIndex.current = { ...READY, requested: 'Turkey', silence };
    render(<MarketIndexPanel />);
    expect(screen.getByRole('status').textContent).toContain(silence);
  });

  it('a state with no posting regime says no list is known for it', () => {
    const silence =
      'No posted list or public index is known for US-IL. A house here has no index line until one is found.';
    mockIndex.current = { ...READY, jurisdiction: 'US-IL', silence };
    render(<MarketIndexPanel />);
    expect(screen.getByRole('status').textContent).toContain(silence);
  });

  it('a register that could not be read is unknown, and says so', () => {
    const silence = 'The index register could not be read. This is unknown, not empty.';
    mockIndex.current = { ...READY, jurisdiction: 'US-CA', silence };
    render(<MarketIndexPanel />);
    expect(screen.getByRole('status').textContent).toContain(silence);
  });

  it('a silent register with no sentence at all is still unknown, never “nothing is posted”', () => {
    mockIndex.current = { ...READY, jurisdiction: 'US-CA', silence: null };
    render(<MarketIndexPanel />);
    expect(screen.getByRole('status').textContent).toMatch(
      /gave no reason. That is unknown, not "nothing is posted"/,
    );
  });
});

describe('MarketIndexPanel — a withheld publisher is named, not hidden', () => {
  it('names Michigan and its measured reason even while the register is silent', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-MI',
      silence: 'The index register could not be read. This is unknown, not empty.',
      sources: [
        {
          key: 'michigan-lcc-spirits-price-book',
          sourceClass: 'posted_wholesale_list',
          issuer: 'Michigan Liquor Control Commission',
          cadence: 'monthly (spirits price book)',
          withheld: {
            reason:
              'michigan.gov returns 403 to a polite anonymous fetcher (Akamai edge block); robots.txt is also 403; the price book is Excel/PDF, not a machine endpoint. No honest sample exists to parse.',
            measuredOn: '2026-09-04',
          },
          rows: 0,
        },
      ],
    };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(
        /Michigan Liquor Control Commission publishes a state posted list for this state and it is withheld/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Akamai edge block/)).toBeTruthy();
    expect(screen.getByText(/measured 2026-09-04/)).toBeTruthy();
  });

  it('a readable publisher is not announced as withheld', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-CA',
      lines: [line({ sourceClass: 'posted_wholesale_list' })],
      sources: [
        {
          key: 'california-abc-beer-price-posting',
          sourceClass: 'posted_wholesale_list',
          issuer: 'California Department of Alcoholic Beverage Control',
          cadence: 'weekly',
          withheld: null,
          rows: 12,
        },
      ],
    };
    render(<MarketIndexPanel />);
    expect(screen.queryByText(/is withheld/)).toBeNull();
  });
});

describe('MarketIndexPanel — loading and refusal are not emptiness', () => {
  it('draws a skeleton while loading and claims nothing', () => {
    mockIndex.current = { ...READY, state: 'loading' };
    const { container } = render(<MarketIndexPanel />);
    expect(container.querySelector('.nt-skel')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a refusal names the role rule instead of showing an empty register', () => {
    mockIndex.current = {
      ...READY,
      state: 'unreadable',
      failure: { status: 403, message: 'Forbidden', forbidden: true },
    };
    render(<MarketIndexPanel />);
    expect(screen.getByRole('status').textContent).toMatch(
      /refused this account \(403\).*owner and manager only/,
    );
  });

  it('a broken read names the failure and says the box is unknown', () => {
    mockIndex.current = {
      ...READY,
      state: 'unreadable',
      failure: { status: 500, message: 'socket hang up', forbidden: false },
    };
    render(<MarketIndexPanel />);
    expect(screen.getByRole('status').textContent).toMatch(
      /could not be read \(socket hang up\). This box is unknown, not empty/,
    );
  });
});
