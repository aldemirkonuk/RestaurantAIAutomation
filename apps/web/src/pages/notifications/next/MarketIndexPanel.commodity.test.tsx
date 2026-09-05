/**
 * The commodity context line's render contract.
 *
 * The founder's call of 2026-09-05 — *"Both: the line now, the alert behind a
 * flag"* — turns into five assertions this file makes:
 *
 *  - the line CARRIES ITS PROVENANCE: the series' title, its issuer, the
 *    observation's own PERIOD, the base it is stated against, its unit, and
 *    whose date it is;
 *  - "issued" is earned, never assumed. FAO's CSV states no date at all, so its
 *    line reads "read on"; ONS stamps one on every observation, so its line
 *    reads "issued". Two series, two words, both measured;
 *  - an index number is NEVER rendered as money — no currency symbol, ever;
 *  - a house with no mapping sees the series list AND a sentence saying nothing
 *    here is about anything it buys yet. Nothing proposes a mapping;
 *  - the silences do not look alike, and none of them is an empty row.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockIndex = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('./useHouseIndex', () => ({
  INDEX_POLL_MS: 300_000,
  useHouseIndex: () => mockIndex.current,
}));

const mockCommodity = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('./useHouseCommodity', () => ({
  COMMODITY_POLL_MS: 300_000,
  useHouseCommodity: () => mockCommodity.current,
}));

import MarketIndexPanel from './MarketIndexPanel';

const INDEX_READY = {
  state: 'ready',
  failure: null,
  jurisdiction: null,
  requested: 'me',
  lines: [],
  sources: [],
  silence: 'This house has no state recorded.',
  heldBooks: 0,
  refresh: vi.fn(),
};

const COMMODITY_READY = {
  state: 'ready',
  failure: null,
  jurisdiction: null,
  requested: null,
  series: [] as Array<Record<string, unknown>>,
  fetchArmed: false,
  silence: null as string | null,
  noExposureRecorded: false,
  refresh: vi.fn(),
};

/** The real FAO row, as `GET /commodity-index/me` sends it. */
function fao(over: Record<string, unknown> = {}) {
  return {
    seriesKey: 'fao.food_price_index.all',
    issuer: 'Food and Agriculture Organization of the United Nations',
    issuerJurisdiction: 'WORLD',
    seriesTitle: 'FAO Food Price Index',
    sourceUrl: 'https://www.fao.org/media/docs/…/food_price_indices_data.csv',
    valueKind: 'index_number',
    unit: 'Index, base year = 100',
    basePeriod: '2014-2016=100',
    currency: null,
    priceBasis: null,
    cadence: 'monthly',
    licence: 'unstated',
    attribution: null,
    redistribution: 'unstated',
    admission: 'fetch',
    armed: false,
    withheld: null,
    silent: null,
    latest: {
      periodStart: '2026-08-01',
      periodGrain: 'month',
      value: 133.3,
      // FAO's CSV states no date, so this is OUR read and the basis says so.
      issuedAt: '2026-09-05T00:00:00.000Z',
      issuedAtBasis: 'fetch_date',
      fetchedAt: '2026-09-05T00:00:00.000Z',
      vintage: null,
    },
    stale: false,
    staleReason: null,
    observationCount: 440,
    exposures: [],
    note: null,
    awaitingHumanDownload: false,
    statute: null,
    effectiveFrom: null,
    duty: null,
    armedBy: null,
    ...over,
  };
}

/** The real ONS row. */
function ons(over: Record<string, unknown> = {}) {
  return {
    ...fao(),
    seriesKey: 'ons.d7bu.cpi_food_and_non_alcoholic_beverages',
    issuer: 'Office for National Statistics',
    issuerJurisdiction: 'GB',
    seriesTitle: 'CPI INDEX 01 : FOOD AND NON-ALCOHOLIC BEVERAGES 2015=100',
    basePeriod: '2015=100',
    licence: 'Open Government Licence v3.0',
    attribution:
      'Contains public sector information licensed under the Open Government Licence v3.0.',
    redistribution: 'attribution_required',
    latest: {
      periodStart: '2026-07-01',
      periodGrain: 'month',
      value: 144,
      // ONS stamps a date on every observation, so this one is the ISSUER's.
      issuedAt: '2026-08-18T23:00:00.000Z',
      issuedAtBasis: 'issuer_stated',
      fetchedAt: '2026-09-05T00:00:00.000Z',
      vintage: null,
    },
    observationCount: 463,
    ...over,
  };
}

beforeEach(() => {
  mockIndex.current = { ...INDEX_READY };
  mockCommodity.current = { ...COMMODITY_READY };
});

describe('the context line carries its whole provenance', () => {
  it('prints the title, the value, the unit, the base and the OBSERVATION’S own period', () => {
    mockCommodity.current = { ...COMMODITY_READY, series: [fao()] };
    render(<MarketIndexPanel />);
    expect(screen.getByText('FAO Food Price Index')).toBeTruthy();
    expect(screen.getByText('133.3')).toBeTruthy();
    expect(
      screen.getByText(/Index, base year = 100 · base 2014-2016=100 · August 2026/),
    ).toBeTruthy();
  });

  it('says "read on" for a series whose publisher states no date', () => {
    // Measured: the FAO CSV carries no release date, no revision date and no
    // "generated on" line. Printing our read as "issued" would manufacture
    // provenance in the one place a reader looks for it.
    mockCommodity.current = { ...COMMODITY_READY, series: [fao()] };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(
        /Public index · Food and Agriculture Organization of the United Nations · read on Sep 5, 2026/,
      ),
    ).toBeTruthy();
  });

  it('says "issued" for ONS, which stamps a date on every observation', () => {
    mockCommodity.current = { ...COMMODITY_READY, series: [ons()] };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(
        /Public index · Office for National Statistics · issued Aug 18, 2026/,
      ),
    ).toBeTruthy();
  });

  it('NEVER renders an index number as money', () => {
    mockCommodity.current = { ...COMMODITY_READY, series: [fao(), ons()] };
    const { container } = render(<MarketIndexPanel />);
    const section = container.querySelector('section[aria-labelledby="nt-commodity"]')!;
    expect(section.textContent).not.toMatch(/[$£€₺]/);
    expect(section.textContent).toContain('133.3');
    expect(section.textContent).toContain('144');
  });

  it('carries the licence with the number, in both of its states', () => {
    mockCommodity.current = { ...COMMODITY_READY, series: [fao(), ons()] };
    render(<MarketIndexPanel />);
    // Unstated is recorded as unstated, never upgraded to permitted.
    expect(
      screen.getByText(/states no licence for this series. Recorded as unstated/),
    ).toBeTruthy();
    // And where the licence requires attribution, the attribution travels.
    expect(
      screen.getByText(/Contains public sector information licensed under the Open Government Licence v3\.0\./),
    ).toBeTruthy();
  });
});

describe('the section makes no claim about what this house will pay', () => {
  it('says so on the face of it', () => {
    mockCommodity.current = { ...COMMODITY_READY, series: [fao()] };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(
        /Context, not a forecast: none of these says what this house will pay/,
      ),
    ).toBeTruthy();
  });

  it('tells a house with no mapping that none of this is about anything it buys yet', () => {
    mockCommodity.current = {
      ...COMMODITY_READY,
      series: [fao()],
      noExposureRecorded: true,
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText('FAO Food Price Index')).toBeTruthy();
    expect(
      screen.getByText(/none of these numbers is about anything you buy yet/),
    ).toBeTruthy();
    expect(screen.getByText(/typed by a person and is never guessed/)).toBeTruthy();
  });

  it('names a mapping when one exists, and says the pass-through is unmeasured', () => {
    mockCommodity.current = {
      ...COMMODITY_READY,
      series: [
        fao({
          exposures: [
            {
              id: 'e1',
              houseItemId: 'i1',
              passThrough: null,
              passThroughBasis: 'unset',
              lagDays: null,
              lagBasis: 'unset',
              note: null,
            },
          ],
        }),
      ],
    };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(/mapped one of this house’s items to this series/),
    ).toBeTruthy();
    expect(
      screen.getByText(/never measured how much of a move in it reaches an invoice/),
    ).toBeTruthy();
  });
});

describe('the silences do not look alike, and none of them is an empty row', () => {
  it('a register that could not be read is UNKNOWN, not empty', () => {
    mockCommodity.current = {
      ...COMMODITY_READY,
      state: 'unreadable',
      failure: { message: 'Network Error', status: null, forbidden: false },
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/unknown, not empty/)).toBeTruthy();
  });

  it('a refusal names the role rule rather than claiming the register is silent', () => {
    mockCommodity.current = {
      ...COMMODITY_READY,
      state: 'unreadable',
      failure: { message: 'Forbidden', status: 403, forbidden: true },
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/owner and manager only/)).toBeTruthy();
  });

  it('a series with no observation prints the endpoint’s sentence, not a dash', () => {
    mockCommodity.current = {
      ...COMMODITY_READY,
      series: [
        fao({
          latest: null,
          stale: null,
          observationCount: 0,
          note: 'This register holds no observation of this series yet. Nothing is claimed about where it stands.',
        }),
      ],
    };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(/holds no observation of this series yet/),
    ).toBeTruthy();
  });

  it('names the 403 on a series that may not be fetched, rather than hiding it', () => {
    mockCommodity.current = {
      ...COMMODITY_READY,
      series: [
        fao({
          seriesKey: 'usda_ams.shell_egg_index.national',
          seriesTitle: 'Daily National Shell Egg Index Report (5-day rolling average)',
          issuer: 'USDA Agricultural Marketing Service',
          valueKind: 'price',
          admission: 'upload_only',
          latest: null,
          stale: null,
          observationCount: null,
          withheld: {
            reason:
              'www.ams.usda.gov/robots.txt returns HTTP 403, so this host’s crawl rules cannot be read and nothing may be fetched from it.',
            measuredOn: '2026-09-05',
          },
          note: 'This series is registered and is not fetched: www.ams.usda.gov/robots.txt returns HTTP 403.',
        }),
      ],
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/Not fetched:/)).toBeTruthy();
    expect(screen.getByText(/measured 2026-09-05/)).toBeTruthy();
    // A price series says so in its own label, so an index and a price are
    // never read as the same kind of number.
    expect(screen.getByText(/Public price series · USDA Agricultural Marketing Service/)).toBeTruthy();
  });

  it('says a stale series is held back, in the gate’s own words', () => {
    mockCommodity.current = {
      ...COMMODITY_READY,
      series: [
        fao({
          stale: true,
          staleReason:
            'the newest posting is 3110 days old, past the 70-day cadence this source is allowed (a 200 OK is not freshness)',
        }),
      ],
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/Held back as out of date/)).toBeTruthy();
    expect(screen.getByText(/a 200 OK is not freshness/)).toBeTruthy();
  });
});

describe('the commodity section is independent of the posted-price register', () => {
  it('still draws when the posted-price register could not be read', () => {
    // Two endpoints over two tables. Hiding one behind the other's failure
    // would make a working register look silent.
    mockIndex.current = {
      ...INDEX_READY,
      state: 'unreadable',
      failure: { message: 'Network Error', status: null, forbidden: false },
    };
    mockCommodity.current = { ...COMMODITY_READY, series: [fao()] };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/The price index could not be read/)).toBeTruthy();
    expect(screen.getByText('FAO Food Price Index')).toBeTruthy();
  });
});


describe('a rate is a series, and it is drawn as neither an index nor a price', () => {
  function hmrc(over: Record<string, unknown> = {}) {
    return fao({
      seriesKey: 'hmrc.alcohol_duty.spirits_and_wine_8_5_to_22',
      issuer: 'HM Revenue & Customs',
      issuerJurisdiction: 'GB',
      seriesTitle: 'Alcohol Duty rates, wine and spirits 8.5% to 22% ABV',
      valueKind: 'rate',
      unit: 'GBP per litre of pure alcohol',
      basePeriod: null,
      currency: 'GBP',
      licence: 'Open Government Licence v3.0',
      attribution:
        'Contains public sector information licensed under the Open Government Licence v3.0.',
      redistribution: 'attribution_required',
      admission: 'upload_only',
      awaitingHumanDownload: true,
      statute:
        'Finance (No. 2) Act 2023, Part 2; rates as amended in force 1 February 2026',
      effectiveFrom: '2026-02-01',
      duty: {
        supported: true,
        sentence:
          'A per-bottle duty is size x strength x rate. This product records no alcohol-by-volume for any bottle today, so the figure is derivable in principle and not yet computable in fact — somebody has to type the strength.',
      },
      latest: null,
      stale: null,
      observationCount: null,
      note: 'This series is registered and waits for a person’s own download.',
      ...over,
    });
  }

  it('labels it a published rate, not an index and not a price', () => {
    mockCommodity.current = { ...COMMODITY_READY, series: [hmrc()] };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/Published rate · HM Revenue & Customs/)).toBeTruthy();
  });

  it('names its statute and the day it took effect', () => {
    // A rate without its instrument is a rumour.
    mockCommodity.current = { ...COMMODITY_READY, series: [hmrc()] };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(/Finance \(No\. 2\) Act 2023, Part 2.*in force from 2026-02-01/),
    ).toBeTruthy();
  });

  it('prints whether a per-bottle duty can be derived, with its basis', () => {
    mockCommodity.current = { ...COMMODITY_READY, series: [hmrc()] };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/Per bottle: A per-bottle duty is size x strength x rate/)).toBeTruthy();
    expect(screen.getByText(/somebody has to type the strength/)).toBeTruthy();
  });

  it('says a source waiting on a human download is not a working feed', () => {
    mockCommodity.current = { ...COMMODITY_READY, series: [hmrc()] };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/Waiting on a person’s own download/)).toBeTruthy();
    expect(screen.getByText(/nothing is claimed about where it stands/)).toBeTruthy();
  });

  it('distinguishes read-but-unusable from unreadable, for the ÖTV case', () => {
    mockCommodity.current = {
      ...COMMODITY_READY,
      series: [
        hmrc({
          seriesKey: 'gib.otv_iii_a.asgari_maktu',
          issuer: 'Gelir İdaresi Başkanlığı',
          silent: {
            reason:
              'The schedule states an exact TL figure and does NOT state what the figure is per.',
            measuredOn: '2026-09-05',
          },
          duty: {
            supported: false,
            sentence:
              'Gelir İdaresi Başkanlığı does not state what this figure is per, so no per-bottle duty can be derived from it at all.',
          },
        }),
      ],
    };
    render(<MarketIndexPanel />);
    expect(screen.getByText(/Held as published, and not derived from:/)).toBeTruthy();
    expect(screen.getByText(/no per-bottle duty can be derived from it at all/)).toBeTruthy();
  });
});

describe('an armed series says who armed it and on which numbers', () => {
  it('draws the arming line only when the series is armed', () => {
    mockCommodity.current = {
      ...COMMODITY_READY,
      series: [
        fao({
          armed: true,
          armedBy: {
            label: 'founder',
            at: '2026-09-05T18:00:00.000Z',
            proposalHash: 'abcdef0123456789abcdef',
          },
        }),
      ],
    };
    render(<MarketIndexPanel />);
    expect(
      screen.getByText(/Armed for alerting by founder on Sep 5, 2026, on the calibration abcdef012345/),
    ).toBeTruthy();
  });

  it('draws nothing about arming on an unarmed series', () => {
    mockCommodity.current = { ...COMMODITY_READY, series: [fao()] };
    render(<MarketIndexPanel />);
    expect(screen.queryByText(/Armed for alerting/)).toBeNull();
  });
});
