/**
 * The P3 truth of the row sheets (INV-W20, W21, W22, W24): an order is placed
 * on Orders and never said to be sent, nothing is ordered from a vendor the
 * book does not hold, a count is blind until it is sealed, and a house with no
 * zones is told so instead of being handed an empty From list.
 *
 * The writes are stubbed at the client; HoldToApprove is the real control,
 * driven by its keyboard path (Enter arms it, Enter again completes it).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { InvRow } from './useInventoryNextData';
import type { Provider } from '../../../services/api/providers';

const api = vi.hoisted(() => ({
  post: vi.fn(),
  submit: vi.fn(),
  transfer: vi.fn(),
  pour: vi.fn(),
  photo: vi.fn(),
  recs: { data: undefined, isError: false } as Record<string, unknown>,
}));

vi.mock('../../../services/api/client', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  apiClient: { post: api.post, get: vi.fn() },
}));
vi.mock('../../../services/api/inventory', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  transferStock: api.transfer,
  recordPour: api.pour,
  estimateCountFromPhoto: api.photo,
}));
vi.mock('../../../lib/spotCountOutbox', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  submitSpotCount: api.submit,
}));
vi.mock('../../cellar/next/useCellarNextData', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useCellarSettings: () => ({ data: { holdCeremony: 'auto' }, loading: false }),
}));
vi.mock('./OrderLetter', () => ({
  default: (p: { orderId: string; vendorName: string }) => <section data-testid="inv-order-letter">letter {p.orderId} to {p.vendorName}</section>,
}));
vi.mock('../../../hooks/queries/useProviderQueries', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useRecommendedProviders: () => api.recs,
}));

import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';
import { CountSheet, MERGE_AGE_MS, OrderSheet, PourSheet, TransferSheet, WriteOffSheet, countGapSentence, orderWasMerged, placedSentence } from './InventorySheets';

function row(over: Partial<InvRow> = {}): InvRow {
  return {
    id: 'i1',
    wineId: 'w1',
    name: 'Barolo',
    libraryName: null,
    producer: null,
    type: 'red',
    kind: 'wine',
    vintage: null,
    grape: null,
    bottleSizeMl: 750,
    stock: 2,
    shadow: null,
    par: 6,
    reorderPoint: null,
    analyticsReadable: true,
    velocity: null,
    runway: null,
    daysSinceSale: null,
    deadStock: false,
    bottle: null,
    glass: null,
    pourMl: null,
    wac: null,
    costProvenance: null,
    value: null,
    lastCountedAt: null,
    openMl: null,
    zones: [{ locationId: null, qty: 2 }],
    providerId: 'p1',
    providerName: 'Enoteca Rossi',
    standing: 'below',
    ...over,
  } as InvRow;
}

const ROSSI = [{ id: 'p1', name: 'Enoteca Rossi' }] as unknown as Provider[];
const BIANCHI = [{ id: 'p2', name: 'Vini Bianchi' }] as unknown as Provider[];

function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Each fireEvent is its own act, so the second Enter sees the armed phase. */
function holdByKeyboard(button: HTMLElement) {
  fireEvent.keyDown(button, { key: 'Enter' });
  fireEvent.keyDown(button, { key: 'Enter' });
}

beforeEach(() => {
  for (const f of [api.post, api.submit, api.transfer, api.pour, api.photo]) f.mockReset();
  api.recs = { data: undefined, isError: false };
});

function answered(status: number, message?: unknown): AxiosError {
  const response = { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: message === undefined ? {} : { message } } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, {}, response);
}
const silent = () => new AxiosError('Network Error', 'ERR_NETWORK', undefined, {}, undefined);
const alertText = async () => (await screen.findByRole('alert')).textContent ?? '';
/** No failure sentence may hand a person the transport's words. */
function noOperatorWords(t: string) {
  expect(t).not.toMatch(/gateway|status code|Network Error|quantityChange/);
}
async function writeOff() {
  mount(<WriteOffSheet row={row()} onClose={() => {}} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Why they left' }), { target: { value: 'breakage' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Bottles' }), { target: { value: '1' } });
  holdByKeyboard(screen.getByRole('button', { name: 'Hold to write off 1' }));
  return alertText();
}

describe('placedSentence (INV-W20, INV-W26)', () => {
  it('says what a new order holds, and leaves "Placed on Orders" to the seal above it (INV-W32)', () => {
    expect(placedSentence({ status: 'pending', quantity: 4 }, 4, 'Enoteca Rossi', false)).toBe(
      '4 bottles from Enoteca Rossi, waiting for approval.',
    );
    expect(placedSentence({ status: 'pending', quantity: 1 }, 1, 'Enoteca Rossi', false)).toBe('1 bottle from Enoteca Rossi, waiting for approval.');
    expect(placedSentence({ status: 'pending' }, null, 'Enoteca Rossi', false)).toBe('From Enoteca Rossi, waiting for approval.');
  });

  it('says a merge into an open order changed that order, with its status and the gateway\'s quantity', () => {
    expect(placedSentence({ status: 'APPROVED', quantity: 4 }, 4, 'Enoteca Rossi', true)).toBe(
      'Enoteca Rossi already had an open order for this title (approved); it now asks for 4. Nothing new was sent from here.',
    );
    expect(placedSentence({ status: 'pending', quantity: 4 }, 4, 'V', true)).toContain('(pending); it now asks for 4');
  });

  it('never says sent', () => {
    for (const status of ['pending', 'approved', 'awaiting_confirmation', undefined]) {
      for (const merged of [true, false]) {
        // "sent" appears only after "Nothing new was".
        expect(placedSentence({ status, quantity: 2 }, 2, 'V', merged)).not.toMatch(/Order sent|(?<!Nothing new was )sent\b/);
      }
    }
  });
});

describe('orderWasMerged (INV-W26)', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  it('reads a status past pending as a merge', () => {
    expect(orderWasMerged({ status: 'APPROVED', requestedAt: '2026-10-01T12:00:00Z' }, now)).toBe(true);
  });
  it('reads a pending order requested long before the hold as a merge', () => {
    expect(orderWasMerged({ status: 'pending', requestedAt: new Date(now - MERGE_AGE_MS - 1000).toISOString() }, now)).toBe(true);
  });
  it('reads a pending order requested just now as new', () => {
    expect(orderWasMerged({ status: 'pending', requestedAt: new Date(now - 2000).toISOString() }, now)).toBe(false);
    expect(orderWasMerged({ status: 'pending' }, now)).toBe(false);
  });
});

describe('countGapSentence (INV-W22)', () => {
  it('names a shortfall', () => {
    expect(countGapSentence(10, 9, 'Barolo')).toBe('Counted 9; the book said 10, so the shelf is 1 short. Barolo now reads 9.');
  });
  it('names an overage', () => {
    expect(countGapSentence(2, 5, 'Barolo')).toBe('Counted 5; the book said 2, so the shelf is 3 over. Barolo now reads 5.');
  });
  it('says a match', () => {
    expect(countGapSentence(4, 4, 'Barolo')).toBe('Counted 4, the same as the book. Barolo still reads 4.');
  });
  it('says there is no gap when the book was unread, never a gap against 0', () => {
    expect(countGapSentence(null, 4, 'Barolo')).toContain('could not be read before, so there is no gap to show');
  });
});

describe('OrderSheet (INV-W20, INV-W21)', () => {
  it('suggests the quantity to par, and the hold places rather than sends', () => {
    mount(<OrderSheet row={row()} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    expect((screen.getByRole('textbox', { name: 'Bottles' }) as HTMLInputElement).value).toBe('4');
    expect(screen.getByRole('button', { name: /Hold to place 4 with Enoteca Rossi/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Order sent|Send it\?/);
  });

  it('offers no made-up quantity when the title is at or above par', () => {
    mount(<OrderSheet row={row({ stock: 10, par: 5 })} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    expect((screen.getByRole('textbox', { name: 'Bottles' }) as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).toContain('It is at or above par, so there is no suggested quantity.');
    expect(document.body.textContent).toContain('Type how many bottles to order.');
    expect(screen.queryByRole('button', { name: /Hold to place/ })).toBeNull();
    // INV-W27: the same not-ready track the other sheets draw, and the body is inset.
    expect((screen.getByRole('button', { name: /Not ready to place/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('.mdv-ovl__body.iv-sheet-body')).not.toBeNull();
  });

  it('does not keep the row\'s vendor when the vendor book does not hold it', () => {
    mount(<OrderSheet row={row()} onClose={() => {}} providers={BIANCHI} providersError={null} restaurantId="r1" />);
    expect(document.body.textContent).toContain('Choose the vendor this order goes to.');
    expect(screen.queryByRole('button', { name: /Hold to place/ })).toBeNull();
  });

  it('says there are no vendors on file and links to add one', () => {
    mount(<OrderSheet row={row()} onClose={() => {}} providers={[]} providersError={null} restaurantId="r1" />);
    expect(document.body.textContent).toContain('This house has no vendors on file yet, so there is no one to order from.');
    expect(screen.getByRole('link', { name: 'Add a vendor' }).getAttribute('href')).toBe('/vendors');
    expect(screen.queryByRole('button', { name: /Hold to place/ })).toBeNull();
  });

  it('after the hold, says the order is placed and opens its email inline (INV-W26)', async () => {
    api.post.mockResolvedValue({ data: { id: 'o1', status: 'pending', quantity: 4, requestedAt: new Date().toISOString() } });
    mount(<OrderSheet row={row()} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    holdByKeyboard(screen.getByRole('button', { name: /Hold to place 4/ }));
    await waitFor(() => expect(document.body.textContent).toContain('4 bottles from Enoteca Rossi, waiting for approval.'));
    expect(screen.getByTestId('inv-order-letter').textContent).toBe('letter o1 to Enoteca Rossi');
    expect(api.post).toHaveBeenCalledWith('/procurement/orders', { inventoryId: 'i1', providerId: 'p1', quantity: 4, unitType: 'bottle' });
  });

  it('after the hold, keeps the seal on screen, says "Placed on Orders" once, and cannot be held again (INV-W32)', async () => {
    api.post.mockResolvedValue({ data: { id: 'o1', status: 'pending', quantity: 4, requestedAt: new Date().toISOString() } });
    mount(<OrderSheet row={row()} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    holdByKeyboard(screen.getByRole('button', { name: /Hold to place 4/ }));
    const seal = await screen.findByRole('button', { name: 'Placed on Orders' });
    expect((seal as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('order-ceremony-sent')).toBeNull();
    expect(document.body.textContent?.split('Placed on Orders').length).toBe(2);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('after a merge, the seal says the open order was changed, not placed (INV-W32)', async () => {
    api.post.mockResolvedValue({ data: { id: 'o9', status: 'approved', quantity: 4 } });
    mount(<OrderSheet row={row()} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    holdByKeyboard(screen.getByRole('button', { name: /Hold to place 4/ }));
    expect(await screen.findByRole('button', { name: 'Changed on Orders' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('Placed on Orders');
  });

  it('after a merge, opens no email and says the earlier one may ask for the old quantity (INV-W26)', async () => {
    api.post.mockResolvedValue({ data: { id: 'o9', status: 'approved', quantity: 4 } });
    mount(<OrderSheet row={row()} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    holdByKeyboard(screen.getByRole('button', { name: /Hold to place 4/ }));
    await waitFor(() => expect(document.body.textContent).toContain('already had an open order for this title (approved)'));
    expect(screen.queryByTestId('inv-order-letter')).toBeNull();
    expect(document.body.textContent).toContain('No new email was drafted for this change.');
  });

  it('says in its footer that the email is read here before it goes, unless the vendor takes emails without review', () => {
    mount(<OrderSheet row={row()} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    expect(document.body.textContent).toContain('shown here to read before it goes');
    expect(document.body.textContent).toContain('take order emails without review');
    expect(document.body.textContent).not.toContain('nothing goes to a vendor from this sheet');
  });
});

describe('CountSheet (INV-W22, blind count)', () => {
  it('starts empty and does not show the book\'s figure before the seal', () => {
    mount(<CountSheet row={row({ stock: 7 })} onClose={() => {}} />);
    expect((screen.getByRole('textbox', { name: 'Bottles counted' }) as HTMLInputElement).value).toBe('');
    expect(document.body.textContent).not.toMatch(/\b7\b/);
    expect(screen.getByRole('button', { name: 'Type the count first' })).toBeDisabled();
  });

  it('after the seal, says the gap against the book as it read when the sheet opened', async () => {
    api.submit.mockResolvedValue({ synced: true });
    mount(<CountSheet row={row({ stock: 7 })} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles counted' }), { target: { value: '5' } });
    holdByKeyboard(screen.getByRole('button', { name: /Hold to record 5/ }));
    await waitFor(() =>
      expect(document.body.textContent).toContain('Counted 5; the book said 7, so the shelf is 2 short. Barolo now reads 5.'),
    );
  });
});

describe('TransferSheet (INV-W24)', () => {
  it('tells a house with no zones that there is nowhere to move to, with no dead controls', () => {
    mount(<TransferSheet row={row()} onClose={() => {}} locations={[]} locationsUnavailable={false} />);
    expect(document.body.textContent).toContain('This house has no zones yet, so there is nowhere to move bottles to.');
    expect(screen.queryByRole('button', { name: /Not ready to move|Hold to move/ })).toBeNull();
    expect(screen.queryByText('From')).toBeNull();
  });

  it('keeps the form when zones exist', () => {
    mount(
      <TransferSheet
        row={row()}
        onClose={() => {}}
        locations={[{ id: 'z1', name: 'Cave' }] as never}
        locationsUnavailable={false}
      />,
    );
    expect(document.body.textContent).not.toContain('no zones yet');
    expect(screen.getByRole('button', { name: 'Not ready to move' })).toBeTruthy();
  });
});

describe('WriteOffSheet words (INV-W30)', () => {
  it('names the house library, not "a library wine", when a row has no library item', () => {
    mount(<WriteOffSheet row={row({ wineId: null })} onClose={() => {}} />);
    expect(document.body.textContent).toContain('This row is not tied to an item in the house’s library, and the ledger needs one');
    expect(document.body.textContent).not.toContain('library wine');
  });
});

describe('Failures in the house\u2019s words (INV-W31)', () => {
  it('a write-off whose server failed is said as unknown, and trying again is safe', async () => {
    api.post.mockRejectedValue(answered(500, 'duplicate key value violates unique constraint'));
    const t = await writeOff();
    expect(t).toContain('The server failed before it could answer, so it is not known whether the write-off was recorded. Trying again is safe: it is recorded once.');
    expect(t).not.toContain('Nothing was written off');
    noOperatorWords(t);
  });

  it('a refused write-off says nothing was written off, in plain words', async () => {
    api.post.mockRejectedValue(answered(400, ['quantityChange must be an integer number']));
    const t = await writeOff();
    expect(t).toContain('Nothing was written off — the server did not accept it as sent.');
    noOperatorWords(t);
  });

  it('a refused write-off keeps the server\u2019s own plain sentence', async () => {
    api.post.mockRejectedValue(answered(400, 'The book holds fewer bottles than that.'));
    expect(await writeOff()).toContain('Nothing was written off — the book holds fewer bottles than that.');
  });

  it('a refused count says nothing was recorded', async () => {
    api.submit.mockRejectedValue(answered(403));
    mount(<CountSheet row={row()} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles counted' }), { target: { value: '5' } });
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 5' }));
    const t = await alertText();
    expect(t).toContain('Nothing was recorded — this account is not allowed to do that in this house.');
    noOperatorWords(t);
  });

  it('a count the device could not hold is said as unknown, never as nothing recorded', async () => {
    api.submit.mockRejectedValue(new Error('QuotaExceededError'));
    mount(<CountSheet row={row()} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles counted' }), { target: { value: '5' } });
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 5' }));
    const t = await alertText();
    expect(t).toContain('This device could not hold the count to send later, so it is not known whether it was recorded. Trying again is safe: it is recorded once.');
    expect(t).not.toContain('Nothing was recorded');
  });

  it('an unanswered transfer is unknown, and says to look before moving again', async () => {
    api.transfer.mockRejectedValue(silent());
    mount(<TransferSheet row={row()} onClose={() => {}} locations={[{ id: 'z1', name: 'Cave' }] as never} locationsUnavailable={false} />);
    const fromBox = screen.getByRole('combobox', { name: 'From' }) as HTMLSelectElement;
    fireEvent.change(fromBox, { target: { value: fromBox.options[fromBox.options.length - 1].value } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: 'z1' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles' }), { target: { value: '1' } });
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to move 1' }));
    const t = await alertText();
    expect(t).toContain('No answer came back, so it is not known whether the bottles moved. Look at where the bottles are on the page before trying again, so they do not move twice.');
    expect(t).not.toContain('Nothing moved');
  });

  it('a pour whose server failed is unknown, and trying again is safe', async () => {
    api.pour.mockRejectedValue(answered(502));
    mount(<PourSheet row={row({ pourMl: 150 })} onClose={() => {}} />);
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 1 × 150 ml' }));
    const t = await alertText();
    expect(t).toContain('The server failed before it could answer, so it is not known whether the pour was recorded. Trying again is safe: it is recorded once.');
    expect(t).not.toContain('Nothing was recorded');
  });

  it('a photo that could not be read says why in plain words', async () => {
    api.photo.mockRejectedValue(silent());
    mount(<CountSheet row={row()} onClose={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'shelf.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(document.body.textContent).toContain('The photo could not be read — no answer came back. Type the count instead.'));
  });

  it('an order whose server failed is unknown, and says to look on Orders instead of trying again', async () => {
    api.post.mockRejectedValue(answered(503));
    mount(<OrderSheet row={row()} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    holdByKeyboard(screen.getByRole('button', { name: /Hold to place 4/ }));
    await waitFor(() =>
      expect(screen.getByTestId('order-ceremony-error').textContent).toBe(
        'It is not known whether the order was placed — the server failed before it could answer. Look on Orders before placing it again.',
      ),
    );
    expect(document.body.textContent).not.toContain('Nothing was placed —');
  });

  it('a refused order says nothing was placed, and to try again', async () => {
    api.post.mockRejectedValue(answered(400, ['providerId must be a UUID']));
    mount(<OrderSheet row={row()} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    holdByKeyboard(screen.getByRole('button', { name: /Hold to place 4/ }));
    await waitFor(() =>
      expect(screen.getByTestId('order-ceremony-error').textContent).toBe('Nothing was placed — the server did not accept it as sent. Try again when ready.'),
    );
  });

  it('re-reads the stock after a write-off whose outcome is unknown', async () => {
    const reread = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    api.post.mockRejectedValue(answered(500));
    await writeOff();
    expect(reread).toHaveBeenCalled();
    reread.mockRestore();
  });

  it('does not re-read after a refused write-off, since nothing changed', async () => {
    const reread = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    api.post.mockRejectedValue(answered(400));
    await writeOff();
    expect(reread).not.toHaveBeenCalled();
    reread.mockRestore();
  });

  it('re-reads the stock after a transfer whose outcome is unknown', async () => {
    const reread = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
    api.transfer.mockRejectedValue(answered(504));
    mount(<TransferSheet row={row()} onClose={() => {}} locations={[{ id: 'z1', name: 'Cave' }] as never} locationsUnavailable={false} />);
    const fromBox = screen.getByRole('combobox', { name: 'From' }) as HTMLSelectElement;
    fireEvent.change(fromBox, { target: { value: fromBox.options[fromBox.options.length - 1].value } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: 'z1' } });
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to move 1' }));
    await alertText();
    expect(reread).toHaveBeenCalled();
    reread.mockRestore();
  });

  it('says the server did not name the order, never "the gateway"', async () => {
    api.post.mockResolvedValue({ data: { status: 'pending', quantity: 4, requestedAt: new Date().toISOString() } });
    mount(<OrderSheet row={row()} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    holdByKeyboard(screen.getByRole('button', { name: /Hold to place 4/ }));
    await waitFor(() => expect(document.body.textContent).toContain('The server did not say which order this is, so its email is on Orders.'));
    expect(document.body.textContent).not.toContain('gateway');
  });

  it('says a failed vendor recommendation was not read, never "fetched"', () => {
    api.recs = { data: undefined, isError: true };
    mount(<OrderSheet row={row()} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    expect(document.body.textContent).toContain('The vendor recommendation could not be read — the list above is the plain roster, unranked.');
    expect(document.body.textContent).not.toContain('fetched');
  });

  it('says why the vendor book could not be read as its own sentence', () => {
    mount(<OrderSheet row={row()} onClose={() => {}} providers={null} providersError="no answer came back" restaurantId="r1" />);
    expect(document.body.textContent).toContain('The vendor book could not be read — no answer came back. No vendor can be chosen, so nothing can be ordered from here.');
  });
});

describe('the borrowed order ceremony takes this page\'s styles (INV-W32)', () => {
  // jsdom applies no stylesheet, so the mapping is read from the files: the
  // classes OrderCeremony draws must each have a rule inside a sheet here.
  it('styles every cellar class the order ceremony draws, inside a sheet', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, 'inventory-next.css'), 'utf8');
    const ceremony = readFileSync(join(__dirname, '../../cellar/next/OrderCeremony.tsx'), 'utf8');
    for (const cls of ['cl-btn', 'cl-said', 'cl-note', 'cl-focus']) expect(ceremony).toContain(cls);
    expect(ceremony).toMatch(/role="alert" className="cl-note"/);
    // Each borrowed class shares this page's own rule, so the two cannot drift.
    const shared = (page: string, borrowed: string) => {
      const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(css).toMatch(new RegExp(`${esc(page)},\\s*${esc(borrowed)} \\{`));
    };
    shared('.iv-btn', '.iv-sheet-body .cl-btn');
    shared(".iv-btn[data-seal='true']", ".iv-sheet-body .cl-btn[data-seal='true']");
    shared('.iv-btn:disabled', '.iv-sheet-body .cl-btn:disabled');
    shared('.iv-said', '.iv-sheet-body .cl-said');
    shared('.iv-focus:focus-visible', '.iv-sheet-body .cl-focus:focus-visible');
    shared('.iv-said-alarm', ".iv-sheet-body .cl-note[role='alert']");
  });
});

describe('counts read with grouped digits, as money does (INV-W33)', () => {
  it('groups a large count, its book figure and the gap', () => {
    expect(countGapSentence(1000, 1240, 'Barolo')).toBe('Counted 1,240; the book said 1,000, so the shelf is 240 over. Barolo now reads 1,240.');
    expect(countGapSentence(2400, 1240, 'Barolo')).toContain('the shelf is 1,160 short');
    expect(countGapSentence(1240, 1240, 'Barolo')).toBe('Counted 1,240, the same as the book. Barolo still reads 1,240.');
    expect(countGapSentence(null, 1240, 'Barolo')).toContain('Counted 1,240. ');
  });

  it('groups what an order holds, and never says "null" for a merged order with no quantity', () => {
    expect(placedSentence({ status: 'pending', quantity: 1200 }, 1200, 'V', false)).toBe('1,200 bottles from V, waiting for approval.');
    expect(placedSentence({ status: 'pending', quantity: 1200 }, 1200, 'V', true)).toContain('it now asks for 1,200.');
    const none = placedSentence({ status: 'pending' }, null, 'V', true);
    expect(none).toBe('V already had an open order for this title (pending); Orders shows what it now asks for. Nothing new was sent from here.');
    expect(none).not.toContain('null');
  });

  it('groups the order sheet\'s suggestion and hold, and leaves the box bare', () => {
    mount(<OrderSheet row={row({ stock: 0, par: 1200 })} onClose={() => {}} providers={ROSSI} providersError={null} restaurantId="r1" />);
    expect((screen.getByRole('textbox', { name: 'Bottles' }) as HTMLInputElement).value).toBe('1200');
    expect(document.body.textContent).toContain('1,200 bring it back to par (1,200).');
    expect(screen.getByRole('button', { name: 'Hold to place 1,200 with Enoteca Rossi' })).toBeTruthy();
  });

  it('groups the count sheet\'s hold', () => {
    mount(<CountSheet row={row()} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles counted' }), { target: { value: '1240' } });
    expect(screen.getByRole('button', { name: 'Hold to record 1,240' })).toBeTruthy();
  });

  it('groups the write-off hold and the book figure it cannot go below', () => {
    mount(<WriteOffSheet row={row({ stock: 1240 })} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Why they left' }), { target: { value: 'breakage' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles' }), { target: { value: '1200' } });
    expect(screen.getByRole('button', { name: 'Hold to write off 1,200' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles' }), { target: { value: '1300' } });
    expect(document.body.textContent).toContain('The book holds 1,240; a write-off cannot take it below zero.');
  });

  it('groups each zone\'s bottles in the From list, and the move hold', () => {
    mount(
      <TransferSheet
        row={row({ zones: [{ locationId: 'z1', qty: 1240 }] })}
        onClose={() => {}}
        locations={[{ id: 'z1', name: 'Cave' }, { id: 'z2', name: 'Bar' }] as never}
        locationsUnavailable={false}
      />,
    );
    const from = screen.getByRole('combobox', { name: 'From' }) as HTMLSelectElement;
    expect([...from.options].map((o) => o.textContent)).toContain('Cave · 1,240');
    fireEvent.change(from, { target: { value: 'z1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: 'z2' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles' }), { target: { value: '1200' } });
    expect(screen.getByRole('button', { name: 'Hold to move 1,200' })).toBeTruthy();
  });

  it('groups the count held on this device and what its seal bound', async () => {
    api.submit.mockResolvedValue({ synced: false });
    mount(<CountSheet row={row()} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles counted' }), { target: { value: '1240' } });
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to record 1,240' }));
    await waitFor(() => expect(document.body.textContent).toContain('The count of 1,240 goes out when the connection returns'));
    await waitFor(() => expect(document.body.textContent).toContain('Barolo: 1,240 counted'));
  });

  it('groups the written-off sentence and what its seal bound', async () => {
    api.post.mockResolvedValue({ data: {} });
    mount(<WriteOffSheet row={row({ stock: 1240 })} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Why they left' }), { target: { value: 'breakage' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles' }), { target: { value: '1200' } });
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to write off 1,200' }));
    await waitFor(() => expect(document.body.textContent).toContain('Written off: 1,200 × Barolo'));
    await waitFor(() => expect(document.body.textContent).toContain('Barolo: −1,200, breakage'));
  });

  it('groups the moved sentence', async () => {
    api.transfer.mockResolvedValue({});
    mount(
      <TransferSheet
        row={row({ zones: [{ locationId: 'z1', qty: 1240 }] })}
        onClose={() => {}}
        locations={[{ id: 'z1', name: 'Cave' }, { id: 'z2', name: 'Bar' }] as never}
        locationsUnavailable={false}
      />,
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: 'z1' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'To' }), { target: { value: 'z2' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Bottles' }), { target: { value: '1200' } });
    holdByKeyboard(screen.getByRole('button', { name: 'Hold to move 1,200' }));
    await waitFor(() => expect(document.body.textContent).toContain('Moved 1,200 from Cave to Bar.'));
  });

  it('groups a large number of pours', () => {
    mount(<PourSheet row={row({ pourMl: 150 })} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pours' }), { target: { value: '1200' } });
    expect(screen.getByRole('button', { name: 'Hold to record 1,200 × 150 ml' })).toBeTruthy();
  });

  it('groups the pour hold\'s millilitres', () => {
    mount(<PourSheet row={row({ pourMl: 1500 })} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Hold to record 1 × 1,500 ml' })).toBeTruthy();
  });
});
