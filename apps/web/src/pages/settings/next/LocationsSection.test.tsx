/**
 * "Add a location" is offered only to a role the gateway lets open one (F-242).
 *
 * `organizations.service.ts` refuses everyone but an owner with
 * NOT_ORGANISATION_OWNER, and the button used to be drawn for every role —
 * staff and managers were handed a form that could only fail. "Create a chain"
 * beside it was already owner-only; the two now share that gate.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { LocationsSection } from './LocationsSection';
import type { SettingsNextData } from './useSettingsNextData';

vi.mock('@/components/locations/AddLocationDialog', () => ({
  AddLocationDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Add a location" /> : null),
}));
vi.mock('@/components/locations/CreateChainDialog', () => ({ CreateChainDialog: () => null }));
vi.mock('@/components/locations/AssignToChainDialog', () => ({ AssignToChainDialog: () => null }));
vi.mock('@/components/locations/EditLocationChainDialog', () => ({
  EditLocationChainDialog: ({ onPlaceChanged }: { onPlaceChanged?: () => void }) => (
    <div role="dialog" aria-label="Edit location">
      <button type="button" onClick={() => onPlaceChanged?.()}>
        Country saved
      </button>
    </div>
  ),
}));

const houseCurrencyReload = vi.fn();
const houseTimeZoneReload = vi.fn();

function data(
  isOwner: boolean,
  restaurantId = 'r1',
  // null: the gateway could not read it, so the field is absent.
  organizationOwner: boolean | null = isOwner,
  chains: unknown[] = [],
): SettingsNextData {
  return {
    chains: { status: 'ok', data: chains, error: null, reload: () => {} },
    locations: [
      {
        id: 'r1',
        name: 'Uptown',
        city: 'Chicago',
        chain_id: null,
        chain_name: null,
        ...(organizationOwner === null ? {} : { organization_owner: organizationOwner }),
      },
    ],
    restaurantId,
    isOwner,
    refreshBranches: async () => {},
    houseCurrency: { reload: houseCurrencyReload },
    houseTimeZone: { reload: houseTimeZoneReload },
  } as unknown as SettingsNextData;
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.search}</output>;
}

function draw(ui: ReactNode, at = '/settings?tab=locations') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      {ui}
      <Where />
    </MemoryRouter>,
  );
}

describe('Locations — who is offered "Add a location"', () => {
  it('an owner is offered it, and "Create a chain" beside it', () => {
    draw(<LocationsSection data={data(true)} />);
    expect(screen.getByRole('button', { name: 'Add a location' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a chain' })).toBeTruthy();
  });

  it('a manager or staff member is not offered a form the gateway would refuse', () => {
    draw(<LocationsSection data={data(false)} />);
    expect(screen.queryByRole('button', { name: 'Add a location' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create a chain' })).toBeNull();
    // The branches are still listed.
    expect(screen.getByText('Uptown')).toBeTruthy();
  });
});

// F-913: the house switcher's "Add location" sent `action=add` and nothing
// read it, so the owner landed on the register with no form open.
describe('Locations — the switcher\'s "Add location" link', () => {
  it('opens the add form for an owner, and drops the request from the address', () => {
    draw(<LocationsSection data={data(true)} />, '/settings?tab=locations&action=add');
    expect(screen.getByRole('dialog', { name: 'Add a location' })).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe('?tab=locations');
  });

  it('opens nothing for a manager, and drops the request too', () => {
    draw(<LocationsSection data={data(false)} />, '/settings?tab=locations&action=add');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('where').textContent).toBe('?tab=locations');
  });
});

// F-1264: a country correction for the open house re-reads the Currency and
// Time zone registers on this page; they were drawn from the old country.
describe('Locations — a country correction', () => {
  it('reads Currency and Time zone again when the open house changed country', () => {
    houseCurrencyReload.mockClear();
    houseTimeZoneReload.mockClear();
    draw(<LocationsSection data={data(true)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Country saved' }));
    expect(houseCurrencyReload).toHaveBeenCalledTimes(1);
    expect(houseTimeZoneReload).toHaveBeenCalledTimes(1);
  });

  it('leaves them alone when another house changed country', () => {
    houseCurrencyReload.mockClear();
    houseTimeZoneReload.mockClear();
    draw(<LocationsSection data={data(true, 'r2')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Country saved' }));
    expect(houseCurrencyReload).not.toHaveBeenCalled();
    expect(houseTimeZoneReload).not.toHaveBeenCalled();
  });
});

// F-1570 (rehit of F-242): a house owner by invite is the organisation's
// manager, and the gateway refuses them all three owner's acts, so the page
// gates on the branch's `organization_owner`, not on the house role.
describe('Locations — a co-owner by invite', () => {
  const CHAIN = [{ id: 'c1', name: 'Harbour Group', location_count: null, updated_at: null }];

  it('is not offered Add a location, Create a chain or Assign a branch, and is told why', () => {
    draw(<LocationsSection data={data(true, 'r1', false, CHAIN)} />);
    expect(screen.queryByRole('button', { name: 'Add a location' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create a chain' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assign a branch' })).toBeNull();
    expect(screen.getByText(/for the owner of the whole business/)).toBeTruthy();
  });

  it('opens no form from the switcher link', () => {
    draw(<LocationsSection data={data(true, 'r1', false)} />, '/settings?tab=locations&action=add');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the business owner is offered all three', () => {
    draw(<LocationsSection data={data(true, 'r1', true, CHAIN)} />);
    expect(screen.getByRole('button', { name: 'Add a location' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create a chain' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Assign a branch' })).toBeTruthy();
  });

  it('an ownership the gateway could not read offers nothing and claims nothing', () => {
    draw(<LocationsSection data={data(true, 'r1', null)} />);
    expect(screen.queryByRole('button', { name: 'Add a location' })).toBeNull();
    expect(screen.queryByText(/for the owner of the whole business/)).toBeNull();
  });
});
