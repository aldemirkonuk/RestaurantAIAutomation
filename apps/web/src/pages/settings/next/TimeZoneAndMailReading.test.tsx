/**
 * The two registers ADR 0207 round 3 added to Settings: the house's time zone
 * (the founder, 2026-09-21: "Add it to Settings") and whether Jev reads its
 * vendor mail ("this feature can also be disabled"). Rendered directly; the
 * gateway's own rules are in `house-time-zone-and-tone-switch.spec.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TimeZoneSection, allZones, zonesOfCountry } from './TimeZoneSection';
import { MailReadingSection } from './MailReadingSection';
import type { SettingsNextData } from './useSettingsNextData';
import type { DataTermsReadout } from '../../../services/api/dataTerms';

/**
 * ADR 0207 round 5. `MailReadingSection` reads `useDataTerms` (TanStack
 * Query) to decide whether "Turn on" can call the switch directly or must
 * open the acceptance sheet instead — mocked rather than wrapped in a
 * `QueryClientProvider`, matching this file's existing style of stubbing
 * `SettingsNextData` by hand instead of exercising the real data layer.
 * `DataTermsAcceptSheet.test.tsx` covers the sheet itself end to end.
 */
const dataTermsMock = vi.hoisted(() => ({
  data: undefined as DataTermsReadout | undefined,
}));
vi.mock('../../../hooks/queries/useDataTerms', () => ({
  useDataTerms: () => ({ data: dataTermsMock.data }),
  useInvalidateDataTerms: () => vi.fn(),
}));

function currentReadout(over: Partial<DataTermsReadout> = {}): DataTermsReadout {
  return {
    readable: true,
    reason: null,
    version: 1,
    digest: 'a'.repeat(64),
    statements: [],
    subprocessors: [],
    changedSince: {},
    acceptance: { version: 1, acceptedAt: '2026-09-22T00:00:00Z', acceptedBy: { userId: 'u', name: 'Aldemir' } },
    current: true,
    jev: { enabled: true, effective: true, pausedBecause: null },
    ...over,
  };
}

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
  // MemoryRouter: the acceptance sheet (ADR 0207 round 5) links to
  // /privacy, and a `not current` case below mounts it for real.
  render(
    <MemoryRouter>
      <MailReadingSection data={data} />
    </MemoryRouter>,
  );
  return { saveToneScoring };
}

describe('the Mail reading register', () => {
  beforeEach(() => {
    // Default: the data-terms read has not resolved. `onTurnOnClick` treats
    // that the same as "already current" — see MailReadingSection's own
    // comment — so every pre-existing test below still calls the switch
    // directly without a single new mock in it.
    dataTermsMock.data = undefined;
  });

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
    // ADR 0207 round 5 — the sheet is built now; the note points to the
    // sign-in gate and says the switch is also reachable here.
    expect(screen.getByText(/every owner meets that sheet at their next sign-in/)).toBeInTheDocument();
    expect(screen.queryByText(/is not on this page yet/)).toBeNull();
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

  it('calls the switch directly once the data terms read as current', () => {
    dataTermsMock.data = currentReadout();
    const { saveToneScoring } = mountTone();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(saveToneScoring).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('button', { name: /hold to accept/i })).toBeNull();
  });

  /**
   * ADR 0207 round 5 — "Turn on" opens the terms instead of a request that
   * would only 409 when this house's owner has not accepted the CURRENT
   * version.
   */
  it('opens the terms sheet, and calls no switch, when the data terms are not current', () => {
    dataTermsMock.data = currentReadout({ current: false });
    const { saveToneScoring } = mountTone();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(saveToneScoring).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /hold to accept/i })).toBeInTheDocument();
  });
});
