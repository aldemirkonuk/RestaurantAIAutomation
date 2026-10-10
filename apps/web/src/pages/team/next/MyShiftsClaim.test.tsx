/**
 * F-348 — two staff were offered the same open shift and both tapped "Take it".
 * The gateway now lets one win and answers the other 409 naming who has it.
 * The page must say that (not "it is still open for someone else", which was
 * false) and refetch so the stale button goes.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, configure } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';

configure({ asyncUtilTimeout: 5000 });

const api = vi.hoisted(() => ({
  myWeek: {} as Record<string, unknown>,
  getMyWeek: vi.fn((..._args: unknown[]) => Promise.resolve({} as Record<string, unknown>)),
  assignCover: vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve({})),
}));

vi.mock('../../../services/api/team', () => ({
  getTeamNotes: () =>
    Promise.resolve({ weekStart: '2026-08-31', notes: [], readable: true, reason: null }),
  openTeamNote: vi.fn(() => Promise.resolve({ recorded: true, alreadyOpen: false })),
  getTimeOff: () => Promise.resolve([]),
  getMyWeek: api.getMyWeek,
  acknowledgeSchedule: vi.fn(() => Promise.resolve({})),
  assignCover: api.assignCover,
  createTimeOff: vi.fn(() => Promise.resolve({})),
  getWeek: () => Promise.resolve({}),
  getTeamMembers: () => Promise.resolve([]),
  getCertifications: () => Promise.resolve([]),
  getCoverageTemplates: () => Promise.resolve([]),
  getTeamSettings: () => Promise.resolve({}),
  getMemberPerformance: () => Promise.resolve({ hasData: false }),
}));

vi.mock('../../../services/api/client', () => ({
  apiClient: {
    get: () =>
      Promise.resolve({
        data: { entries: [], readable: true, reason: null, oldestAt: null, recordingSince: '2026-09-03' },
      }),
  },
  getErrorMessage: () => 'error',
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'staff',
    user: { id: 'u1', restaurantId: 'r1', role: 'staff' },
  }),
}));

import { MyShiftsNext } from './MyShiftsNext';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const openShift = {
  id: 's-open',
  restaurant_id: 'r1',
  schedule_id: 'sch1',
  member_id: null,
  shift_date: '2026-09-07',
  start_time: '09:00',
  end_time: '17:00',
  role: null,
  state: 'open',
  shift_breaks: [],
};

beforeEach(() => {
  api.getMyWeek.mockReset();
  api.assignCover.mockReset();
  api.getMyWeek.mockImplementation(() =>
    Promise.resolve({
      member: { id: 'm-ali', display_name: 'Ali' },
      schedule: null,
      mine: [],
      open: [openShift],
      acknowledged: false,
    }),
  );
});

describe('F-348 — a claim that lost says who has the shift', () => {
  it('shows who took it and refetches the week', async () => {
    api.assignCover.mockImplementation(() =>
      Promise.reject(
        Object.assign(new Error('Request failed with status code 409'), {
          response: { status: 409, data: { message: 'Bea has already taken this shift.' } },
        }),
      ),
    );
    render(<MyShiftsNext />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Take it' }));

    expect(await screen.findByText('Bea has already taken this shift.')).toBeInTheDocument();
    expect(screen.queryByText(/still open for someone else/)).not.toBeInTheDocument();
    await vi.waitFor(() => expect(api.getMyWeek).toHaveBeenCalledTimes(2));
  });

  it('any other failure does not claim the shift is still open', async () => {
    api.assignCover.mockImplementation(() =>
      Promise.reject(Object.assign(new Error('Network Error'), { response: undefined })),
    );
    render(<MyShiftsNext />, { wrapper });
    fireEvent.click(await screen.findByRole('button', { name: 'Take it' }));

    expect(await screen.findByText('The shift was not claimed. Try again.')).toBeInTheDocument();
    expect(screen.queryByText(/still open for someone else/)).not.toBeInTheDocument();
  });
});
