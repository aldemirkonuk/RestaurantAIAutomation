/**
 * The house's state and country, in the location editor (ADR 0289).
 *
 * The defect (A-052, AW26): the market index tells a United States house with
 * no state to "Set the state in Settings", and the only location editor in
 * Settings changed the name, the city and the chain. These pin the control the
 * founder chose — "Add it to the editor (Recommended)" — on the house surface:
 * an owner can change the pair, a manager sees it and is told why they cannot,
 * a read that failed offers no control, the pair is sent only when it moved,
 * and the gateway's receipt says whether the settings log recorded it.
 *
 * `CountryCombobox` is the real control (its input carries the id the label
 * points at); only the API client is a fake.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditLocationChainDialog } from './EditLocationChainDialog';
import { claimMudavymShell, resetMudavymShell } from '../../lib/mudavym/shellGround';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const get = vi.fn();
const patch = vi.fn();
vi.mock('../../services/api/client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    patch: (...a: unknown[]) => patch(...a),
  },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const BRANCH = {
  id: 'b1',
  name: 'Tuzlu Rüzgar',
  city: 'Austin',
  chain_id: null,
  chain_name: null,
} as never;

/** GET /organizations/locations/:id as the gateway answers it after ADR 0289. */
function located(over: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'b1',
      name: 'Tuzlu Rüzgar',
      city: 'Austin',
      email: null,
      phone: null,
      subscription_tier: 'pilot',
      country: 'US',
      stateProvince: null,
      callerRole: 'owner',
      ...over,
    },
  };
}

function open(onSaved = vi.fn()) {
  render(<EditLocationChainDialog open branch={BRANCH} chains={[]} onClose={() => {}} onSaved={onSaved} />);
  return onSaved;
}

function inDialog(role: 'status' | 'alert'): HTMLElement[] {
  return Array.from(screen.getByRole('dialog').querySelectorAll(`[role="${role}"]`));
}

beforeEach(() => {
  resetMudavymShell();
  claimMudavymShell(Symbol('settings-page'), 'paper');
  get.mockResolvedValue(located());
  patch.mockResolvedValue({ data: { stateAndCountry: 'not-sent', audited: false, auditReason: null } });
});
afterEach(() => {
  vi.clearAllMocks();
  resetMudavymShell();
});

describe('an owner sets the state the market index asks for', () => {
  it('reads the pair when the sheet opens and shows the country by its name', async () => {
    open();
    const state = (await screen.findByLabelText('State or province')) as HTMLInputElement;
    expect(get).toHaveBeenCalledWith('/organizations/locations/b1');
    expect((screen.getByLabelText('Country') as HTMLInputElement).value).toBe('United States');
    expect(state.value).toBe('');
    expect(screen.getByText(/Required for a United States house/)).toBeInTheDocument();
  });

  it('sends the pair, and only the pair, and shows the log’s receipt until it is read', async () => {
    patch.mockResolvedValueOnce({ data: { stateAndCountry: 'changed', audited: true, auditReason: null } });
    const onSaved = open();
    fireEvent.change(await screen.findByLabelText('State or province'), { target: { value: 'CA' } });
    expect(screen.getByText(/re-scopes the market index/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][0]).toBe('/organizations/locations/b1');
    expect(patch.mock.calls[0][1]).toEqual({
      chainId: null,
      name: undefined,
      city: undefined,
      country: 'United States',
      stateProvince: 'CA',
    });
    await waitFor(() =>
      expect(inDialog('status')[0]).toHaveTextContent('the settings log records the change under your name'),
    );
    // The receipt is a record; the sheet does not vanish with it.
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('says so when the change stands but the log did not take it', async () => {
    patch.mockResolvedValueOnce({
      data: { stateAndCountry: 'changed', audited: false, auditReason: 'system_audit_log is read-only right now' },
    });
    open();
    fireEvent.change(await screen.findByLabelText('State or province'), { target: { value: 'California' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(inDialog('status')[0]).toHaveTextContent(
        'did not record who changed them: system_audit_log is read-only right now',
      ),
    );
    expect(inDialog('status')[0]).toHaveTextContent('Saved, not recorded');
  });

  it('never reads an answer without a receipt as a recorded change', async () => {
    patch.mockResolvedValueOnce({ data: {} });
    open();
    fireEvent.change(await screen.findByLabelText('State or province'), { target: { value: 'CA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(inDialog('status')[0]).toHaveTextContent('Saved, unconfirmed'));
  });

  it('refuses a United States house with no state before it asks the gateway', async () => {
    get.mockResolvedValueOnce(located({ country: 'Germany', stateProvince: 'Bavaria' }));
    open();
    fireEvent.change(await screen.findByLabelText('Country'), { target: { value: 'United States' } });
    fireEvent.change(screen.getByLabelText('State or province'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(inDialog('alert')[0]).toHaveTextContent('A United States house needs its state'));
    expect(patch).not.toHaveBeenCalled();
  });

  it('sends a blank state as none, for a country that does not need one', async () => {
    get.mockResolvedValueOnce(located({ country: 'United Kingdom', stateProvince: 'England' }));
    open();
    fireEvent.change(await screen.findByLabelText('State or province'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toMatchObject({ country: 'United Kingdom', stateProvince: null });
  });

  it('leaves the pair out of a name-only edit', async () => {
    const onSaved = open();
    await screen.findByLabelText('State or province');
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Tuzlu Rüzgar Kadıköy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patch.mock.calls[0][1]).not.toHaveProperty('country');
    expect(patch.mock.calls[0][1]).not.toHaveProperty('stateProvince');
  });
});

describe('anyone else sees the pair and is told why it cannot be changed here', () => {
  it('a manager reads it, gets no control, and never sends it', async () => {
    get.mockResolvedValueOnce(located({ callerRole: 'manager', stateProvince: 'CA' }));
    const onSaved = open();
    await screen.findByText('Only an owner can change the state and country.');
    expect(screen.getByText('CA')).toBeInTheDocument();
    expect(screen.getByText('United States')).toBeInTheDocument();
    expect(screen.queryByLabelText('Country')).toBeNull();
    expect(screen.queryByLabelText('State or province')).toBeNull();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patch.mock.calls[0][1]).not.toHaveProperty('country');
    expect(patch.mock.calls[0][1]).not.toHaveProperty('stateProvince');
  });

  it('a role the gateway could not read is said, not guessed', async () => {
    get.mockResolvedValueOnce(located({ callerRole: null }));
    open();
    await screen.findByText(/Your role in this house could not be confirmed/);
    expect(screen.queryByLabelText('Country')).toBeNull();
  });
});

describe('a read that failed offers no control', () => {
  it.each([
    ['the request failed', () => get.mockRejectedValueOnce(new Error('503'))],
    ['the answer has no state or country', () => get.mockResolvedValueOnce({ data: [] })],
  ])('when %s', async (_label, arrange) => {
    arrange();
    const onSaved = open();
    await waitFor(() =>
      expect(inDialog('status')[0]).toHaveTextContent('The state and country could not be read'),
    );
    expect(screen.queryByLabelText('Country')).toBeNull();
    // The rest of the sheet still works, and sends nothing about the place.
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Dallas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patch.mock.calls[0][1]).not.toHaveProperty('country');
  });
});

describe('the legacy dialog stays as origin/main has it', () => {
  it('reads nothing and shows no state or country', () => {
    resetMudavymShell();
    open();
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByText('State or province')).toBeNull();
    expect(screen.queryByText(/state and country/i)).toBeNull();
  });
});
