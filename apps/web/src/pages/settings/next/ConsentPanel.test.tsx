/**
 * The consent panel — ADR 0134 fork 14 ("Bring back, real switches"), ADR 0222.
 *
 * Holds what the panel promises: only switches the product reads (today, the
 * training opt-out — the real `AskTrainingSection`, owner-only), each with its
 * own trail from `/settings-audit`, an unreadable trail never drawn as "never
 * changed", and the consents that are NOT switches named with the reason.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SettingsNextData } from './useSettingsNextData';

const http = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: http.get },
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'unknown'),
}));

const terms = vi.hoisted(() => ({ current: { isPending: false, isError: false, error: null, data: null as unknown } }));
vi.mock('../../../hooks/queries/useDataTerms', () => ({ useDataTerms: () => terms.current }));
vi.mock('../../../components/settings/DataTermsAcceptSheet', () => ({ DataTermsAcceptSheet: () => null }));

function readout(over: Record<string, unknown> = {}) {
  return {
    readable: true, reason: null, version: 2, digest: 'd', statements: [], subprocessors: [], changedSince: {},
    acceptance: { version: 2, acceptedAt: '2026-09-22T10:00:00.000Z', acceptedBy: { userId: 'u1', name: 'Aldemir' } },
    current: true, yours: { current: true }, jev: { enabled: true, effective: true, pausedBecause: null },
    ...over,
  };
}

import { CONSENT_SWITCHES, ConsentPanelOpener, NOT_SWITCHES } from './ConsentPanel';

function remote(data: unknown) {
  return { status: 'ok', data, error: null, reload: vi.fn(), set: vi.fn() };
}

function settingsData(over: Record<string, unknown> = {}) {
  return {
    isOwner: true,
    saveAskTraining: vi.fn(() => Promise.resolve(true)),
    writer: { busy: null, failed: null, run: vi.fn(), clear: vi.fn() },
    houseAskTraining: remote({ restaurantId: 'r1', optedOut: false, readable: true, reason: null, statedAt: null, statedBy: null }),
    houseToneScoring: remote({ restaurantId: 'r1', enabled: true, readable: true, reason: null, statedAt: null, statedBy: null }),
    saveToneScoring: vi.fn(() => Promise.resolve(true)),
    ...over,
  } as unknown as SettingsNextData;
}

function trail(over: Record<string, unknown> = {}) {
  return { restaurantId: 'r1', entries: [], readable: true, reason: null, oldestAt: null, recordingSince: '2026-09-03', ...over };
}

function draw(data = settingsData()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <ConsentPanelOpener data={data} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open the consent panel' }));
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  http.get.mockResolvedValue({ data: trail() });
  terms.current = { isPending: false, isError: false, error: null, data: readout() };
});

describe('the consent panel', () => {
  it('reads nothing until it is opened', () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <ConsentPanelOpener data={settingsData()} />
      </QueryClientProvider>,
    );
    expect(http.get).not.toHaveBeenCalled();
    expect(screen.getByText(/3 consents this house gives, with who changed each and when\./)).toBeInTheDocument();
  });

  it('holds only consents the product reads: the training opt-out, Jev and the data terms', async () => {
    expect(CONSENT_SWITCHES.map((s) => s.key)).toEqual(['ask-training', 'tone-scoring', 'data-terms']);
    draw();
    const section = await screen.findByTestId('consent-ask-training');
    expect(within(section).getByRole('switch', { name: /Use this house’s questions to improve Mudavym/ })).toBeInTheDocument();
    expect(http.get).toHaveBeenCalledWith('/settings-audit?register=ask-training&limit=10');
  });

  // F-626: the panel said tone scoring was "not built yet" while the same
  // page carried the switch, and left out the terms acceptance that turns it on.
  it('carries the Jev switch and the data-terms acceptance, each with its own trail', async () => {
    draw();
    const jev = await screen.findByTestId('consent-tone-scoring');
    expect(within(jev).getByRole('button', { name: 'Turn off' })).toBeInTheDocument();
    const accepted = screen.getByTestId('consent-data-terms');
    expect(within(accepted).getByText(/Version 2 accepted by Aldemir on .*That is the current version\./)).toBeInTheDocument();
    expect(http.get).toHaveBeenCalledWith('/settings-audit?register=tone-scoring&limit=10');
    expect(http.get).toHaveBeenCalledWith('/settings-audit?register=data-terms&limit=10');
    expect(screen.queryByText(/not built yet/)).not.toBeInTheDocument();
    expect(NOT_SWITCHES.map((n) => n.title)).not.toContain('Vendor tone scoring');
  });

  it('says terms nobody has accepted, and a terms read that failed, differently', async () => {
    terms.current = { isPending: false, isError: false, error: null, data: readout({ acceptance: null, current: false }) };
    draw();
    expect(await screen.findByText(/No owner has accepted this house’s data and privacy terms yet\./)).toBeInTheDocument();
    cleanup();
    terms.current = { isPending: false, isError: false, error: null, data: readout({ readable: false, reason: 'store offline' }) };
    draw();
    expect(await screen.findByText(/could not be read — store offline\. That is not the same as not accepted\./)).toBeInTheDocument();
  });

  it('is owner only: a manager sees the switch disabled and why', async () => {
    draw(settingsData({ isOwner: false }));
    const section = await screen.findByTestId('consent-ask-training');
    expect(within(section).getByRole('switch')).toBeDisabled();
    expect(within(section).getByText('Only the house’s owner can change this.')).toBeInTheDocument();
  });

  it('shows every flip from the trail, in words', async () => {
    http.get.mockResolvedValue({
      data: trail({
        entries: [
          { id: 'a2', occurredAt: '2026-09-24T10:00:00.000Z', action: 'ask_training_opt_out_changed', register: 'ask-training', entityType: 'restaurant', entityId: 'r1', subject: null, actor: { userId: 'u1', name: 'Aldemir', email: null }, fields: { ask_training_opted_out: { from: false, to: true } } },
          { id: 'a1', occurredAt: '2026-09-23T10:00:00.000Z', action: 'ask_training_opt_out_changed', register: 'ask-training', entityType: 'restaurant', entityId: 'r1', subject: null, actor: { userId: 'u1', name: null, email: null }, fields: { ask_training_opted_out: { from: true, to: false } } },
        ],
      }),
    });
    draw();
    const list = await screen.findByRole('list', { name: 'Changes to Questions and training' });
    expect(within(list).getByText('Aldemir turned it off')).toBeInTheDocument();
    expect(within(list).getByText('Someone the trail cannot name turned it on')).toBeInTheDocument();
  });

  it('says an empty trail is empty since recording began, not "never changed"', async () => {
    draw();
    expect(await screen.findByText(/Nobody has changed it since changes started being recorded on 2026-09-03\./)).toBeInTheDocument();
  });

  it('never draws an unreadable trail as an empty one', async () => {
    http.get.mockResolvedValue({ data: trail({ readable: false, reason: 'log offline' }) });
    draw();
    expect(await screen.findByText(/could not be read — log offline\. This is not the same as nobody having changed it\./)).toBeInTheDocument();
  });

  it('says a failed request the same way', async () => {
    http.get.mockRejectedValue(new Error('gateway down'));
    draw();
    expect(await screen.findByText(/could not be read — gateway down/)).toBeInTheDocument();
  });

  it('names what is not a switch here, and why', async () => {
    draw();
    for (const n of NOT_SWITCHES) {
      expect(await screen.findByText(`${n.title}.`)).toBeInTheDocument();
    }
    expect(screen.getByText(/Nothing in Mudavym reads any of them/)).toBeInTheDocument();
  });
});
