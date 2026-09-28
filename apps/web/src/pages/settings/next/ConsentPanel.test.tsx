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
    expect(screen.getByText(/One consent this house gives, with who changed it and when\./)).toBeInTheDocument();
  });

  it('holds only switches the product reads: today, the training opt-out', async () => {
    expect(CONSENT_SWITCHES.map((s) => s.key)).toEqual(['ask-training']);
    draw();
    const section = await screen.findByTestId('consent-ask-training');
    expect(within(section).getByRole('switch', { name: /Use this house’s questions to improve Mudavym/ })).toBeInTheDocument();
    expect(http.get).toHaveBeenCalledWith('/settings-audit?register=ask-training&limit=10');
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
