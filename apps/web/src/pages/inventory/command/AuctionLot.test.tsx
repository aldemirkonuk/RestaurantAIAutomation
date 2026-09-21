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
 * their own (`20260921113900_an_auction_lot_keeps_its_own_details.sql`),
 * linked to the `restaurant_inventory` row `onCarry` hands back. The old
 * "must never look like it saved them" line is now the opposite: it must
 * never look like it did NOT save them, and it must never let a lot without
 * a chosen currency through — never inferred.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const wines = vi.hoisted(() => ({ search: vi.fn() }));
const auctionApi = vi.hoisted(() => ({ createAuctionLotRecord: vi.fn() }));

vi.mock('@/services/api/wines', () => ({
  searchWines: (...a: unknown[]) => wines.search(...a),
}));
vi.mock('@/services/api/client', () => ({
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));
vi.mock('@/services/api/inventory', () => ({
  createAuctionLotRecord: (...a: unknown[]) => auctionApi.createAuctionLotRecord(...a),
}));

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
  fireEvent.change(screen.getByTestId('auction-currency'), { target: { value: 'USD' } });
  fireEvent.change(screen.getByTestId('auction-bottles'), { target: { value: bottles } });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  wines.search.mockReset().mockResolvedValue([WINE]);
  auctionApi.createAuctionLotRecord.mockReset().mockResolvedValue({ id: 'rec-1' });
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

  it('will not carry a lot whose record would be refused — house, lot number and sale date are held back like the currency, and named', async () => {
    const { onCarry } = draw();
    await fillALot('6');
    expect(screen.getByTestId('auction-carry')).not.toBeDisabled();
    expect(screen.queryByTestId('auction-details-missing')).not.toBeInTheDocument();
    for (const [id, words] of [
      ['auction-house', 'the auction house'],
      ['auction-lot', 'the lot number'],
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
        currency: 'USD',
        bottles: 6,
      }),
    );
    expect(await screen.findByTestId('auction-done')).toHaveTextContent(/were saved/);
    expect(screen.getByTestId('auction-done')).not.toHaveTextContent(/NOT saved/);
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
