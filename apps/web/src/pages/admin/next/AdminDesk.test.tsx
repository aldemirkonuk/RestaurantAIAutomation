import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), role: 'owner', operator: false, mailWatch: true }));
vi.mock('@/services/api/client', () => ({ default: { get: mocks.get, post: mocks.post }, getErrorMessage: (error: Error) => error.message }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'operator-id', restaurantId: 'house-id', role: mocks.role } }) }));
import AdminDesk from './AdminDesk';

beforeEach(() => {
  mocks.role = 'owner'; mocks.operator = false; mocks.mailWatch = true; mocks.post.mockReset();
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/health/access') return { data: { platformOperator: mocks.operator } };
    if (path === '/health/agents') return { data: { agents: [{ agent_name: 'inventory', version: '1', status: 'idle', healthy: true }], observedAt: '2026-09-13T20:00:00Z', scope: 'platform' } };
    if (path === '/health/providers') return { data: { providers: [{ id: 'claude', name: 'Studio Vision', desc: 'Model', status: 'Configured · not probed', configured: true }] } };
    if (path === '/health/ready') return { data: { status: 'ready', checkedAt: '2026-09-13T20:00:00Z', bootedAt: '2026-09-13T19:00:00Z', commit: 'abc123', checks: { database: 'reachable' } } };
    if (path === '/health/agent-operations') return { data: { operations: [] } };
    if (path === '/communications/webhooks/gmail/status') return { data: { configured: mocks.mailWatch, service: 'gmail-watch' } };
    throw new Error(`Unexpected path ${path}`);
  });
});
const open = () => render(<MemoryRouter><AdminDesk /></MemoryRouter>);
const asVisible = () => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });

afterEach(() => { asVisible(); vi.useRealTimers(); });

describe('the Gmail inbound watch (moved here from /communications, ADR 0083 amended 2026-09-25)', () => {
  const watchRow = () => screen.getByTestId('desk-mail-watch');
  it('reads the watch status and says configured', async () => {
    open(); await screen.findByText('inventory');
    await waitFor(() => expect(watchRow()).toHaveTextContent('Configured'));
    expect(mocks.get.mock.calls.some(([path]) => path === '/communications/webhooks/gmail/status')).toBe(true);
    expect(screen.getByText(/does not prove a reply has arrived/)).toBeInTheDocument();
  });
  it('says not configured in words when the gateway answers false', async () => {
    mocks.mailWatch = false;
    open(); await screen.findByText('inventory');
    await waitFor(() => expect(watchRow()).toHaveTextContent('Not configured'));
  });
  it('says a failed status read is a failure, never a configured or unconfigured watch', async () => {
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => path === '/communications/webhooks/gmail/status' ? Promise.reject(new Error('Service unavailable')) : base(path, config));
    open(); await screen.findByText(/The Gmail watch status could not be read/);
    expect(watchRow()).toHaveTextContent('Unavailable');
    expect(watchRow()).not.toHaveTextContent(/configured/i);
  });
  it('keeps the last watch reading in view, marked stale, when a re-read fails', async () => {
    open(); await screen.findByText('inventory');
    await waitFor(() => expect(watchRow()).toHaveTextContent('Configured'));
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => path === '/communications/webhooks/gmail/status' ? Promise.reject(new Error('Service unavailable')) : base(path, config));
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await screen.findByText(/Gmail watch re-read failed, showing the last reading/);
    expect(watchRow()).toHaveTextContent('Configured');
  });
  it('is not read for a manager', async () => {
    mocks.role = 'manager'; open(); await screen.findByText(/This desk is available/);
    expect(mocks.get.mock.calls.some(([path]) => path === '/communications/webhooks/gmail/status')).toBe(false);
  });
});

describe('the operations desk', () => {
  it('shows measured health to an owner without platform controls', async () => {
    open(); await screen.findByText('inventory');
    expect(screen.queryByRole('button', { name: 'Restart' })).not.toBeInTheDocument();
    expect(screen.getByText('reachable')).toBeInTheDocument();
    expect(screen.getByText('Configured · not probed')).toBeInTheDocument();
    expect(mocks.get.mock.calls.some(([path]) => path === '/health/agent-operations')).toBe(false);
  });
  it('keeps a failed agent reading separate from a real empty roster', async () => {
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => path === '/health/agents' ? Promise.reject(new Error('Service unavailable')) : base(path, config));
    open(); await screen.findByText(/Agent health is unavailable/);
    expect(screen.queryByText(/reports no running agents/)).not.toBeInTheDocument();
  });
  it('does not fetch the desk for a staff member without a platform grant', async () => {
    mocks.role = 'staff'; open(); await screen.findByText(/This desk is available/);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('does not read the desk for a manager either — owners and operators only', async () => {
    mocks.role = 'manager'; open(); await screen.findByText(/This desk is available/);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('keeps the last agent reading in view, marked stale, when a re-read fails', async () => {
    open(); await screen.findByText('inventory');
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => path === '/health/agents' ? Promise.reject(new Error('Service unavailable')) : base(path, config));
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await screen.findByText(/re-read failed, showing the last reading/);
    // The kept reading is still on screen — not wiped by the failed re-read.
    expect(screen.getByText('inventory')).toBeInTheDocument();
  });
  it('requires deliberate all-house confirmation and waits for the operation result', async () => {
    mocks.operator = true;
    let resolve!: (value: unknown) => void;
    mocks.post.mockImplementation(() => new Promise(done => { resolve = done; }));
    open(); fireEvent.click(await screen.findByRole('button', { name: 'Restart' }));
    expect(screen.getByText('every house on Mudavym')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm restart' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Type inventory to confirm'), { target: { value: 'inventory' } });
    fireEvent.click(confirm);
    await screen.findByRole('button', { name: 'Waiting for the result…' });
    expect(screen.queryByText('Restart completed.')).not.toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ data: { status: 'succeeded', receiptRecorded: true } }));
    await screen.findByText('Restart completed.');
  });
  it('opens a per-agent drill-down with counters, no error text', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/health/access') return { data: { platformOperator: false } };
      if (path === '/health/agents') return { data: { agents: [{ agent_name: 'inventory', version: '1', status: 'idle', healthy: true }], observedAt: '2026-09-13T20:00:00Z', scope: 'platform' } };
      if (path === '/health/providers') return { data: { providers: [] } };
      if (path === '/health/ready') return { data: { status: 'ready', checkedAt: '2026-09-13T20:00:00Z', bootedAt: '2026-09-13T19:00:00Z', commit: 'abc123', checks: { database: 'reachable' } } };
      if (path === '/health/agents/inventory') return { data: { metrics: { messages: { received: 9, processed: 8, failed: 1, skipped: 0, success_rate: '88.00%' }, timing: { avg_ms: 12.5, min_ms: 1, max_ms: 40, p95_ms: 30 }, health: { errors: 1, circuit_breaker_trips: 0 }, activity: { uptime_seconds: 600, pause_count: 0, restart_count: 2 } }, queue_size: 0, active_tasks: 1, circuit_breaker: { state: 'closed', available: true } } };
      throw new Error(`Unexpected path ${path}`);
    });
    open(); fireEvent.click(await screen.findByText('inventory'));
    await screen.findByText('88.00%');
    expect(screen.getByText('2')).toBeInTheDocument(); // restart_count
    expect(screen.queryByText(/last_error/)).not.toBeInTheDocument();
  });
  it('does not retry an uncertain operation', async () => {
    mocks.operator = true; mocks.post.mockRejectedValue(new Error('The remote outcome is unknown.'));
    open(); fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    fireEvent.change(screen.getByLabelText('Type inventory to confirm'), { target: { value: 'inventory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm stop' }));
    await screen.findByText(/The remote outcome is unknown/);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Stop completed.')).not.toBeInTheDocument();
  });
  it('polls again after 30s while the tab stays visible', async () => {
    vi.useFakeTimers();
    open();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('inventory')).toBeInTheDocument();
    const callsBefore = mocks.get.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.get.mock.calls.length).toBeGreaterThan(callsBefore);
  });
  it('does not read again while the tab is hidden, and reads once more when it becomes visible', async () => {
    open(); await screen.findByText('inventory');
    const callsBefore = mocks.get.mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(mocks.get.mock.calls.length).toBe(callsBefore);
    asVisible();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(callsBefore));
  });
  it('reads again on "r", but not while a sheet is open', async () => {
    mocks.operator = true;
    open(); await screen.findByRole('button', { name: 'Restart' });
    const callsBefore = mocks.get.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Restart' }));
    expect(screen.getByText('every house on Mudavym')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'r' });
    expect(mocks.get.mock.calls.length).toBe(callsBefore);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('every house on Mudavym')).not.toBeInTheDocument());
    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => expect(mocks.get.mock.calls.length).toBeGreaterThan(callsBefore));
  });
  it('filters the agent register by health without folding an unknown reading into either bucket', async () => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === '/health/access') return { data: { platformOperator: false } };
      if (path === '/health/agents') return { data: { agents: [
        { agent_name: 'inventory', version: '1', status: 'idle', healthy: true },
        { agent_name: 'calendar', version: '1', status: 'error', healthy: false },
        { agent_name: 'buffer', version: '1', status: 'idle', healthy: null },
      ], observedAt: '2026-09-13T20:00:00Z', scope: 'platform' } };
      if (path === '/health/providers') return { data: { providers: [] } };
      if (path === '/health/ready') return { data: { status: 'ready', checkedAt: '2026-09-13T20:00:00Z', bootedAt: '2026-09-13T19:00:00Z', commit: 'abc123', checks: { database: 'reachable' } } };
      throw new Error(`Unexpected path ${path}`);
    });
    open(); await screen.findByText('inventory');
    expect(screen.getByText('calendar')).toBeInTheDocument();
    expect(screen.getByText('buffer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
    expect(screen.queryByText('inventory')).not.toBeInTheDocument();
    expect(screen.getByText('calendar')).toBeInTheDocument();
    expect(screen.queryByText('buffer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Healthy' }));
    expect(screen.getByText('inventory')).toBeInTheDocument();
    expect(screen.queryByText('calendar')).not.toBeInTheDocument();
    expect(screen.queryByText('buffer')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('buffer')).toBeInTheDocument();
  });
  it('keeps the last providers reading in view, marked stale, when a re-read fails', async () => {
    open(); await screen.findByText('inventory');
    await screen.findByText('Studio Vision');
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => path === '/health/providers' ? Promise.reject(new Error('Service unavailable')) : base(path, config));
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await screen.findByText(/Provider re-read failed, showing the last reading/);
    expect(screen.getByText('Studio Vision')).toBeInTheDocument();
  });
  it('keeps the last receipts reading in view, marked stale, when a re-read fails', async () => {
    mocks.operator = true;
    open(); await screen.findByText('No platform operation has been recorded.');
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => path === '/health/agent-operations' ? Promise.reject(new Error('Service unavailable')) : base(path, config));
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await screen.findByText(/Receipt re-read failed, showing the last reading/);
  });
  it('names a receipt whose orchestrator record is gone, most likely a restart (ADR 0149 row 42)', async () => {
    mocks.operator = true;
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => path === '/health/agent-operations'
      ? Promise.resolve({ data: { operations: [{ id: 'r1', agent_name: 'inventory', action: 'restart', status: 'unknown', requested_at: '2026-09-13T20:00:00Z', completed_at: null, remote: 'absent' }] } })
      : base(path, config));
    open();
    await screen.findByText(/no record of this request any more/);
  });
  it('keeps reading agent-operations when a permission re-check fails for an already-established operator (P2)', async () => {
    // A role='owner' user (this suite's default) reaches every read via `canRead =
    // role==='owner' || operator` regardless of `knownOperator`'s fallback, and its
    // Restart button is gated by `operator` (from `access.value`, kept stale-but-present
    // by `settle()`) rather than by `knownOperator` — so neither assertion here would
    // fail if the `priorOperator` fallback itself broke. A manager holds the desk only
    // through the operator grant, with no owner role to fall back on: it is the one
    // case where `knownOperator`'s correctness, not `settle`'s stale-value carry-over,
    // decides whether the cycle reads anything at all (measured: wave-5 IJ confirm R2,
    // mutating `knownOperator`'s fallback left all 17 prior tests green).
    mocks.role = 'manager'; mocks.operator = true;
    open(); await screen.findByRole('button', { name: 'Restart' });
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => path === '/health/access' ? Promise.reject(new Error('Service unavailable')) : base(path, config));
    const opsCallsBefore = mocks.get.mock.calls.filter(([path]) => path === '/health/agent-operations').length;
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }));
    await screen.findByText(/could not be re-verified this time/);
    await waitFor(() => expect(mocks.get.mock.calls.filter(([path]) => path === '/health/agent-operations').length).toBeGreaterThan(opsCallsBefore));
    // Operator controls stay up — the cycle fell back to the last confirmed grant
    // rather than treating the failed re-check as a real revocation.
    expect(screen.getByRole('button', { name: 'Restart' })).toBeInTheDocument();
  });
  it('does not reopen a closed drill-down when its read lands late (P1)', async () => {
    let resolveDetail!: (value: unknown) => void;
    const base = mocks.get.getMockImplementation()!;
    mocks.get.mockImplementation((path, config) => path === '/health/agents/inventory'
      ? new Promise(resolve => { resolveDetail = resolve; })
      : base(path, config));
    open(); fireEvent.click(await screen.findByText('inventory'));
    await screen.findByText('Reading…');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Reading…')).not.toBeInTheDocument());
    await act(async () => resolveDetail({ data: { metrics: { messages: { received: 9, processed: 8, failed: 1, skipped: 0, success_rate: '88.00%' }, timing: { avg_ms: 12.5, min_ms: 1, max_ms: 40, p95_ms: 30 }, health: { errors: 1, circuit_breaker_trips: 0 }, activity: { uptime_seconds: 600, pause_count: 0, restart_count: 2 } }, queue_size: 0, active_tasks: 1, circuit_breaker: { state: 'closed', available: true } } }));
    expect(screen.queryByText('88.00%')).not.toBeInTheDocument();
  });
});
