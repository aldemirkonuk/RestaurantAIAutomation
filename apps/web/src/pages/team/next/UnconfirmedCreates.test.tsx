/**
 * A create whose answer never came back (F-1083, rehit of F-338).
 *
 * The shift sheet and the roster sheet said "Nothing was saved" after a
 * timeout or a 5xx, and the gateway may have written the row before the answer
 * was lost, so "try again" wrote it twice. They now say it may already be
 * there, read the page again, and send one key per draft so a second try with
 * the same values gets the row already written. The vendor twin panel (on
 * /vendors) had the same sentence; it is kept here so the six sites are proved
 * in few files (the calendar's two live beside their own pages).
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({
  createShift: vi.fn((..._a: unknown[]) => Promise.resolve({})),
  createTeamMember: vi.fn((..._a: unknown[]) => Promise.resolve({})),
  addProviderFromCatalogue: vi.fn((..._a: unknown[]) => Promise.resolve({})),
}));

vi.mock('../../../services/api/team', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api/team')>()),
  createShift: api.createShift,
  createTeamMember: api.createTeamMember,
}));
vi.mock('@/services/api/vendors', () => ({
  addProviderFromCatalogue: api.addProviderFromCatalogue,
}));
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { userId: 'u-owner', restaurantId: 'r1', role: 'owner' },
  }),
}));

import { ShiftSheet } from './ShiftSheet';
import { MemberSheet } from './RosterSheet';
import { VendorTwinPanel } from '../../providers/next/VendorTwinPanel';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const timeout = () =>
  Object.assign(new Error('timeout of 30000ms exceeded'), {
    isAxiosError: true,
    request: {},
    response: undefined,
  });
const fault = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { statusCode: status, message: 'Internal server error' } },
  });
const refused = () =>
  Object.assign(new Error('Request failed with status code 400'), {
    response: { status: 400, data: { message: 'endTime must be after startTime' } },
  });

beforeEach(() => {
  api.createShift.mockReset().mockResolvedValue({});
  api.createTeamMember.mockReset().mockResolvedValue({});
  api.addProviderFromCatalogue.mockReset().mockResolvedValue({});
});

describe('the shift sheet', () => {
  function drawShift(onChanged = vi.fn()) {
    render(
      <ShiftSheet target={{ date: '2026-09-07' }} members={[]} scheduleId="sch1" onClose={() => {}} onChanged={onChanged} />,
      { wrapper },
    );
    return onChanged;
  }

  it('says the shift may already be on the schedule after a timeout, and reads the week again', async () => {
    api.createShift.mockRejectedValue(timeout());
    const onChanged = drawShift();
    fireEvent.click(screen.getByRole('button', { name: 'Add the shift' }));
    expect(await screen.findByText(/may already be on the schedule/)).toBeTruthy();
    expect(screen.queryByText(/schedule is unchanged/)).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it('says the same after a 5xx, not the server’s own words', async () => {
    api.createShift.mockRejectedValue(fault(500));
    drawShift();
    fireEvent.click(screen.getByRole('button', { name: 'Add the shift' }));
    expect(await screen.findByText(/No answer came back/)).toBeTruthy();
    expect(screen.queryByText('Internal server error')).toBeNull();
  });

  it('keeps the refusal words for a 4xx', async () => {
    api.createShift.mockRejectedValue(refused());
    const onChanged = drawShift();
    fireEvent.click(screen.getByRole('button', { name: 'Add the shift' }));
    expect(await screen.findByText('endTime must be after startTime')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('sends the same key when the same shift is tried again', async () => {
    api.createShift.mockRejectedValue(fault(503));
    drawShift();
    const add = screen.getByRole('button', { name: 'Add the shift' });
    fireEvent.click(add);
    await waitFor(() => expect(api.createShift).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(add).not.toBeDisabled());
    fireEvent.click(add);
    await waitFor(() => expect(api.createShift).toHaveBeenCalledTimes(2));
    const [first, second] = api.createShift.mock.calls.map((c) => c[2]);
    expect(first).toMatch(/^shift:/);
    expect(second).toBe(first);
  });
});

describe('the roster sheet', () => {
  function drawMember(onChanged = vi.fn()) {
    render(
      <MemberSheet member={null} moneyVisible viewerIsOwner ownerCount={2} onClose={() => {}} onChanged={onChanged} />,
      { wrapper },
    );
    const [name] = screen.getAllByRole('textbox');
    fireEvent.change(name, { target: { value: 'Elif' } });
    return onChanged;
  }

  it('says the person may already be on the roster after a timeout, and reads it again', async () => {
    api.createTeamMember.mockRejectedValue(timeout());
    const onChanged = drawMember();
    fireEvent.click(screen.getByRole('button', { name: 'Add to the roster' }));
    expect(await screen.findByText(/may already be on the roster/)).toBeTruthy();
    expect(screen.queryByText(/Nothing was saved/)).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it('keeps "Nothing was saved" for a refusal', async () => {
    api.createTeamMember.mockRejectedValue(refused());
    drawMember();
    fireEvent.click(screen.getByRole('button', { name: 'Add to the roster' }));
    expect(await screen.findByText(/Nothing was saved/)).toBeTruthy();
  });

  it('sends one key per draft: the same on a retry, a new one once the values change', async () => {
    api.createTeamMember.mockRejectedValue(fault(502));
    drawMember();
    const add = screen.getByRole('button', { name: 'Add to the roster' });
    fireEvent.click(add);
    await waitFor(() => expect(api.createTeamMember).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(add).not.toBeDisabled());
    fireEvent.click(add);
    await waitFor(() => expect(api.createTeamMember).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(add).not.toBeDisabled());
    const [name] = screen.getAllByRole('textbox');
    fireEvent.change(name, { target: { value: 'Elif Kaya' } });
    fireEvent.click(add);
    await waitFor(() => expect(api.createTeamMember).toHaveBeenCalledTimes(3));
    const keys = api.createTeamMember.mock.calls.map((c) => c[2]);
    expect(keys[0]).toMatch(/^team-member:/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });
});

describe('the vendor twin panel', () => {
  const cat = {
    kind: 'catalogue' as const,
    id: 'cat-1',
    confidence: 0.88,
    vendor: {
      id: 'cat-1',
      name: 'Sevilen Şarapları',
      type: 'importer' as const,
      country: 'TR',
      state: null,
      city: 'İzmir',
      address: null,
      name_similarity: 0.88,
      address_similarity: null,
    },
  } as never;

  it('says the vendor may already be in the book after a timeout', async () => {
    api.addProviderFromCatalogue.mockRejectedValue(timeout());
    render(<VendorTwinPanel open context="add" match={cat} onKeepBoth={() => {}} />);
    fireEvent.click(screen.getByTestId('twin-use-existing'));
    await waitFor(() =>
      expect(screen.getByTestId('twin-failure')).toHaveTextContent(/may already be in the book/),
    );
    expect(screen.getByTestId('twin-failure')).not.toHaveTextContent(/Nothing was written/);
  });

  it('keeps "Nothing was written" for a refusal', async () => {
    api.addProviderFromCatalogue.mockRejectedValue(refused());
    render(<VendorTwinPanel open context="add" match={cat} onKeepBoth={() => {}} />);
    fireEvent.click(screen.getByTestId('twin-use-existing'));
    await waitFor(() =>
      expect(screen.getByTestId('twin-failure')).toHaveTextContent(/Nothing was written/),
    );
  });
});
