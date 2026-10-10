/**
 * When the write does not happen, the SURFACE says so — all four dialogs.
 *
 * `locationDialogs.test.tsx` pins one of these ('says the failure in words, on
 * the surface that caused it', CreateChainDialog). That left three dialogs
 * whose only proof of failure was a `toast.error`, and a toast is not an
 * honest failure report: it is transient, it lives outside the dialog that
 * caused it, it is unreachable to a reader who was scrolled elsewhere, and it
 * disappears while the form still sits there looking submittable. That is
 * absence reported as health (ADR 0020) at the smallest scale — the dialog
 * looks exactly as it did before the click that failed.
 *
 * So each of the remaining three is pinned here: reject the request the dialog
 * actually issues, and require the words to appear in a `role="alert"` INSIDE
 * the dialog. Each assertion fails against a version that only toasts.
 *
 * The shared address controls are stubbed — `CountryCombobox` and
 * `PlacesAutocomplete` are third-party-backed widgets (Google Places) with no
 * test surface, and `AddLocationDialog` keeps its submit button disabled until
 * country and address are set, so without stubs its failure path is
 * unreachable. The stubs are plain inputs carrying the same labels; nothing
 * about the dialog's own behaviour is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AddLocationDialog } from './AddLocationDialog';
import { AssignToChainDialog } from './AssignToChainDialog';
import { CreateChainDialog } from './CreateChainDialog';
import { EditLocationChainDialog } from './EditLocationChainDialog';
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround';

// A variable, not a literal: scripts/check_money_states_its_currency.py.
const FIXTURE_CURRENCY = 'USD';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: vi.fn() } }));

const post = vi.fn();
const patch = vi.fn();
const get = vi.fn();
vi.mock('../../services/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { restaurantId: 'r1' } }),
}));
vi.mock('../../hooks/queries', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('../providers/BranchProviderTransferModal', () => ({
  BranchProviderTransferModal: () => null,
}));

/* The two Google-backed controls, as plain labelled inputs. */
vi.mock('../ui/CountryCombobox', () => ({
  CountryCombobox: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Country" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('../ui/PlacesAutocomplete', () => ({
  PlacesAutocomplete: ({
    value,
    onChange,
    onPlaceSelect,
  }: {
    value: string;
    onChange: (v: string) => void;
    onPlaceSelect: (place: unknown) => void;
  }) => (
    <>
      <input aria-label="Street Address" value={value} onChange={(e) => onChange(e.target.value)} />
      <button
        type="button"
        onClick={() =>
          onPlaceSelect({
            placeName: '',
            streetAddress: '843 Valencia Street',
            city: 'San Francisco',
            stateProvince: 'California',
            postalCode: '94110',
            country: 'United States',
            neighborhood: '',
            latitude: 37.7594,
            longitude: -122.4211,
            googlePlaceId: 'place-1',
          })
        }
      >
        Pick 843 Valencia Street
      </button>
    </>
  ),
}));

const BRANCH = {
  id: 'b1',
  name: 'Uptown',
  city: 'Chicago',
  chain_id: null,
  chain_name: null,
} as never;

const STANDALONE = [
  { id: 'l1', name: 'Uptown', city: 'Chicago' },
  { id: 'l2', name: 'Loop', city: null },
];

beforeEach(() => {
  resetMudavymShell();
  claimMudavymShell(Symbol('locations-page'), 'paper');
  get.mockResolvedValue({ data: [] });
  post.mockResolvedValue({ data: { id: 'x' } });
  patch.mockResolvedValue({ data: {} });
  toastError.mockClear();
});
afterEach(() => {
  vi.clearAllMocks();
  resetMudavymShell();
});

/** The alert must be inside the dialog, not floating somewhere in the document. */
function alertInDialog(): HTMLElement {
  const dialog = screen.getByRole('dialog');
  const alert = dialog.querySelector('[role="alert"]');
  if (!alert) throw new Error('the dialog printed no role="alert" for the failure');
  return alert as HTMLElement;
}

describe('a refused write is printed on the dialog that asked for it', () => {
  it('AddLocationDialog says why the location was not added', async () => {
    post.mockRejectedValueOnce(new Error('a location with that name already exists'));
    render(<AddLocationDialog open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Location name/), { target: { value: 'Uptown' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'United States' } });
    fireEvent.change(screen.getByLabelText('Street Address'), { target: { value: '1 Main St' } });
    fireEvent.change(screen.getByLabelText(/City/), { target: { value: 'Chicago' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));

    await waitFor(() => {
      expect(alertInDialog()).toHaveTextContent('a location with that name already exists');
    });
    // The heading names the outcome, so the words are readable without the detail.
    expect(alertInDialog()).toHaveTextContent('Not added');
    // and the form is still there to correct — the dialog did not close on failure
    expect(screen.getByRole('button', { name: 'Add Location' })).toBeTruthy();
  });

  it("AddLocationDialog says the gateway's refusal in its words, never axios's status line (F-242)", async () => {
    // Shaped like the axios error a 403 actually arrives as.
    post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        response: {
          status: 403,
          data: { message: 'Only an owner of the organisation can open a new location.', code: 'NOT_ORGANISATION_OWNER' },
        },
      }),
    );
    render(<AddLocationDialog open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Location name/), { target: { value: 'Uptown' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'United States' } });
    fireEvent.change(screen.getByLabelText('Street Address'), { target: { value: '1 Main St' } });
    fireEvent.change(screen.getByLabelText(/City/), { target: { value: 'Chicago' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));

    await waitFor(() => {
      expect(alertInDialog()).toHaveTextContent('Only an owner of the organisation can open a new location.');
    });
    expect(alertInDialog()).not.toHaveTextContent('status code');
    expect(toastError).toHaveBeenCalledWith('Only an owner of the organisation can open a new location.');
  });

  it('AddLocationDialog says a plain retry line when the gateway sent no sentence', async () => {
    post.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 500'), {
        isAxiosError: true,
        response: { status: 500, data: {} },
      }),
    );
    render(<AddLocationDialog open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Location name/), { target: { value: 'Uptown' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'United States' } });
    fireEvent.change(screen.getByLabelText('Street Address'), { target: { value: '1 Main St' } });
    fireEvent.change(screen.getByLabelText(/City/), { target: { value: 'Chicago' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));

    await waitFor(() => {
      expect(alertInDialog()).toHaveTextContent('The location was not added. Please try again.');
    });
    expect(alertInDialog()).not.toHaveTextContent('status code');
  });

  it('AssignToChainDialog says why the locations were not assigned', async () => {
    patch.mockRejectedValueOnce(new Error('chain is at its location limit'));
    const onSaved = vi.fn();
    render(
      <AssignToChainDialog
        open
        onClose={() => {}}
        onSaved={onSaved}
        onCreateNew={() => {}}
        chainId="c1"
        chainName="The Grill Co."
        standaloneLocations={STANDALONE}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Uptown/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to chain' }));

    await waitFor(() => {
      expect(alertInDialog()).toHaveTextContent('chain is at its location limit');
    });
    expect(alertInDialog()).toHaveTextContent('Not assigned');
    // A failed assignment is not a save: the caller must not be told it worked.
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('EditLocationChainDialog says why the location was not saved', async () => {
    patch.mockRejectedValueOnce(new Error('that location is locked by another manager'));
    const onSaved = vi.fn();
    render(
      <EditLocationChainDialog
        open
        branch={BRANCH}
        chains={[{ id: 'c1', name: 'The Grill Co.' }]}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Uptown II' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(alertInDialog()).toHaveTextContent('that location is locked by another manager');
    });
    expect(alertInDialog()).toHaveTextContent('Not saved');
    expect(onSaved).not.toHaveBeenCalled();
  });

  /**
   * The toast is kept — it is what a reader who has already looked away sees.
   * What this file forbids is the toast being the ONLY report. Asserting both
   * is what stops a later "simplification" from deleting the alert and leaving
   * a green test behind.
   */
  it('the toast is an addition to the alert, never a substitute for it', async () => {
    patch.mockRejectedValueOnce(new Error('locked'));
    render(
      <EditLocationChainDialog open branch={BRANCH} chains={[]} onClose={() => {}} onSaved={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Uptown III' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(alertInDialog()).toHaveTextContent('locked'));
    expect(toastError).toHaveBeenCalled();
  });
});

/**
 * F-547: the chain POST and each location PATCH are separate writes, so one
 * try can half-succeed. The dialog used to say "Could not create chain" while
 * the chain existed, and a retry re-POSTed it (a second chain, same name) and
 * re-PATCHed locations already moved. Now the alert says what did happen, and
 * a retry sends only what is left.
 */
describe('a half-done write says what happened and a retry does only the rest', () => {
  it('CreateChainDialog: chain made, one location refused — says so, retry moves only that one', async () => {
    post.mockResolvedValueOnce({ data: { id: 'c9', name: 'The Grill Co.' } });
    patch.mockImplementation((url: string) =>
      url.endsWith('/l2') ? Promise.reject(new Error('location is locked')) : Promise.resolve({ data: {} }),
    );
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateChainDialog open onClose={onClose} onCreated={onCreated} standaloneLocations={STANDALONE} />,
    );
    fireEvent.change(screen.getByLabelText('Chain name'), { target: { value: 'The Grill Co.' } });
    fireEvent.click(screen.getByRole('button', { name: /Uptown/ }));
    fireEvent.click(screen.getByRole('button', { name: /Loop/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create chain' }));

    await waitFor(() => expect(alertInDialog()).toHaveTextContent('was created and 1 of 2 locations moved in'));
    expect(alertInDialog()).toHaveTextContent('Loop did not move — location is locked');
    expect(alertInDialog()).not.toHaveTextContent('Could not create chain');
    expect(onCreated).not.toHaveBeenCalled();

    patch.mockClear();
    patch.mockResolvedValue({ data: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Move the rest' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'c9', name: 'The Grill Co.' }));
    expect(post).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/organizations/locations/l2', { chainId: 'c9' });
    expect(onClose).toHaveBeenCalled();
  });

  it('CreateChainDialog: closing after a half-done try still tells the page the chain exists', async () => {
    post.mockResolvedValueOnce({ data: { id: 'c9', name: 'The Grill Co.' } });
    patch.mockRejectedValueOnce(new Error('location is locked'));
    const onCreated = vi.fn();
    render(
      <CreateChainDialog open onClose={() => {}} onCreated={onCreated} standaloneLocations={STANDALONE} />,
    );
    fireEvent.change(screen.getByLabelText('Chain name'), { target: { value: 'The Grill Co.' } });
    fireEvent.click(screen.getByRole('button', { name: /Uptown/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create chain' }));
    await waitFor(() => expect(alertInDialog()).toHaveTextContent('was created and 0 of 1 location moved in'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCreated).toHaveBeenCalledWith({ id: 'c9', name: 'The Grill Co.' });
  });

  it('AssignToChainDialog: one of two refused — says which, retry moves only that one', async () => {
    patch.mockImplementation((url: string) =>
      url.endsWith('/l2') ? Promise.reject(new Error('location is locked')) : Promise.resolve({ data: {} }),
    );
    const onSaved = vi.fn();
    render(
      <AssignToChainDialog
        open
        onClose={() => {}}
        onSaved={onSaved}
        onCreateNew={() => {}}
        chainId="c1"
        chainName="The Grill Co."
        standaloneLocations={STANDALONE}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Uptown/ }));
    fireEvent.click(screen.getByRole('button', { name: /Loop/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to chain' }));

    await waitFor(() => expect(alertInDialog()).toHaveTextContent('1 of 2 locations added to "The Grill Co."'));
    expect(alertInDialog()).toHaveTextContent('Partly assigned');
    expect(alertInDialog()).toHaveTextContent('Loop did not move — location is locked');
    expect(onSaved).not.toHaveBeenCalled();

    patch.mockClear();
    patch.mockResolvedValue({ data: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Add to chain' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith('/organizations/locations/l2', { chainId: 'c1' });
  });
});

/**
 * The zone is a courtesy, never a reason the add fails (item 62). The dialog
 * called `Intl.DateTimeFormat().resolvedOptions().timeZone` bare inside its
 * submit handler, so a runtime whose `Intl` throws lost the whole add before
 * any request left (TD-2026-09-27-CREATE-LOCATION-TIMEZONE-UNVALIDATED). It
 * now goes through `getBrowserTimezone()`, which omits the field instead.
 */
describe('the browser zone never stops a location being added', () => {
  function fillAndSubmit() {
    fireEvent.change(screen.getByLabelText(/Location name/), { target: { value: 'Uptown' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'United States' } });
    fireEvent.change(screen.getByLabelText('Street Address'), { target: { value: '1 Main St' } });
    fireEvent.change(screen.getByLabelText(/City/), { target: { value: 'Chicago' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));
  }

  it('sends the browser zone when Intl gives one', async () => {
    render(<AddLocationDialog open onClose={() => {}} />);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fillAndSubmit();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/organizations/locations');
    expect((post.mock.calls[0][1] as { timezone?: string }).timezone).toBe(zone);
  });

  it('still adds the location, with no zone, when Intl throws', async () => {
    render(<AddLocationDialog open onClose={() => {}} />);
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new RangeError('Intl is not available');
    });
    try {
      fillAndSubmit();
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    } finally {
      spy.mockRestore();
    }
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.name).toBe('Uptown');
    expect(body.timezone).toBeUndefined();
  });
});

/*
 * F-241: a second house recorded neither a currency nor a map point; the
 * first house records both. The dialog now states the currency that follows
 * from the country, sends it, and sends the picked place's point — but not a
 * point for an address typed over after the pick.
 */
describe('a second house records its currency and its map point', () => {
  function fill() {
    fireEvent.change(screen.getByLabelText(/Location name/), { target: { value: 'Mission' } });
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'United States' } });
  }

  it('states the currency, and sends it with the picked point', async () => {
    render(<AddLocationDialog open onClose={() => {}} />);
    fill();
    expect(
      screen.getByText('Its money is kept in USD, from the country. Change it in Settings once it is open.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pick 843 Valencia Street' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({
      address: '843 Valencia Street',
      city: 'San Francisco',
      currency: FIXTURE_CURRENCY,
      latitude: 37.7594,
      longitude: -122.4211,
    });
  });

  it('drops the point when the address is typed over after the pick', async () => {
    render(<AddLocationDialog open onClose={() => {}} />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Pick 843 Valencia Street' }));
    fireEvent.change(screen.getByLabelText('Street Address'), { target: { value: '845 Valencia Street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Location' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const body = post.mock.calls[0][1] as Record<string, unknown>;
    expect(body.currency).toBe('USD');
    expect(body.latitude).toBeUndefined();
    expect(body.longitude).toBeUndefined();
  });
});
