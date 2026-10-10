/**
 * "Add a location" is offered only to a role the gateway lets open one (F-242).
 *
 * `organizations.service.ts` refuses everyone but an owner with
 * NOT_ORGANISATION_OWNER, and the button used to be drawn for every role —
 * staff and managers were handed a form that could only fail. "Create a chain"
 * beside it was already owner-only; the two now share that gate.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocationsSection } from './LocationsSection';
import type { SettingsNextData } from './useSettingsNextData';

vi.mock('@/components/locations/AddLocationDialog', () => ({ AddLocationDialog: () => null }));
vi.mock('@/components/locations/CreateChainDialog', () => ({ CreateChainDialog: () => null }));
vi.mock('@/components/locations/AssignToChainDialog', () => ({ AssignToChainDialog: () => null }));
vi.mock('@/components/locations/EditLocationChainDialog', () => ({ EditLocationChainDialog: () => null }));

function data(isOwner: boolean): SettingsNextData {
  return {
    chains: { status: 'ok', data: [], error: null, reload: () => {} },
    locations: [{ id: 'r1', name: 'Uptown', city: 'Chicago', chain_id: null, chain_name: null }],
    restaurantId: 'r1',
    isOwner,
    refreshBranches: async () => {},
  } as unknown as SettingsNextData;
}

describe('Locations — who is offered "Add a location"', () => {
  it('an owner is offered it, and "Create a chain" beside it', () => {
    render(<LocationsSection data={data(true)} />);
    expect(screen.getByRole('button', { name: 'Add a location' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a chain' })).toBeTruthy();
  });

  it('a manager or staff member is not offered a form the gateway would refuse', () => {
    render(<LocationsSection data={data(false)} />);
    expect(screen.queryByRole('button', { name: 'Add a location' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create a chain' })).toBeNull();
    // The branches are still listed.
    expect(screen.getByText('Uptown')).toBeTruthy();
  });
});
