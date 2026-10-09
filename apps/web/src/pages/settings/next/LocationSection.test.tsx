/**
 * Address and map point (F-174). The calendar said "Set the address on
 * Settings" and Settings had no address. The owner-or-manager rule and the
 * pair's range are the gateway's (`house-location.spec.ts`); these tests hold
 * what the page says and what it sends.
 *
 * The address search is replaced by a button that "picks" a place, because the
 * real one loads Google's library.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LocationSection } from './LocationSection';
import type { SettingsNextData } from './useSettingsNextData';

const place = { current: {} as Record<string, unknown> };

vi.mock('../../../components/ui/PlacesAutocomplete', () => ({
  PlacesAutocomplete: ({ onPlaceSelect, onChange }: { onPlaceSelect: (p: unknown) => void; onChange: (v: string) => void }) => (
    <>
      <button type="button" onClick={() => { onChange('12 Rıhtım'); onPlaceSelect(place.current); }}>pick a place</button>
      <input aria-label="address search" onChange={(e) => onChange(e.target.value)} />
    </>
  ),
}));

const PICKED = {
  placeName: '', streetAddress: '12 Rıhtım Caddesi', city: 'İstanbul', stateProvince: '', postalCode: '',
  country: 'Türkiye', neighborhood: '', latitude: 40.9905, longitude: 29.0253, googlePlaceId: 'g1',
};

function remote(data: unknown, status = 'ok') {
  return { status, data, error: null, reload: vi.fn(), set: vi.fn() };
}

function reg(over: Record<string, unknown> = {}) {
  return { restaurantId: 'r1', street: 'Typed by hand 4', latitude: null, longitude: null, readable: true, reason: null, ...over };
}

function mount(over: Record<string, unknown> = {}) {
  place.current = PICKED;
  const saveLocation = vi.fn(() => Promise.resolve(true));
  const data = {
    canManage: true,
    saveLocation,
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    houseLocation: remote(reg()),
    ...over,
  } as unknown as SettingsNextData;
  render(<LocationSection data={data} />);
  return { saveLocation };
}

describe('the house’s address and map point', () => {
  it('no point: says the calendar cannot show the weather, and saves the picked street with its point', () => {
    const { saveLocation } = mount();
    expect(screen.getByText('Typed by hand 4')).toBeInTheDocument();
    expect(screen.getByText(/cannot show the weather/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save this address' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'pick a place' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save this address' }));
    expect(saveLocation).toHaveBeenCalledWith('12 Rıhtım Caddesi', 40.9905, 29.0253);
  });

  it('a point on file is shown as numbers', () => {
    mount({ houseLocation: remote(reg({ street: '12 Rıhtım Caddesi', latitude: 40.9905, longitude: 29.0253 })) });
    expect(screen.getByText('40.9905, 29.0253')).toBeInTheDocument();
    expect(screen.getByText(/Move the house/i)).toBeInTheDocument();
  });

  it('a result without a point cannot be saved, and the page says so', () => {
    const { saveLocation } = mount();
    place.current = { ...PICKED, latitude: null, longitude: null };
    fireEvent.click(screen.getByRole('button', { name: 'pick a place' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/without a map point/);
    expect(screen.queryByRole('button', { name: 'Save this address' })).not.toBeInTheDocument();
    expect(saveLocation).not.toHaveBeenCalled();
  });

  it('typing after a pick drops the pick: typed text is never saved', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'pick a place' }));
    fireEvent.change(screen.getByLabelText('address search'), { target: { value: '12 Rıhtım Cad. 5' } });
    expect(screen.queryByRole('button', { name: 'Save this address' })).not.toBeInTheDocument();
  });

  it('a reader who may not change it sees no search and is told who can', () => {
    mount({ canManage: false });
    expect(screen.queryByRole('button', { name: 'pick a place' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only an owner or a manager can change this/)).toBeInTheDocument();
  });

  it('a failed read says so, and is never shown as no address', () => {
    mount({ houseLocation: remote(reg({ readable: false, reason: 'timeout' })) });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read — timeout/);
    expect(screen.queryByText(/None is recorded/)).not.toBeInTheDocument();
  });

  it('a change the trail missed is said out loud', () => {
    mount({ houseLocation: remote(reg({ latitude: 1, longitude: 2, audited: false, auditReason: 'insert refused' })) });
    expect(screen.getByRole('alert')).toHaveTextContent(/not written to the trail — insert refused/);
  });
});
