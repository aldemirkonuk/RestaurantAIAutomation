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

/**
 * The commodity context section draws inside this box (2026-09-05). It is
 * stubbed to a ready-and-empty register here so that these assertions stay
 * about the POSTED-PRICE register they were written for; the commodity
 * section's own contract is tested in `MarketIndexPanel.commodity.test.tsx`.
 */
const mockCommodity = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('./useHouseCommodity', () => ({
  COMMODITY_POLL_MS: 300_000,
  useHouseCommodity: () => mockCommodity.current,
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
  heldBooks: 0 as number | null,
  heldBookHoldHours: 24 as number | null,
  carriedBooks: [] as Array<Record<string, unknown>> | null,
  refresh: vi.fn(),
};

/** Shaped exactly like `IndexLine` from `price-index.service.ts:31-60`. */
function line(over: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    sourceClass: 'retail_reference',
    issuer: 'Iowa Alcoholic Beverages Division',
    issuedAt: '2026-09-01',
    issuedAtBasis: 'issuer_stated',
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
    sourceKey: 'iowa-liquor-products',
    fetchedAt: '2026-09-05T06:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  mockIndex.current = { ...READY };
  // 'loading' on purpose: this file's assertions are about the POSTED-PRICE
  // register, and a commodity section in any other state renders a second
  // role="status" that `getByRole('status')` would find alongside the one the
  // assertion means. Its own states are covered in
  // `MarketIndexPanel.commodity.test.tsx`.
  mockCommodity.current = {
    state: 'loading',
    failure: null,
    jurisdiction: null,
    requested: null,
    series: [],
    fetchArmed: false,
    silence: null,
    noExposureRecorded: false,
    refresh: vi.fn(),
  };
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
    expect(screen.getByRole('heading', { name: /Retail reference · US-IA/ })).toBeTruthy();
    expect(screen.getByText(/Templeton Rye 4yr/)).toBeTruthy();
    expect(screen.getByText('$34.99')).toBeTruthy();
    // Posted unit and basis, not a 750ml normalisation of them.
    expect(screen.getByText(/750ml · per bottle · to retail_shelf/)).toBeTruthy();
    expect(
      screen.getByText(
        /Retail reference · Iowa Alcoholic Beverages Division · issued Sep 1, 2026/,
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
      screen.getByText(/is ever placed beside, ranked against or averaged with a vendor quote/),
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

  it('says "read on", never "issued", for a row dated by our own read', () => {
    // ADR 0117 Q27. A merchant shop publishes no date, so the register files
    // the day WE read the page under `issued_at` and labels it `fetch_date`.
    // Printing that as "issued" would put our clock in the one place a reader
    // looks for the publisher's.
    //
    // PROVED AGAINST THE PRE-FIX PANEL, 2026-09-05: a verbatim `git show HEAD:`
    // copy was written to a same-depth probe (`__PrefixProbePanel.tsx`), this
    // spec repointed at it, run, and both files deleted. HEAD failed this case
    // and the two beside it, rendering a Berry Bros row as
    // "Control-state shelf price · GB-ENG" with "issued Sep 5, 2026" — a class
    // label that is false for a merchant and our own read date presented as the
    // shop's publication.
    mockIndex.current = {
      ...READY,
      jurisdiction: 'GB-ENG',
      lines: [
        line({
          issuer: 'Berry Bros. & Rudd',
          issuedAt: '2026-09-05',
          issuedAtBasis: 'fetch_date',
          currency: 'GBP',
        }),
      ],
    };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(/Retail reference · Berry Bros\. & Rudd · read on Sep 5, 2026/),
    ).toBeTruthy();
    expect(screen.queryByText(/issued Sep 5, 2026/)).toBeNull();
  });

  it('a row written before the basis column existed gets the weaker wording', () => {
    // NULL basis means nobody recorded whose date it is. An unknown is never
    // upgraded by rendering, so it reads "read on" rather than "issued".
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-IA',
      lines: [line({ issuedAtBasis: null })],
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/· read on Sep 1, 2026/)).toBeTruthy();
    expect(screen.queryByText(/· issued Sep 1, 2026/)).toBeNull();
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

/**
 * Q24, 2026-09-05. The founder, shown that the only public UK source found is
 * Defra's wholesale produce list: *"Show it, labelled as produce, in its own
 * box"* — an honest index of a market the house also buys from, never beside a
 * wine quote, with the label saying what it is.
 *
 * PROVED AGAINST THE PRE-FIX COMPONENT, 2026-09-05. A probe copy of HEAD's
 * `MarketIndexPanel.tsx` (renamed only) was rendered with these exact rows and
 * then deleted; the run is in ADR 0117's review trail. It measured:
 *
 *   ulCount            1        both rows in ONE list
 *   headings           ["Control-state shelf price · GB-ENG"]
 *   produceLabel       absent   the word "produce" appeared nowhere
 *   list text          "Templeton Rye 4yr · Templeton $34.99 750ml · per bottle
 *                       … cabbage, hearts £0.62 — · per kg …"
 *
 * So the pre-fix panel put a GBP 0.62 cabbage directly beneath a $34.99 bottle
 * of rye, in one list, under a heading announcing the whole box as a
 * CONTROL-STATE SHELF PRICE — which the produce rows are not. That is what
 * these assertions stop.
 */
const PRODUCE_SOURCE = {
  key: 'defra-wholesale-fruit-veg',
  sourceClass: 'public_index',
  issuer: 'Department for Environment, Food & Rural Affairs',
  cadence: 'fortnightly (a new edition roughly every second Monday)',
  withheld: null,
  display: {
    category: 'Wholesale produce',
    shortIssuer: 'Defra',
    extent: 'England and Wales',
  },
  rows: 55,
};

function produceLine(over: Record<string, unknown> = {}) {
  return line({
    id: 'p1',
    sourceKey: 'defra-wholesale-fruit-veg',
    sourceClass: 'public_index',
    issuer: 'Department for Environment, Food & Rural Affairs',
    issuedAt: '2026-08-31',
    issuedAtBasis: 'issuer_stated',
    priceBasis: 'average wholesale market price',
    productName: 'cabbage, hearts',
    brand: null,
    price: 0.62,
    currency: 'GBP',
    priceUnit: 'per kg',
    sizeValue: null,
    sizeUnit: null,
    sourceUrl: 'https://www.gov.uk/government/statistical-data-sets/wholesale-fruit-and-vegetable-prices-weekly-average',
    fetchedAt: '2026-09-05T06:00:00.000Z',
    ...over,
  });
}

describe('MarketIndexPanel — the produce index draws in its own box (Q24)', () => {
  beforeEach(() => {
    mockIndex.current = { ...READY };
  });

  it('titles the box with the category, the issuer, the extent and OUR read date', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'GB-ENG',
      lines: [produceLine()],
      sources: [PRODUCE_SOURCE],
    };
    render(<MarketIndexPanel />);
    // "read on", never "issued": the date is a claim about us, and it is the
    // one date this box can always stand behind.
    expect(
      screen.getByRole('heading', {
        name: /Wholesale produce · Defra · England and Wales · read on Sep 5, 2026/,
      }),
    ).toBeTruthy();
  });

  it('says in words that it is not a drinks price', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'GB-ENG',
      lines: [produceLine()],
      sources: [PRODUCE_SOURCE],
    };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(/not a drinks price and is never compared with one/i),
    ).toBeTruthy();
  });

  it('keeps a produce row OUT of the drinks list, in its own section', () => {
    // The pre-fix panel put both rows in one <ul> under one heading. Here the
    // rye is in the drinks list and the cabbage is not.
    mockIndex.current = {
      ...READY,
      jurisdiction: 'GB-ENG',
      lines: [line(), produceLine()],
      sources: [PRODUCE_SOURCE],
    };
    const { container } = render(<MarketIndexPanel />);
    const lists = container.querySelectorAll('ul');
    expect(lists.length).toBe(2);
    const drinksList = lists[0].textContent ?? '';
    const produceList = lists[1].textContent ?? '';
    expect(drinksList).toContain('Templeton Rye 4yr');
    expect(drinksList).not.toContain('cabbage');
    expect(produceList).toContain('cabbage, hearts');
    expect(produceList).not.toContain('Templeton Rye 4yr');
  });

  it('does not announce the whole register as the produce class', () => {
    // The main heading names the DRINKS class held. With only produce rows it
    // must not read "Public index · GB-ENG" as though a drinks list existed.
    mockIndex.current = {
      ...READY,
      jurisdiction: 'GB-ENG',
      lines: [produceLine()],
      sources: [PRODUCE_SOURCE],
    };
    render(<MarketIndexPanel />);
    expect(
      screen.getByRole('heading', { name: /Posted price index · GB-ENG/ }),
    ).toBeTruthy();
  });

  it('prints the endpoint sentence naming the produce list and the switch when nothing is fetched yet', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'GB-ENG',
      lines: [],
      sources: [PRODUCE_SOURCE],
      silence:
        'No drinks price is published in the United Kingdom. What was found is Defra\'s wholesale produce list for England and Wales, shown separately and labelled as produce. Wholesale produce (Defra, England and Wales) is the one public list found for this house, and it has not been read yet: the scheduled fetch is off until PRICE_INDEX_FETCH_ENABLED is set on the deployment.',
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/labelled as produce/)).toBeTruthy();
    expect(
      screen.getByText(/PRICE_INDEX_FETCH_ENABLED is set on the deployment/),
    ).toBeTruthy();
    // and no produce box, because there is nothing in it
    expect(screen.queryByRole('heading', { name: /Wholesale produce/ })).toBeNull();
  });

  it('draws a drinks posting exactly as before when no source is labelled', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-IA',
      lines: [line()],
      sources: [{ ...PRODUCE_SOURCE, key: 'iowa-liquor-products', display: null }],
    };
    const { container } = render(<MarketIndexPanel />);
    expect(container.querySelectorAll('ul').length).toBe(1);
    expect(screen.queryByRole('heading', { name: /Wholesale produce/ })).toBeNull();
    expect(screen.getByText(/Templeton Rye 4yr/)).toBeTruthy();
  });
});

/**
 * A hand-carried book that nobody has admitted (ADR 0128).
 *
 * The case that matters is the LAST one: a jurisdiction that already draws an
 * admitted edition while a new book waits. A label that appeared only on an
 * empty panel would hide the waiting book at exactly the moment the panel
 * looked healthy.
 */
describe('MarketIndexPanel — a book waiting for a second pair of eyes', () => {
  it('says so, in the singular, and says nothing is drawn from it', () => {
    mockIndex.current = { ...READY, jurisdiction: 'US-MI', heldBooks: 1 };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(/A price book brought in by hand is waiting for a second pair of eyes/),
    ).toBeTruthy();
    expect(screen.getByText(/until an owner or manager\s+admits it/)).toBeTruthy();
  });

  it('counts them when there is more than one', () => {
    mockIndex.current = { ...READY, jurisdiction: 'US-MI', heldBooks: 3 };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(/3 price books brought in by hand are waiting/),
    ).toBeTruthy();
  });

  it('draws nothing when the gateway could not answer — null is not zero', () => {
    mockIndex.current = { ...READY, jurisdiction: 'US-MI', heldBooks: null };
    render(<MarketIndexPanel />);
    expect(screen.queryByText(/waiting for a second pair of eyes/)).toBeNull();
  });

  it('still says so while an ADMITTED edition is being drawn', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-IA',
      lines: [line()],
      heldBooks: 1,
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/Templeton Rye 4yr/)).toBeTruthy();
    expect(
      screen.getByText(/waiting for a second pair of eyes/),
    ).toBeTruthy();
  });
});

/**
 * The hold's length, printed (ADR 0128 Q2), and the basis a carried book that
 * IS drawn was let in on (Q4).
 *
 * The case that carries the decision is `same_person`: the founder allowed a
 * lone owner-or-manager to admit their own book *"with reason + record"*, and
 * the record is only a control if the reader is told, in words, that nobody
 * else looked.
 */
describe('MarketIndexPanel — the hold and the basis', () => {
  const SHA = 'a'.repeat(64);

  it('prints how long a waiting book waits rather than implying it', () => {
    mockIndex.current = { ...READY, jurisdiction: 'US-MI', heldBooks: 1, heldBookHoldHours: 24 };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/After 24 hours the people who could act are told again/)).toBeTruthy();
  });

  it('omits the hold sentence when the gateway sent no number', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-MI',
      heldBooks: 1,
      heldBookHoldHours: null,
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/waiting for a second pair of eyes/)).toBeTruthy();
    expect(screen.queryByText(/hours the people who could act/)).toBeNull();
  });

  it('says a lone admission was NOT a second pair of eyes, and gives the reason', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-MI',
      lines: [line({ uploadSha256: SHA })],
      carriedBooks: [
        {
          sha256: SHA,
          fileName: '8-3-25-PRICE-BOOK-EXCEL.xlsx',
          editionDate: '2025-08-03',
          basis: 'same_person',
          reason: 'I am the only manager in Michigan and I re-downloaded it.',
          admittedAt: '2026-09-05T09:00:00Z',
        },
      ],
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/this is not a second pair of eyes/)).toBeTruthy();
    expect(
      screen.getByText(/Reason given: I am the only manager in Michigan/),
    ).toBeTruthy();
  });

  it('names a byte match as the independent fetch it is', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-MI',
      lines: [line({ uploadSha256: SHA })],
      carriedBooks: [
        {
          sha256: SHA,
          fileName: 'book.xlsx',
          editionDate: '2025-08-03',
          basis: 'byte_match',
          reason: null,
          admittedAt: '2026-09-05T09:00:00Z',
        },
      ],
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/matched it byte for byte/)).toBeTruthy();
    expect(screen.queryByText(/Reason given/)).toBeNull();
  });

  it('annotates only books whose lines are actually on screen', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-MI',
      lines: [line({ uploadSha256: null })],
      carriedBooks: [
        {
          sha256: SHA,
          fileName: 'elsewhere.xlsx',
          editionDate: '2025-08-03',
          basis: 'same_person',
          reason: 'reason',
          admittedAt: null,
        },
      ],
    };
    render(<MarketIndexPanel />);
    expect(screen.queryByText(/elsewhere.xlsx/)).toBeNull();
  });

  it('draws no basis at all when the gateway could not answer', () => {
    mockIndex.current = {
      ...READY,
      jurisdiction: 'US-MI',
      lines: [line({ uploadSha256: SHA })],
      carriedBooks: null,
    };
    render(<MarketIndexPanel />);
    expect(screen.queryByText(/brought in by hand and/)).toBeNull();
  });
});
