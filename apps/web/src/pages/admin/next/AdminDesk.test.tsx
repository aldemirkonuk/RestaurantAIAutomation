import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), role: 'owner', operator: false }));
vi.mock('@/services/api/client', () => ({ default: { get: mocks.get, post: mocks.post }, getErrorMessage: (error: Error) => error.message }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { userId: 'operator-id', restaurantId: 'house-id', role: mocks.role } }) }));
import AdminDesk from './AdminDesk';

beforeEach(() => {
  mocks.role = 'owner'; mocks.operator = false; mocks.post.mockReset();
  mocks.get.mockReset().mockImplementation(async (path: string) => {
    if (path === '/health/access') return { data: { platformOperator: mocks.operator } };
    if (path === '/health/agents') return { data: { agents: [{ agent_name: 'inventory', version: '1', status: 'idle', healthy: true }], observedAt: '2026-09-13T20:00:00Z', scope: 'platform' } };
    if (path === '/health/providers') return { data: { providers: [{ id: 'claude', name: 'Studio Vision', desc: 'Model', status: 'Configured · not probed', configured: true }] } };
    if (path === '/health/ready') return { data: { status: 'ready', checkedAt: '2026-09-13T20:00:00Z', bootedAt: '2026-09-13T19:00:00Z', commit: 'abc123', checks: { database: 'reachable' } } };
    if (path === '/health/agent-operations') return { data: { operations: [] } };
    throw new Error(`Unexpected path ${path}`);
  });
});
const open = () => render(<MemoryRouter><AdminDesk /></MemoryRouter>);

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
  it('does not retry an uncertain operation', async () => {
    mocks.operator = true; mocks.post.mockRejectedValue(new Error('The remote outcome is unknown.'));
    open(); fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    fireEvent.change(screen.getByLabelText('Type inventory to confirm'), { target: { value: 'inventory' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm stop' }));
    await screen.findByText(/The remote outcome is unknown/);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Stop completed.')).not.toBeInTheDocument();
  });
});
