/**
 * The two registers ADR 0207 round 3 added to Settings: the house's time zone
 * (the founder, 2026-09-21: "Add it to Settings") and whether Jev reads its
 * vendor mail ("this feature can also be disabled"). Rendered directly; the
 * gateway's own rules are in `house-time-zone-and-tone-switch.spec.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TimeZoneSection, allZones, zonesOfCountry } from './TimeZoneSection';
import { MailReadingSection } from './MailReadingSection';
import type { SettingsNextData } from './useSettingsNextData';

function remote(data: unknown, status = 'ok') {
  return { status, data, error: status === 'error' ? 'gateway unreachable' : null, reload: vi.fn(), set: vi.fn() };
}

function zoneReg(over: Record<string, unknown> = {}) {
  return {
    restaurantId: 'r1',
    zone: null,
    unreadZone: null,
    country: 'Türkiye',
    readable: true,
    reason: null,
    statedAt: null,
    statedBy: null,
    ...over,
  };
}

function mountZone(over: Record<string, unknown> = {}) {
  const saveTimeZone = vi.fn(() => Promise.resolve(true));
  const data = {
    canManage: true,
    saveTimeZone,
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    houseTimeZone: remote(zoneReg()),
    ...over,
  } as unknown as SettingsNextData;
  render(<TimeZoneSection data={data} />);
  return { saveTimeZone };
}

describe('the Time zone register', () => {
  it('says no zone is recorded, and what that costs, without writing anything on open', () => {
    const { saveTimeZone } = mountZone();
    expect(screen.getByText('not recorded')).toBeInTheDocument();
    expect(screen.getByText(/Deliveries near midnight are listed, not counted/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
    expect(saveTimeZone).not.toHaveBeenCalled();
  });

  it('offers the country’s zones first, and records only the zone a person picked', () => {
    const { saveTimeZone } = mountZone();
    const select = screen.getByLabelText('Time zone') as HTMLSelectElement;
    const groups = select.querySelectorAll('optgroup');
    if (zonesOfCountry('Türkiye').length > 0) expect(groups[0].label).toBe('Türkiye’s zones');
    fireEvent.change(select, { target: { value: 'Europe/Istanbul' } });
    expect(screen.getByText('Record will write Europe/Istanbul.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(saveTimeZone).toHaveBeenCalledWith('Europe/Istanbul');
    expect(allZones()).toContain('UTC');
  });

  it('names a recorded zone and who stated it', () => {
    mountZone({
      houseTimeZone: remote(zoneReg({ zone: 'Europe/Istanbul', statedBy: { userId: 'u', name: 'Aldemir' } })),
    });
    expect(screen.getByText('Europe/Istanbul', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText(/stated by · Aldemir/)).toBeInTheDocument();
  });

  it('keeps the control closed for staff and says the gateway refuses it too', () => {
    mountZone({ canManage: false });
    expect(screen.getByLabelText('Time zone')).toBeDisabled();
    expect(screen.getByText(/Only managers and owners can state the time zone/)).toBeInTheDocument();
  });

  it('says a failed read in words — not the same as a house that has not been asked', () => {
    mountZone({ houseTimeZone: remote(zoneReg({ readable: false, reason: 'statement timeout' })) });
    expect(screen.getByRole('alert')).toHaveTextContent('The time zone could not be read — statement timeout');
  });
});

function toneReg(over: Record<string, unknown> = {}) {
  return { restaurantId: 'r1', enabled: false, readable: true, reason: null, statedAt: null, statedBy: null, ...over };
}
function mountTone(over: Record<string, unknown> = {}) {
  const saveToneScoring = vi.fn(() => Promise.resolve(true));
  const data = {
    // ADR 0207 round 4 — owner only (was owner or manager).
    isOwner: true,
    saveToneScoring,
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    houseToneScoring: remote(toneReg()),
    ...over,
  } as unknown as SettingsNextData;
  render(<MailReadingSection data={data} />);
  return { saveToneScoring };
}

describe('the Mail reading register', () => {
  it('starts off, says nothing is sent, and says what turning it on sends — names removed', () => {
    const { saveToneScoring } = mountTone();
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText(/— nothing is sent\./)).toBeInTheDocument();
    expect(
      screen.getByText(/people’s names, account and government-id numbers, credentials and sensitive private topics/),
    ).toBeInTheDocument();
    // The masker is a rule-based pass: the note says what it cannot promise.
    expect(
      screen.getByText(/A name or topic written in a way this pass does not recognise may not be caught\./),
    ).toBeInTheDocument();
    // Last call, 2026-09-22: the note says where acceptance is — not yet on
    // this page — rather than pointing at a Settings section that does not exist.
    expect(screen.getByText(/accepting them is not on this page yet — so for now Jev stays off\./)).toBeInTheDocument();
    expect(screen.queryByText(/Settings → Data terms/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(saveToneScoring).toHaveBeenCalledWith(true);
  });

  it('turns off from on', () => {
    const { saveToneScoring } = mountTone({ houseToneScoring: remote(toneReg({ enabled: true })) });
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(saveToneScoring).toHaveBeenCalledWith(false);
  });

  it('keeps the switch closed for a manager (ADR 0207 round 4: owner only), and never reads a failed read as off', () => {
    mountTone({ isOwner: false });
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
    expect(screen.getByText(/Only an owner can decide/)).toBeInTheDocument();
  });

  it('says a failed read is not off', () => {
    mountTone({ houseToneScoring: remote(toneReg({ enabled: null, readable: false, reason: 'timeout' })) });
    expect(screen.getByRole('alert')).toHaveTextContent('That is not the same as off.');
    expect(screen.queryByRole('button', { name: /Turn/ })).not.toBeInTheDocument();
  });
});
