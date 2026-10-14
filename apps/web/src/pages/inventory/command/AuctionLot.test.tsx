/**
 * "Carry this bottle · an auction lot" — the owed act on `/inventory`.
 *
 * THE REGRESSION IS THE WHOLE ACT. `AuctionPurchaseModal.tsx:133` is unreachable
 * (the gateway's own flag registry says so) AND points at two routes that do not
 * exist — `POST /wines/research` and `POST /wines/auction-purchase`, zero matches
 * in `apps/api-gateway/src`. It also used raw axios, so it carried no token. So
 * there is no prior version of this act to regress against; every assertion here
 * is new behaviour, and `carries the bottles in through the book's own write` is
 * the one that matters.
 *
 * UPDATED 2026-09-21 (founder answer 2, "Build all now"): the lot's own
 * details — auction house, lot number, sale date, hammer price and premium
 * WITH a currency — are now written to `auction_lot_records`, a table of
 * their own (`20261116100400_an_auction_lot_keeps_its_own_details.sql`),
 * linked to the `restaurant_inventory` row `onCarry` hands back. The old
 * "must never look like it saved them" line is now the opposite: it must
 * never look like it did NOT save them, and it must never let a lot without
 * a chosen currency through — never inferred.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const wines = vi.hoisted(() => ({ search: vi.fn() }));
const auctionApi = vi.hoisted(() => ({ createAuctionLotRecord: vi.fn() }));
const house = vi.hoisted(() => ({ currency: vi.fn() }));

vi.mock('@/services/api/wines', () => ({
  searchWines: (...a: unknown[]) => wines.search(...a),
}));
vi.mock('@/services/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/client')>('@/services/api/client');
  return {
    getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
    getErrorStatus: actual.getErrorStatus,
    isUnconfirmedWrite: actual.isUnconfirmedWrite,
  };
});
vi.mock('@/services/api/inventory', () => ({
  createAuctionLotRecord: (...a: unknown[]) => auctionApi.createAuctionLotRecord(...a),
}));
vi.mock('@/services/api/settings', () => ({
  settingsApi: { houseCurrency: () => house.currency() },
}));
// ADR 0341 F3: the house's tax basis, unset unless a case says otherwise.
const getTaxBasis = vi.hoisted(() => vi.fn());
vi.mock('@/pages/settings/next/TaxBasisSection', () => ({ getTaxBasis }));

import { AuctionLotStart, lotCost, lotWords, EMPTY_LOT } from './AuctionLotStart';

const WINE = { id: 'w1', name: 'Barolo Monfortino', producer: 'Giacomo Conterno', vintage: 2016 };

function draw(over: Partial<React.ComponentProps<typeof AuctionLotStart>> = {}) {
  const onCarry = vi.fn().mockResolvedValue({ inventoryId: 'inv-1' });
  render(<AuctionLotStart open onClose={() => {}} onCarry={onCarry} {...over} />);
  return { onCarry };
}

/** Pick a bottle and fill a lot that resolves, including its currency. */
async function fillALot(bottles = '6') {
  fireEvent.change(screen.getByTestId('auction-search'), { target: { value: 'Barolo' } });
  fireEvent.click(await screen.findByTestId('auction-pick', undefined, { timeout: 2000 }));
  fireEvent.change(screen.getByTestId('auction-house'), { target: { value: "Christie's" } });
  fireEvent.change(screen.getByTestId('auction-lot'), { target: { value: '112' } });
  fireEvent.change(screen.getByTestId('auction-date'), { target: { value: '2026-09-01' } });
  fireEvent.change(screen.getByTestId('auction-hammer'), { target: { value: '1200' } });
  fireEvent.change(screen.getByTestId('auction-premium'), { target: { value: '300' } });
  fireEvent.change(screen.getByTestId('auction-currency'), { target: { value: 'GBP' } });
  fireEvent.change(screen.getByTestId('auction-bottles'), { target: { value: bottles } });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  wines.search.mockReset().mockResolvedValue([WINE]);
  auctionApi.createAuctionLotRecord.mockReset().mockResolvedValue({ id: 'rec-1' });
  // A house that keeps its books in the lot's own currency, unless a test says otherwise.
  house.currency.mockReset().mockResolvedValue({ readable: true, code: 'GBP' });
  getTaxBasis.mockReset().mockResolvedValue({ readable: true, basis: 'unset', taxWord: 'KDV' });
});

describe('lotCost — the working, and what it refuses', () => {
  it('divides hammer plus premium over the bottles, and shows the working', () => {
    const c = lotCost({ ...EMPTY_LOT, hammer: '1200', premium: '300', bottles: '6' });
    expect(c).toMatchObject({ ok: true, total: 1500, perBottle: 250 });
    expect(c.ok && c.working).toBe('1200 hammer + 300 premium = 1500, over 6 bottles = 250 each.');
  });

  it('refuses an UNSTATED premium and says why zero is different', () => {
    const c = lotCost({ ...EMPTY_LOT, hammer: '1200', premium: '', bottles: '6' });
    expect(c.ok).toBe(false);
    expect(!c.ok && c.why).toMatch(/If there was none, type 0/);
    // Stating zero is a real answer and resolves.
    expect(lotCost({ ...EMPTY_LOT, hammer: '1200', premium: '0', bottles: '6' }).ok).toBe(true);
  });

  it('refuses an unstated hammer price, a negative figure and a fractional bottle count', () => {
    expect(lotCost({ ...EMPTY_LOT, premium: '0', bottles: '1' }).ok).toBe(false);
    expect(lotCost({ ...EMPTY_LOT, hammer: '-5', premium: '0', bottles: '1' }).ok).toBe(false);
    expect(lotCost({ ...EMPTY_LOT, hammer: '10', premium: '-1', bottles: '1' }).ok).toBe(false);
    expect(lotCost({ ...EMPTY_LOT, hammer: '10', premium: '0', bottles: '1.5' }).ok).toBe(false);
    expect(lotCost({ ...EMPTY_LOT, hammer: '10', premium: '0', bottles: '0' }).ok).toBe(false);
  });

  it('rounds the per-bottle figure to the money it is', () => {
    const c = lotCost({ ...EMPTY_LOT, hammer: '100', premium: '0', bottles: '3' });
    expect(c.ok && c.perBottle).toBe(33.33);
  });

  it('does not need a currency to compute — currency gates the button, not the arithmetic', () => {
    // EMPTY_LOT.currency is '' — lotCost is silent about it either way.
    expect(lotCost({ ...EMPTY_LOT, hammer: '10', premium: '0', bottles: '1' }).ok).toBe(true);
  });
});

/**
 * F-832: "£1,250" from a London catalogue was read with a Turkish house's "."
 * mark and booked as 1.25. A lot in other money is read without the house's
 * mark and a lone mark before three digits is asked; a lot in the house's own
 * money is asked only when the house and the screen read it differently.
 */
describe('lotCost — a figure that reads two ways is asked (F-832)', () => {
  const lot = { ...EMPTY_LOT, hammer: '1,250', premium: '0', bottles: '1' };

  it('asks for a lot in another currency, whatever the house and the screen do', () => {
    const c = lotCost(lot, '.', { screen: '.', foreignCurrency: 'GBP' });
    expect(c.ok).toBe(false);
    expect(!c.ok && c.why).toMatch(/^The hammer price: “1,250” could be .* or .*: this lot is in GBP/);
  });

  it('asks when the house and the screen read the house’s own money differently', () => {
    const c = lotCost(lot, '.', { screen: ',' });
    expect(!c.ok && c.why).toMatch(/^The hammer price: “1,250” could be/);
  });

  it('reads 1250 where the house and the screen both group with ","', () => {
    expect(lotCost(lot, ',', { screen: ',' })).toMatchObject({ ok: true, total: 1250 });
  });

  it('a figure that reads one way is untouched by the lot’s currency', () => {
    const c = lotCost({ ...lot, hammer: '1.250,00' }, '.', { screen: ',', foreignCurrency: 'GBP' });
    expect(c).toMatchObject({ ok: true, total: 1250 });
  });
});

describe('lotWords — what to copy somewhere that keeps it', () => {
  it('names what was typed, and says when nothing was', () => {
    expect(lotWords(EMPTY_LOT)).toBe('no auction details were typed');
    expect(lotWords({ ...EMPTY_LOT, house: "Christie's", lotNumber: '112', saleDate: '2026-09-01' })).toBe(
      "Christie's · lot 112 · 2026-09-01",
    );
  });
});

describe('the sheet', () => {
  it('is a sheet, named by its contract, closing in words', () => {
    draw();
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('.mdv-ovl')).toHaveAttribute('data-shape', 'sheet');
    expect(dialog).toHaveAttribute('data-motion', 'tuck');
    expect(screen.getByRole('button', { name: 'Put it down' })).toBeInTheDocument();
  });

  it('carries the bottles in through the book’s own write', async () => {
    const { onCarry } = draw();
    await fillALot('6');
    expect(screen.getByTestId('auction-working')).toHaveTextContent('= 250 each');
    fireEvent.click(screen.getByTestId('auction-carry'));
    await waitFor(() =>
      expect(onCarry).toHaveBeenCalledWith({
        wine: expect.objectContaining({ id: 'w1' }),
        quantity: 6,
        costPerBottle: 250,
      }),
    );
  });

  it('cannot be carried until a bottle, a resolvable lot AND a currency are all there', async () => {
    draw();
    expect(screen.getByTestId('auction-carry')).toBeDisabled();
    await fillALot('6');
    expect(screen.getByTestId('auction-carry')).not.toBeDisabled();
    fireEvent.change(screen.getByTestId('auction-premium'), { target: { value: '' } });
    expect(screen.getByTestId('auction-carry')).toBeDisabled();
    fireEvent.change(screen.getByTestId('auction-premium'), { target: { value: '300' } });
    expect(screen.getByTestId('auction-carry')).not.toBeDisabled();
    // Currency alone, never inferred: clearing it back out holds the button
    // exactly as an unstated premium does.
    fireEvent.change(screen.getByTestId('auction-currency'), { target: { value: '' } });
    expect(screen.getByTestId('auction-carry')).toBeDisabled();
  });

  it('will not carry a lot whose record would be refused — house and sale date are held back like the currency, and named', async () => {
    const { onCarry } = draw();
    await fillALot('6');
    expect(screen.getByTestId('auction-carry')).not.toBeDisabled();
    expect(screen.queryByTestId('auction-details-missing')).not.toBeInTheDocument();
    for (const [id, words] of [
      ['auction-house', 'the auction house'],
      ['auction-date', 'the sale date'],
    ] as const) {
      const kept = (screen.getByTestId(id) as HTMLInputElement).value;
      fireEvent.change(screen.getByTestId(id), { target: { value: '' } });
      expect(screen.getByTestId('auction-carry')).toBeDisabled();
      expect(screen.getByTestId('auction-details-missing')).toHaveTextContent(words);
      fireEvent.change(screen.getByTestId(id), { target: { value: kept } });
    }
    expect(screen.getByTestId('auction-carry')).not.toBeDisabled();
    expect(onCarry).not.toHaveBeenCalled();
  });

  it('saves the lot’s own details, WITH the chosen currency, once the stock is carried', async () => {
    const { onCarry } = draw();
    await fillALot('6');
    fireEvent.change(screen.getByTestId('auction-house'), { target: { value: "Christie's" } });
    fireEvent.change(screen.getByTestId('auction-lot'), { target: { value: '112' } });
    fireEvent.change(screen.getByTestId('auction-date'), { target: { value: '2026-09-01' } });
    fireEvent.click(screen.getByTestId('auction-carry'));
    await waitFor(() => expect(onCarry).toHaveBeenCalled());
    await waitFor(() =>
      expect(auctionApi.createAuctionLotRecord).toHaveBeenCalledWith({
        inventoryId: 'inv-1',
        auctionHouse: "Christie's",
        lotNumber: '112',
        saleDate: '2026-09-01',
        hammerPrice: 1200,
        buyersPremium: 300,
        currency: 'GBP',
        bottles: 6,
        exchangeRate: null,
        houseUnitCost: null,
        bookedUnitCost: 250,
      }),
    );
    expect(await screen.findByTestId('auction-done')).toHaveTextContent(/were saved/);
    expect(screen.getByTestId('auction-done')).not.toHaveTextContent(/NOT saved/);
  });

  it('says "nothing was written" only for a refusal, never after a write with no answer (F-338)', async () => {
    const onCarry = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('timeout of 30000ms exceeded'), { isAxiosError: true, code: 'ECONNABORTED', request: {} }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('This wine is already in inventory'), {
          isAxiosError: true,
          request: {},
          response: { status: 409, data: { message: 'This wine is already in inventory' } },
        }),
      );
    draw({ onCarry });
    await fillALot('6');
    fireEvent.click(screen.getByTestId('auction-carry'));
    const said = await screen.findByTestId('auction-failure');
    expect(said).toHaveTextContent(/They may already be in the book/);
    expect(said).not.toHaveTextContent(/Nothing was written/);

    // The second try meets the 409: the first carry landed (F-338, the
    // "already in the book" arm), so nothing more was carried.
    fireEvent.click(screen.getByTestId('auction-carry'));
    await waitFor(() => expect(screen.getByTestId('auction-failure')).toHaveTextContent(/already in the book.*Nothing more was carried/s));
  });

  it('the lot number is optional: a lot without one carries and is recorded as not stated (founder answer 11)', async () => {
    const { onCarry } = draw();
    await fillALot('6');
    fireEvent.change(screen.getByTestId('auction-lot'), { target: { value: '   ' } });
    expect(screen.getByTestId('auction-carry')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('auction-carry'));
    await waitFor(() => expect(onCarry).toHaveBeenCalled());
    await waitFor(() =>
      expect(auctionApi.createAuctionLotRecord).toHaveBeenCalledWith(expect.objectContaining({ lotNumber: null })),
    );
  });

  describe('a lot in another currency (founder answer 10)', () => {
    beforeEach(() => {
      house.currency.mockResolvedValue({ readable: true, code: 'EUR' });
    });

    it('is not carried until the person states a rate or types the house cost, and nothing is looked up', async () => {
      draw();
      await fillALot('6');
      await waitFor(() => expect(screen.getByTestId('auction-booked')).toHaveTextContent(/state the exchange rate you used, or type what each bottle cost in EUR/));
      expect(screen.getByTestId('auction-carry')).toBeDisabled();
    });

    it('books the per-bottle cost at the STATED rate, and records the rate', async () => {
      const { onCarry } = draw();
      await fillALot('6');
      fireEvent.change(await screen.findByTestId('auction-rate'), { target: { value: '1.17' } });
      expect(screen.getByTestId('auction-booked')).toHaveTextContent('The book is given 292.5 EUR a bottle: 250 GBP at the rate you stated.');
      fireEvent.click(screen.getByTestId('auction-carry'));
      await waitFor(() => expect(onCarry).toHaveBeenCalledWith(expect.objectContaining({ costPerBottle: 292.5 })));
      await waitFor(() =>
        expect(auctionApi.createAuctionLotRecord).toHaveBeenCalledWith(
          expect.objectContaining({ exchangeRate: 1.17, houseUnitCost: null, bookedUnitCost: 292.5 }),
        ),
      );
    });

    it('a typed house cost WINS, and the rate is still recorded beside it', async () => {
      const { onCarry } = draw();
      await fillALot('6');
      fireEvent.change(await screen.findByTestId('auction-rate'), { target: { value: '1.17' } });
      fireEvent.change(screen.getByTestId('auction-house-cost'), { target: { value: '290' } });
      expect(screen.getByTestId('auction-booked')).toHaveTextContent(/290 EUR a bottle, as you typed it; the rate you stated is recorded beside it/);
      fireEvent.click(screen.getByTestId('auction-carry'));
      await waitFor(() => expect(onCarry).toHaveBeenCalledWith(expect.objectContaining({ costPerBottle: 290 })));
      await waitFor(() =>
        expect(auctionApi.createAuctionLotRecord).toHaveBeenCalledWith(
          expect.objectContaining({ exchangeRate: 1.17, houseUnitCost: 290, bookedUnitCost: 290 }),
        ),
      );
    });

    it('a house currency that could not be read books nothing, and says so', async () => {
      house.currency.mockRejectedValue(new Error('down'));
      draw();
      await fillALot('6');
      await waitFor(() => expect(screen.getByTestId('auction-booked')).toHaveTextContent(/currency could not be read/));
      expect(screen.getByTestId('auction-carry')).toBeDisabled();
    });
  });

  it('names the auction record as a SEPARATE fact when the stock carries but the record fails', async () => {
    auctionApi.createAuctionLotRecord.mockRejectedValue(new Error('lot table down'));
    const { onCarry } = draw();
    await fillALot('6');
    fireEvent.click(screen.getByTestId('auction-carry'));
    await waitFor(() => expect(onCarry).toHaveBeenCalled());
    expect(await screen.findByTestId('auction-failure')).toHaveTextContent(
      /carried in.*NOT saved \(lot table down\)/s,
    );
    // The stock write itself is not repeated or rolled back from here.
    expect(onCarry).toHaveBeenCalledTimes(1);
  });

  it('says what did not happen when the stock write itself is refused, and keeps the figures', async () => {
    const onCarry = vi.fn().mockRejectedValue(new Error('shelf locked'));
    draw({ onCarry });
    await fillALot('6');
    fireEvent.click(screen.getByTestId('auction-carry'));
    await waitFor(() =>
      expect(screen.getByTestId('auction-failure')).toHaveTextContent(
        /were not carried in \(shelf locked\)\. Nothing was written/,
      ),
    );
    expect(screen.getByTestId('auction-hammer')).toHaveValue('1200');
    // Refused before the stock write, so the lot record is never attempted.
    expect(auctionApi.createAuctionLotRecord).not.toHaveBeenCalled();
  });

  // F-338: a timeout can land after the bottles were booked; the sheet must
  // not say "nothing was written", and a second try that meets the 409 says so.
  it('after a timeout, says the bottles may already be in the book, never "nothing was written"', async () => {
    const onCarry = vi.fn().mockRejectedValue(
      Object.assign(new Error('timeout of 30000ms exceeded'), { isAxiosError: true, request: {} }),
    );
    draw({ onCarry });
    await fillALot('6');
    fireEvent.click(screen.getByTestId('auction-carry'));
    const failure = await screen.findByTestId('auction-failure');
    expect(failure).toHaveTextContent(/may already be in the book.*before carrying them again/s);
    expect(failure).not.toHaveTextContent(/Nothing was written|30000ms/);
    expect(screen.getByTestId('auction-hammer')).toHaveValue('1200');
  });

  it('a carry that meets "already in the book" says so, not "nothing was written"', async () => {
    const onCarry = vi.fn().mockRejectedValue(
      Object.assign(new Error('This wine already exists in inventory.'), {
        response: { status: 409 },
      }),
    );
    draw({ onCarry });
    await fillALot('6');
    fireEvent.click(screen.getByTestId('auction-carry'));
    const failure = await screen.findByTestId('auction-failure');
    expect(failure).toHaveTextContent(/already in the book.*Nothing more was carried/s);
    expect(failure).not.toHaveTextContent(/Nothing was written/);
    expect(auctionApi.createAuctionLotRecord).not.toHaveBeenCalled();
  });

  it('never draws an unreadable register as a register without the bottle', async () => {
    wines.search.mockRejectedValue(new Error('down'));
    draw();
    fireEvent.change(screen.getByTestId('auction-search'), { target: { value: 'Barolo' } });
    expect(
      await screen.findByTestId('auction-register-unreadable', undefined, { timeout: 2000 }),
    ).toHaveTextContent(/not a register without this bottle in it/);
  });

  it('says a real empty answer is empty', async () => {
    wines.search.mockResolvedValue([]);
    draw();
    fireEvent.change(screen.getByTestId('auction-search'), { target: { value: 'Zzz' } });
    expect(
      await screen.findByText(/Nothing in the register matches/, undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });
});

/*
 * ADR 0341 F3 (founder 2026-10-12, S218: "Yes, stamp cost basis"). The lot's
 * booked cost is asked, like the receive form, whether KDV is inside it, at a
 * house whose till prices include tax. Other houses carry exactly as before.
 */
describe('AuctionLotStart — whether tax is inside the booked cost (ADR 0341 F3)', () => {
  it('carries what the owner said at a house whose prices include tax', async () => {
    getTaxBasis.mockResolvedValue({ readable: true, basis: 'prices_include_tax', taxWord: 'KDV' });
    const { onCarry } = draw();
    await fillALot('6');
    fireEvent.click(await screen.findByLabelText('Yes, KDV is inside'));
    fireEvent.click(screen.getByTestId('auction-carry'));
    await waitFor(() =>
      expect(onCarry).toHaveBeenCalledWith(
        expect.objectContaining({ costPerBottle: 250, costTaxBasis: 'includes_tax' }),
      ),
    );
  });

  it('asks nothing, and carries no basis, at a house whose prices are not said to include tax', async () => {
    const { onCarry } = draw();
    await fillALot('6');
    await waitFor(() => expect(getTaxBasis).toHaveBeenCalled());
    expect(screen.queryByTestId('cost-tax-choice')).toBeNull();
    fireEvent.click(screen.getByTestId('auction-carry'));
    await waitFor(() => expect(onCarry).toHaveBeenCalled());
    expect('costTaxBasis' in onCarry.mock.calls[0][0]).toBe(false);
  });
});
