/**
 * A vendor's branches on the vendor sheet (founder, 2026-09-26, round 8,
 * item 51; ADR 0221).
 *
 * What has to be true:
 *   1. A failed read is words with a retry, never an empty book.
 *   2. An empty book says so, and offers to add one.
 *   3. Each branch shows its name, kind, address and whether it is primary.
 *   4. Adding sends every field the legacy sheet edited — name, kind, address,
 *      primary — and the point only when the address was PICKED.
 *   5. Editing sends only what changed; a retyped address goes without a
 *      point, so the gateway clears the old one.
 *   6. Make primary, and remove after a second deliberate click; what the
 *      gateway says about the primary mark afterwards is shown.
 *   7. A refused write says the book is unchanged, in words.
 *   8. After every write the list is read again — the server's rows, not ours.
 *
 * `apiClient` is mocked, so these assert what this component sends and does
 * with the answers, never that the gateway gives them (that is
 * `provider-locations.spec.ts`).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: api,
  getErrorMessage: (e: unknown) => {
    const data = (e as { response?: { data?: { message?: unknown } } })?.response?.data;
    if (data?.message) return data.message as string;
    return e instanceof Error ? e.message : 'unknown error';
  },
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'r1' }),
}));

// The shared Places control needs a Maps key and a network. The double keeps
// its contract: a labelled input that reports typing, and a pick that hands
// back an address with its point.
vi.mock('../../../components/ui/PlacesAutocomplete', () => ({
  PlacesAutocomplete: (props: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
    onPlaceSelect: (p: unknown) => void;
  }) => (
    <span>
      <input id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      <button
        type="button"
        onClick={() =>
          props.onPlaceSelect({
            placeName: '',
            streetAddress: '12 Quay St',
            city: 'Brooklyn',
            stateProvince: 'NY',
            postalCode: '11201',
            country: 'United States',
            neighborhood: '',
            latitude: 40.7,
            longitude: -73.99,
            googlePlaceId: 'g1',
          })
        }
      >
        pick 12 Quay St
      </button>
    </span>
  ),
}));

import { BranchesSection } from './BranchesSection';

const HQ = {
  id: 'hq',
  name: 'Head office',
  type: 'office',
  address: '1 Old St, New York',
  isPrimary: true,
  latitude: 40.7,
  longitude: -74,
};
const DEPOT = {
  id: 'depot',
  name: 'Red Hook depot',
  type: 'warehouse',
  address: null,
  isPrimary: false,
  latitude: null,
  longitude: null,
};

const URL = '/providers/p1/locations';

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
});

function renderSection() {
  return render(<BranchesSection providerId="p1" providerName="Sheena Wines" />);
}

describe('BranchesSection — reading', () => {
  it('a failed read is words and a retry, never an empty book', async () => {
    api.get.mockRejectedValueOnce(new Error('gateway down')).mockResolvedValueOnce({ data: [HQ] });
    renderSection();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not be read/);
    expect(alert).toHaveTextContent(/not the same as this vendor having none/);
    expect(alert).toHaveTextContent('gateway down');
    expect(screen.queryByText(/No branches are recorded/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a branch' })).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Head office')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenLastCalledWith(URL);
  });

  it('says it is reading while it reads', () => {
    api.get.mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getByRole('status')).toHaveTextContent('Reading Sheena Wines’s branches…');
  });

  it('an empty book says so, and offers to add one', async () => {
    api.get.mockResolvedValue({ data: [] });
    renderSection();
    expect(await screen.findByText(/No branches are recorded for Sheena Wines/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add a branch' })).toBeEnabled();
  });

  it('shows each branch with its kind, address and the primary mark', async () => {
    api.get.mockResolvedValue({ data: [HQ, DEPOT] });
    renderSection();
    expect(await screen.findByText('Head office')).toBeInTheDocument();
    expect(screen.getByText('· Office')).toBeInTheDocument();
    expect(screen.getByText('· Warehouse')).toBeInTheDocument();
    expect(screen.getByText('1 Old St, New York')).toBeInTheDocument();
    expect(screen.getByText('No address recorded.')).toBeInTheDocument();
    expect(screen.getAllByText('Primary')).toHaveLength(1);
    // the primary branch is not offered "Make primary"; the other one is
    expect(screen.queryByRole('button', { name: 'Make Head office the primary branch' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Make Red Hook depot the primary branch' })).toBeInTheDocument();
  });

  it('draws no map (item 52: the new one is its own tab, later)', async () => {
    api.get.mockResolvedValue({ data: [HQ] });
    const { container } = renderSection();
    await screen.findByText('Head office');
    expect(container.querySelector('canvas, svg[data-map], .leaflet-container')).toBeNull();
    expect(screen.queryByText(/latitude|longitude/i)).toBeNull();
  });
});

describe('BranchesSection — writing', () => {
  it('adds a branch with every field, the point only because the address was picked, then reads again', async () => {
    api.get.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [HQ] });
    api.post.mockResolvedValue({ data: HQ });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a branch' }));

    const form = screen.getByRole('form', { name: 'Add a branch' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: '  Brooklyn store ' } });
    fireEvent.change(within(form).getByLabelText('Kind'), { target: { value: 'store' } });
    fireEvent.click(within(form).getByRole('button', { name: 'pick 12 Quay St' }));
    // the first branch is primary unless the person says otherwise
    expect(within(form).getByLabelText('The primary branch')).toBeChecked();
    fireEvent.click(within(form).getByRole('button', { name: 'Add branch' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(URL, {
      name: 'Brooklyn store',
      type: 'store',
      address: '12 Quay St, Brooklyn, NY, 11201, United States',
      isPrimary: true,
      latitude: 40.7,
      longitude: -73.99,
    });
    expect(await screen.findByText('Head office')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('form', { name: 'Add a branch' })).toBeNull();
  });

  it('a typed address goes without a point, and typing after a pick drops the pick’s point', async () => {
    api.get.mockResolvedValue({ data: [HQ] });
    api.post.mockResolvedValue({ data: DEPOT });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a branch' }));
    const form = screen.getByRole('form', { name: 'Add a branch' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Depot' } });
    fireEvent.click(within(form).getByRole('button', { name: 'pick 12 Quay St' }));
    fireEvent.change(within(form).getByLabelText('Address'), { target: { value: '14 Quay St' } });
    // a vendor that already has a branch: new ones are not primary by default
    expect(within(form).getByLabelText('The primary branch')).not.toBeChecked();
    fireEvent.submit(form);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith(URL, {
      name: 'Depot',
      type: 'office',
      address: '14 Quay St',
      isPrimary: false,
    });
  });

  it('will not add a branch with no name, and says why', async () => {
    api.get.mockResolvedValue({ data: [] });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a branch' }));
    const form = screen.getByRole('form', { name: 'Add a branch' });
    expect(within(form).getByRole('button', { name: 'Add branch' })).toBeDisabled();
    expect(within(form).getByText('A branch needs a name.')).toBeInTheDocument();
    fireEvent.submit(form);
    expect(api.post).not.toHaveBeenCalled();
    // the name field is where focus lands, for a keyboard
    expect(within(form).getByLabelText('Name')).toHaveFocus();
  });

  it('an edit sends only what changed; a retyped address goes with no point', async () => {
    api.get.mockResolvedValue({ data: [HQ, DEPOT] });
    api.patch.mockResolvedValue({ data: HQ });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Head office' }));
    const form = screen.getByRole('form', { name: 'Edit Head office' });
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(within(form).getByLabelText('Address'), { target: { value: '9 New Ave' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith(`${URL}/hq`, { address: '9 New Ave' });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('a rename alone sends the name alone', async () => {
    api.get.mockResolvedValue({ data: [HQ] });
    api.patch.mockResolvedValue({ data: HQ });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Head office' }));
    const form = screen.getByRole('form', { name: 'Edit Head office' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Main office' } });
    fireEvent.change(within(form).getByLabelText('Kind'), { target: { value: 'other' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith(`${URL}/hq`, { name: 'Main office', type: 'other' });
  });

  it('makes a branch primary', async () => {
    api.get.mockResolvedValue({ data: [HQ, DEPOT] });
    api.patch.mockResolvedValue({ data: { ...DEPOT, isPrimary: true } });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Make Red Hook depot the primary branch' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`${URL}/depot`, { isPrimary: true }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it('remove arms first, states the consequence, and needs a second click', async () => {
    api.get
      .mockResolvedValueOnce({ data: [HQ, DEPOT] })
      .mockResolvedValueOnce({ data: [{ ...DEPOT, isPrimary: true }] });
    api.delete.mockResolvedValue({ data: { success: true, promotedId: 'depot', promotionFailed: false } });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Head office' }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Removes Head office. The oldest other branch becomes primary.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByText(/Removes Head office/)).toBeNull();
    expect(api.delete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Head office' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Head office' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`${URL}/hq`));
    expect(await screen.findByText('Red Hook depot is now the primary branch.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Head office')).toBeNull());
  });

  it('a removal whose hand-off failed says no branch is primary now', async () => {
    api.get.mockResolvedValueOnce({ data: [HQ, DEPOT] }).mockResolvedValueOnce({ data: [DEPOT] });
    api.delete.mockResolvedValue({ data: { success: true, promotedId: null, promotionFailed: true } });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Head office' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Head office' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/no other branch could be made primary, so none is marked now/);
  });

  it('a refused write says the book still holds what it held, and keeps the list', async () => {
    api.get.mockResolvedValue({ data: [HQ] });
    api.patch.mockRejectedValue({
      response: { data: { message: ['type must be one of the following values: office, warehouse, store, other'] } },
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Head office' }));
    const form = screen.getByRole('form', { name: 'Edit Head office' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'HQ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'That was not saved, so the book still holds what it held: type must be one of the following values',
    );
    // the list was not re-read and the editor stays open with what was typed
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(within(screen.getByRole('form', { name: 'Edit Head office' })).getByLabelText('Name')).toHaveValue('HQ');
  });

  it('says a write is in flight, and holds the other controls meanwhile', async () => {
    api.get.mockResolvedValue({ data: [HQ, DEPOT] });
    api.patch.mockReturnValue(new Promise(() => {}));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Make Red Hook depot the primary branch' }));
    expect(await screen.findByText('Saving Red Hook depot…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Head office' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add a branch' })).toBeDisabled();
  });
});

/**
 * Same guard as ContactsSection: the sheet is Warm Charcoal (ADR 0138), so a
 * colour that is not a house token falls back to a paper value on charcoal.
 */
describe('BranchesSection draws only with house tokens', () => {
  const src = readFileSync(join(__dirname, 'BranchesSection.tsx'), 'utf8');
  const css = readFileSync(join(__dirname, '../../../styles/mudavym.css'), 'utf8');

  it('names at least one token (never a vacuous pass)', () => {
    expect(src.match(/var\(--[a-z0-9-]+/g)?.length ?? 0).toBeGreaterThan(5);
  });

  it('every custom property it uses is declared by mudavym.css', () => {
    const used = new Set([...src.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const undeclared = [...used].filter(
      (name) => !new RegExp(`^\\s*${name}\\s*:`, 'm').test(css),
    );
    expect(undeclared).toEqual([]);
  });
});
