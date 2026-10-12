/**
 * F-750 (S195): the owner of an organisation hands it to a member who owns one
 * of its restaurants, which is what lets their account be deleted later. The
 * card is drawn only for an organisation owner; a failed read says so.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrganisationHandOver } from './OrganisationHandOver';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/api/client', () => ({
  apiClient: { get: api.get, post: api.post },
  getErrorMessage: (e: any) => e?.response?.data?.message ?? e?.message ?? 'error',
}));
vi.mock('../../../services/api/passkeys', () => ({
  sendStepUpCode: vi.fn(() => Promise.resolve({ sent: true, sentTo: 'aylin@example.com', expiresInSeconds: 600 })),
}));

const ORG = {
  id: 'org-1',
  name: 'Meyhane Group',
  candidates: [{ userId: 'user-heir', name: 'Deniz', email: 'deniz@example.com' }],
};

function draw() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrganisationHandOver />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});
afterEach(cleanup);

describe('OrganisationHandOver (F-750)', () => {
  it('draws nothing for someone who owns no organisation', async () => {
    api.get.mockResolvedValue({ data: { organizations: [] } });
    const { container } = draw();
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledWith('/auth/me/organisations'));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it('hands the organisation to the chosen person after a second click, and says what happened', async () => {
    api.get.mockResolvedValue({ data: { organizations: [ORG] } });
    api.post.mockResolvedValue({ data: { organizationId: 'org-1', newOwnerUserId: 'user-heir' } });
    draw();
    const select = await screen.findByLabelText('Meyhane Group: hand it to');
    fireEvent.change(select, { target: { value: 'user-heir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Click again to hand it over' }));
    expect(
      await screen.findByText(/Deniz now owns Meyhane Group\. You stay on as a manager of it/),
    ).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/auth/me/organisations/org-1/hand-over', {
      toUserId: 'user-heir',
      emailCode: undefined,
    });
  });

  it('tells an owner with nobody to hand it to how to make someone eligible', async () => {
    api.get.mockResolvedValue({ data: { organizations: [{ ...ORG, candidates: [] }] } });
    draw();
    expect(await screen.findByText(/Make someone an owner of a restaurant on the Team page first/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hand over' })).not.toBeInTheDocument();
  });

  it('prints the refusal in the gateway\'s words', async () => {
    api.get.mockResolvedValue({ data: { organizations: [ORG] } });
    api.post.mockRejectedValue({ response: { status: 400, data: { message: 'That person is not part of this organisation.' } } });
    draw();
    fireEvent.change(await screen.findByLabelText('Meyhane Group: hand it to'), { target: { value: 'user-heir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));
    fireEvent.click(screen.getByRole('button', { name: 'Click again to hand it over' }));
    expect(
      await screen.findByText(/Meyhane Group was NOT handed over — That person is not part of this organisation/),
    ).toBeInTheDocument();
  });

  it('says so when it cannot read whether the person owns an organisation', async () => {
    api.get.mockRejectedValue({ message: 'Network Error' });
    draw();
    expect(await screen.findByText(/Could not read whether you own an organisation/)).toBeInTheDocument();
  });

  it('keeps the "now owns" line after the refetch lists nothing (F-1461)', async () => {
    api.get.mockResolvedValueOnce({ data: { organizations: [ORG] } }).mockResolvedValue({ data: { organizations: [] } });
    api.post.mockResolvedValue({ data: { organizationId: 'org-1', newOwnerUserId: 'user-heir' } });
    draw();
    fireEvent.change(await screen.findByLabelText('Meyhane Group: hand it to'), { target: { value: 'user-heir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));
    fireEvent.click(screen.getByRole('button', { name: 'Click again to hand it over' }));
    await vi.waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByLabelText('Meyhane Group: hand it to')).not.toBeInTheDocument();
    expect(screen.getByText(/Deniz now owns Meyhane Group\. You stay on as a manager of it/)).toBeInTheDocument();
  });

  it('clears the emailed code after a refusal, so the next try asks for a new one (F-1459)', async () => {
    api.get.mockResolvedValue({ data: { organizations: [ORG] } });
    api.post
      .mockRejectedValueOnce({ response: { status: 403, data: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you.' } } })
      .mockRejectedValueOnce({ response: { status: 400, data: { message: 'Make them an owner of a restaurant first.' } } });
    draw();
    fireEvent.change(await screen.findByLabelText('Meyhane Group: hand it to'), { target: { value: 'user-heir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));
    fireEvent.click(screen.getByRole('button', { name: 'Click again to hand it over' }));
    fireEvent.change(await screen.findByLabelText('The code we emailed you'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }));
    fireEvent.click(screen.getByRole('button', { name: 'Click again to hand it over' }));
    await vi.waitFor(() =>
      expect(api.post).toHaveBeenLastCalledWith('/auth/me/organisations/org-1/hand-over', {
        toUserId: 'user-heir',
        emailCode: '123456',
      }),
    );
    expect(
      await screen.findByText(
        /NOT handed over — Make them an owner of a restaurant first\. The code was cleared: try again and we will email you a new one\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('The code we emailed you')).not.toBeInTheDocument();
  });
});
