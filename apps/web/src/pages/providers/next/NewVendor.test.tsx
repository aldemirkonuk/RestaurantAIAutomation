/**
 * "A new vendor" and "A vendor you already have?" — the two owed acts on
 * `/providers`.
 *
 * THE REGRESSION. The rebuilt page could read the vendor book and open one
 * vendor's twin; it could not ADD one. Every assertion under "the act" and
 * "the two doors" fails against a copy of the pre-packet `ProvidersNext.tsx`,
 * which contains no opener, no composer and no duplicate check at all.
 *
 * What is asserted beyond the happy path is the part the legacy page got right
 * and would be easy to lose:
 *   - the delivery days and the address are DECOUPLED from the create and
 *     reported separately — a terms failure must never present as "failed to
 *     add vendor" (that silence hid the original defect for a year);
 *   - payment terms are NOT defaulted;
 *   - the catalogue tells "nothing matched" from "we could not look";
 *   - the duplicate question refuses the save while it is unanswered, and
 *     never merges anything.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const vendors = vi.hoisted(() => ({
  search: vi.fn(),
  addFromCatalogue: vi.fn(),
}));
const providersApi = vi.hoisted(() => ({ createLocation: vi.fn() }));
const terms = vi.hoisted(() => ({ set: vi.fn() }));
const create = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
const dup = vi.hoisted(() => ({
  value: { pendingMatch: null as unknown, acknowledge: vi.fn(), reset: vi.fn() },
}));
const prefs = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('@/services/api/vendors', () => ({
  searchVendorCatalogue: (...a: unknown[]) => vendors.search(...a),
  addProviderFromCatalogue: (...a: unknown[]) => vendors.addFromCatalogue(...a),
}));
vi.mock('@/services/api/providers', () => ({
  createProviderLocation: (...a: unknown[]) => providersApi.createLocation(...a),
}));
vi.mock('@/services/api/vendorTerms', () => ({
  setVendorTerms: (...a: unknown[]) => terms.set(...a),
  weekdayNamesToIndices: (names: string[]) => names.map((n) => n.length),
}));
vi.mock('@/services/api/client', () => ({
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ activeRestaurantId: 'rest-A', user: { restaurantId: 'rest-A' } }),
}));
vi.mock('@/hooks/queries/useProviderQueries', () => ({
  useCreateProvider: () => create,
}));
vi.mock('@/hooks/useDuplicateVendorCheck', () => ({
  useDuplicateVendorCheck: () => dup.value,
}));
vi.mock('@/hooks/useUserPreferences', () => ({
  useUserPreferences: () => ({ preferences: {}, updatePreferences: prefs.update }),
}));

import { NewVendorSheet, vendorRefusals, EMPTY_VENDOR } from './NewVendorSheet';
import { VendorTwinPanel } from './VendorTwinPanel';

const CATALOGUE_ROW = {
  id: 'cat-1',
  name: 'Sevilen Şarapları',
  type: 'importer' as const,
  country: 'TR',
  state: null,
  city: 'İzmir',
  address: null,
  phone: null,
  email: null,
  website: null,
  wine_specialties: null,
  notes: null,
  is_active: true,
  created_at: '',
  updated_at: '',
};

function draw(onAdded = vi.fn(), onClose = vi.fn()) {
  render(<NewVendorSheet open onClose={onClose} onAdded={onAdded} />);
  return { onAdded, onClose };
}

/** Fill the least the form will accept. */
function fillCleanly() {
  fireEvent.change(screen.getByTestId('vendor-name'), { target: { value: 'Premium Wine' } });
  fireEvent.change(screen.getByTestId('vendor-first'), { target: { value: 'Hasan' } });
  fireEvent.change(screen.getByTestId('vendor-phone'), { target: { value: '+90 312 0000000' } });
  fireEvent.change(screen.getByTestId('vendor-email'), { target: { value: 'h@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Red Wines' }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vendors.search.mockReset().mockResolvedValue([]);
  vendors.addFromCatalogue.mockReset().mockResolvedValue({ id: 'p-new' });
  providersApi.createLocation.mockReset().mockResolvedValue({});
  terms.set.mockReset().mockResolvedValue({});
  create.mutateAsync = vi.fn().mockResolvedValue({ id: 'p-new' });
  dup.value = { pendingMatch: null, acknowledge: vi.fn(), reset: vi.fn() };
  prefs.update.mockReset();
});

describe('the shape and the primitive', () => {
  it('is one sheet, named by its contract, closing in words', () => {
    draw();
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('.mdv-ovl')).toHaveAttribute('data-shape', 'sheet');
    expect(dialog).toHaveAttribute('data-motion', 'tuck');
    expect(screen.getByRole('button', { name: 'Put it down' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /A new vendor/ })).toBeInTheDocument();
  });

  it('the duplicate question is a panel that sits above the sheet', () => {
    render(
      <VendorTwinPanel
        open
        context="add"
        onKeepBoth={() => {}}
        match={{
          kind: 'provider',
          id: 'p-1',
          confidence: 0.9,
          provider: {
            id: 'p-1',
            name: 'Kavaklıdere',
            address: 'Ankara',
            phone: null,
            email: null,
            website: null,
            catalogue_vendor_id: null,
            is_custom: true,
            name_similarity: 0.9,
            address_similarity: 0.2,
          },
        }}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const root = dialog.closest('.mdv-ovl') as HTMLElement;
    expect(root).toHaveAttribute('data-shape', 'panel');
    expect(Number(root.style.zIndex)).toBeGreaterThan(100);
  });
});

describe('door one — the catalogue, with four states', () => {
  it('adds a verified vendor in one press', async () => {
    vendors.search.mockResolvedValue([CATALOGUE_ROW]);
    const { onAdded } = draw();
    fireEvent.change(screen.getByTestId('vendor-catalogue-search'), {
      target: { value: 'Sevilen' },
    });
    const take = await screen.findByTestId('vendor-catalogue-take', undefined, { timeout: 2000 });
    fireEvent.click(take);
    await waitFor(() => expect(vendors.addFromCatalogue).toHaveBeenCalledWith('cat-1'));
    expect(onAdded).toHaveBeenCalled();
  });

  it('tells "nothing matched" from "we could not look"', async () => {
    vendors.search.mockRejectedValue(new Error('catalogue down'));
    draw();
    fireEvent.change(screen.getByTestId('vendor-catalogue-search'), {
      target: { value: 'Sevilen' },
    });
    const said = await screen.findByTestId('vendor-catalogue-unreadable', undefined, {
      timeout: 2000,
    });
    expect(said).toHaveTextContent(/this vendor may well be in it/);
    expect(screen.queryByTestId('vendor-catalogue-empty')).toBeNull();
  });

  it('says an empty answer is an empty answer', async () => {
    vendors.search.mockResolvedValue([]);
    draw();
    fireEvent.change(screen.getByTestId('vendor-catalogue-search'), {
      target: { value: 'Zzzz' },
    });
    expect(
      await screen.findByTestId('vendor-catalogue-empty', undefined, { timeout: 2000 }),
    ).toHaveTextContent(/Nothing in the catalogue matches/);
  });
});

describe('door two — a vendor of your own', () => {
  it('writes the vendor, then the terms and the location as separate acts', async () => {
    draw();
    fillCleanly();
    fireEvent.change(screen.getByTestId('vendor-address'), { target: { value: 'Ankara' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tue' }));
    fireEvent.click(screen.getByTestId('vendor-save'));

    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
    const body = create.mutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(body.name).toBe('Premium Wine');
    expect(body.restaurantId).toBe('rest-A');
    // Not defaulted. A form default would refill the column default the
    // migration dropped.
    expect(body.paymentTerms).toBeUndefined();

    await waitFor(() => expect(terms.set).toHaveBeenCalledWith('p-new', expect.anything()));
    await waitFor(() =>
      expect(providersApi.createLocation).toHaveBeenCalledWith(
        'p-new',
        expect.objectContaining({ isPrimary: true, address: 'Ankara' }),
      ),
    );
  });

  it('a terms failure never presents as "failed to add vendor"', async () => {
    terms.set.mockRejectedValue(new Error('terms table missing'));
    draw();
    fillCleanly();
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));
    fireEvent.click(screen.getByTestId('vendor-save'));

    const asides = await screen.findByTestId('vendor-asides');
    expect(asides).toHaveTextContent(/vendor is in the book/);
    expect(asides).toHaveTextContent(/delivery days were NOT recorded/);
    expect(screen.queryByTestId('vendor-failure')).toBeNull();
  });

  it('says what did not happen when the create itself is refused', async () => {
    create.mutateAsync = vi.fn().mockRejectedValue(new Error('duplicate name'));
    draw();
    fillCleanly();
    fireEvent.click(screen.getByTestId('vendor-save'));
    await waitFor(() =>
      expect(screen.getByTestId('vendor-failure')).toHaveTextContent(
        /was not added \(duplicate name\)\. Nothing was written/,
      ),
    );
    // The words survive the refusal.
    expect(screen.getByTestId('vendor-name')).toHaveValue('Premium Wine');
  });

  it('refuses an incomplete vendor with a reason beside each field', () => {
    draw();
    fireEvent.click(screen.getByTestId('vendor-save'));
    expect(screen.getByTestId('vendor-problem-name')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-problem-phone')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-problem-email')).toBeInTheDocument();
    expect(screen.getByTestId('vendor-problem-specialties')).toBeInTheDocument();
    expect(create.mutateAsync).not.toHaveBeenCalled();
  });

  it('keeps a rating with the person, not on the vendor row', async () => {
    draw();
    fillCleanly();
    fireEvent.click(screen.getByRole('button', { name: '4 out of five' }));
    fireEvent.click(screen.getByTestId('vendor-save'));
    await waitFor(() => expect(create.mutateAsync).toHaveBeenCalled());
    const body = create.mutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('rating');
    await waitFor(() =>
      expect(prefs.update).toHaveBeenCalledWith({ providerRatings: { 'p-new': 4 } }),
    );
  });
});

describe('the duplicate question', () => {
  const match = {
    kind: 'provider' as const,
    id: 'p-1',
    confidence: 0.9,
    provider: {
      id: 'p-1',
      name: 'Kavaklıdere',
      address: 'Ankara',
      phone: '+90 312 000',
      email: null,
      website: null,
      catalogue_vendor_id: null,
      is_custom: true,
      name_similarity: 0.9,
      address_similarity: 0.2,
    },
  };

  it('refuses the save while it is unanswered', async () => {
    dup.value = { pendingMatch: match, acknowledge: vi.fn(), reset: vi.fn() };
    draw();
    fillCleanly();
    fireEvent.click(screen.getByTestId('vendor-save'));
    await waitFor(() => expect(screen.getAllByRole('dialog').length).toBeGreaterThan(1));
    expect(create.mutateAsync).not.toHaveBeenCalled();
  });

  it('names what the similarity measured, not a bare percentage', () => {
    render(<VendorTwinPanel open context="add" match={match} onKeepBoth={() => {}} />);
    expect(screen.getByTestId('twin-confidence')).toHaveTextContent('90% alike on the name');
  });

  it('never offers to merge, and says so', () => {
    render(<VendorTwinPanel open context="add" match={match} onKeepBoth={() => {}} />);
    expect(screen.getByText(/Two records are never merged here/)).toBeInTheDocument();
    // An own-provider match cannot be "used": that would be a third row.
    expect(screen.queryByTestId('twin-use-existing')).toBeNull();
  });

  it('offers the catalogue vendor on add and never on edit', () => {
    const cat = {
      kind: 'catalogue' as const,
      id: 'cat-1',
      confidence: 0.88,
      vendor: { ...CATALOGUE_ROW, name_similarity: 0.88, address_similarity: null },
    };
    const { unmount } = render(
      <VendorTwinPanel open context="add" match={cat} onKeepBoth={() => {}} />,
    );
    expect(screen.getByTestId('twin-use-existing')).toBeInTheDocument();
    unmount();
    render(<VendorTwinPanel open context="edit" match={cat} onKeepBoth={() => {}} />);
    expect(screen.queryByTestId('twin-use-existing')).toBeNull();
  });

  it('says what did not happen when using the one on file is refused', async () => {
    vendors.addFromCatalogue.mockRejectedValue(new Error('gone'));
    const cat = {
      kind: 'catalogue' as const,
      id: 'cat-1',
      confidence: 0.88,
      vendor: { ...CATALOGUE_ROW, name_similarity: 0.88, address_similarity: null },
    };
    render(<VendorTwinPanel open context="add" match={cat} onKeepBoth={() => {}} />);
    fireEvent.click(screen.getByTestId('twin-use-existing'));
    await waitFor(() =>
      expect(screen.getByTestId('twin-failure')).toHaveTextContent(/was not added \(gone\)/),
    );
  });

  it('carries on when the person says they are different', () => {
    const onKeepBoth = vi.fn();
    render(<VendorTwinPanel open context="add" match={match} onKeepBoth={onKeepBoth} />);
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Keep both — they are different',
      }),
    );
    expect(onKeepBoth).toHaveBeenCalled();
  });
});

describe('vendorRefusals, on its own', () => {
  it('keeps the legacy rules and nothing looser', () => {
    expect(Object.keys(vendorRefusals(EMPTY_VENDOR)).sort()).toEqual([
      'contactFirstName',
      'email',
      'name',
      'phone',
      'specialties',
    ]);
    const ok = {
      ...EMPTY_VENDOR,
      name: 'A',
      contactFirstName: 'B',
      phone: '5551234',
      email: 'a@b.co',
      specialties: ['Red Wines'],
    };
    expect(vendorRefusals(ok)).toEqual({});
    expect(vendorRefusals({ ...ok, email: 'nope' }).email).toMatch(/not an email/);
    expect(vendorRefusals({ ...ok, phone: '12' }).phone).toMatch(/not a phone/);
    expect(vendorRefusals({ ...ok, minimumOrder: 'lots' }).minimumOrder).toMatch(/a number/);
    expect(vendorRefusals({ ...ok, minimumOrder: '500' }).minimumOrder).toBeUndefined();
  });
});
