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
import { EditLocationChainDialog } from './EditLocationChainDialog';
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround';

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
  PlacesAutocomplete: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Street Address" value={value} onChange={(e) => onChange(e.target.value)} />
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
