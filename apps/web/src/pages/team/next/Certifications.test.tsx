/**
 * "Certifications on file" — the owed act on `/team`.
 *
 * THE REGRESSION. The rebuilt roster could READ credentials and write none: the
 * expanded row's Credentials card is a list. Every assertion under "the file can
 * be written" fails against it, because the four calls it makes had no caller on
 * the rebuilt page at all — the only place they were made from is the legacy
 * desk that packet 4 deletes.
 *
 * The two lines the sheet must not cross:
 *   - an UNREADABLE file is not an empty one (filing a duplicate on the strength
 *     of a failed read is the harm);
 *   - the status is the SERVER's word, never worked out again here.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const team = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/services/api/team', () => ({
  createCertification: (...a: unknown[]) => team.create(...a),
  updateCertification: (...a: unknown[]) => team.update(...a),
  deleteCertification: (...a: unknown[]) => team.remove(...a),
}));

vi.mock('@/services/api/client', () => ({
  getErrorMessage: (e: unknown) => (e as { message?: string })?.message ?? 'unknown error',
}));

import { CertificationsSheet, certRefusal, STATUS_WORDS, EMPTY_CERT } from './CertificationsSheet';
import type { Certification, TeamMember } from '@/services/api/team';

const MEMBER = { id: 'm1', display_name: 'Elif Şahin' } as unknown as TeamMember;

const CERTS: Certification[] = [
  {
    id: 'c1',
    member_id: 'm1',
    cert_type: 'food-handler',
    issued_at: '2025-08-01',
    expires_at: '2026-08-20',
    doc_url: null,
    status: 'expired',
  },
  {
    id: 'c2',
    member_id: 'm2',
    cert_type: 'alcohol-service',
    issued_at: null,
    expires_at: null,
    doc_url: null,
    status: 'valid',
  },
];

function draw(over: Partial<React.ComponentProps<typeof CertificationsSheet>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChanged = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <CertificationsSheet
        open
        member={MEMBER}
        certs={CERTS}
        restaurantId="rest-A"
        onClose={() => {}}
        onChanged={onChanged}
        {...over}
      />
    </QueryClientProvider>,
  );
  return { onChanged };
}

beforeEach(() => {
  team.create.mockReset().mockResolvedValue({});
  team.update.mockReset().mockResolvedValue({});
  team.remove.mockReset().mockResolvedValue(undefined);
});

describe('the shape', () => {
  it('is a sheet — one person’s certificates are one record', () => {
    draw();
    const dialog = screen.getByRole('dialog');
    expect(dialog.closest('.mdv-ovl')).toHaveAttribute('data-shape', 'sheet');
    expect(dialog).toHaveAttribute('data-motion', 'tuck');
    expect(screen.getByRole('button', { name: 'Close the file' })).toBeInTheDocument();
  });

  it('shows only this person’s file', () => {
    draw();
    const rows = screen.getAllByTestId('cert-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('food-handler');
    expect(screen.queryByText('alcohol-service')).toBeNull();
  });
});

describe('the file can be written — the four calls the rebuilt page never made', () => {
  it('files one, tenant-scoped and against this member', async () => {
    const { onChanged } = draw();
    fireEvent.change(screen.getByTestId('cert-type'), { target: { value: ' allergen ' } });
    fireEvent.change(screen.getByTestId('cert-expires'), { target: { value: '2027-01-01' } });
    fireEvent.click(screen.getByTestId('cert-save'));
    await waitFor(() => expect(team.create).toHaveBeenCalled());
    expect(team.create).toHaveBeenCalledWith(
      { memberId: 'm1', certType: 'allergen', issuedAt: undefined, expiresAt: '2027-01-01' },
      'rest-A',
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('corrects one already on file, and never files a second', async () => {
    draw();
    fireEvent.click(screen.getByTestId('cert-edit'));
    expect(screen.getByTestId('cert-form-head')).toHaveTextContent('Correcting a certificate');
    expect(screen.getByTestId('cert-type')).toHaveValue('food-handler');
    fireEvent.change(screen.getByTestId('cert-expires'), { target: { value: '2027-08-20' } });
    fireEvent.click(screen.getByTestId('cert-save'));
    await waitFor(() =>
      expect(team.update).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ certType: 'food-handler', expiresAt: '2027-08-20' }),
        'rest-A',
      ),
    );
    expect(team.create).not.toHaveBeenCalled();
  });

  it('takes one off the file', async () => {
    draw();
    fireEvent.click(screen.getByTestId('cert-remove'));
    await waitFor(() => expect(team.remove).toHaveBeenCalledWith('c1', 'rest-A'));
  });

  it('leaves an edit without writing anything', () => {
    draw();
    fireEvent.click(screen.getByTestId('cert-edit'));
    fireEvent.click(screen.getByTestId('cert-cancel'));
    expect(screen.getByTestId('cert-type')).toHaveValue('');
    expect(team.update).not.toHaveBeenCalled();
  });
});

describe('four states, honestly', () => {
  it('never draws an unreadable file as an empty one', () => {
    draw({ certs: null });
    expect(screen.getByTestId('cert-unreadable')).toHaveTextContent(
      /failed read, not an empty file/,
    );
    expect(screen.queryByTestId('cert-list')).toBeNull();
  });

  it('says an empty file is empty, and not a clean one', () => {
    draw({ certs: [] });
    expect(screen.getByTestId('cert-empty')).toHaveTextContent(/an empty file, not a clean one/);
  });

  it('says what did not happen when a write is refused', async () => {
    team.create.mockRejectedValue(new Error('duplicate'));
    draw();
    fireEvent.change(screen.getByTestId('cert-type'), { target: { value: 'allergen' } });
    fireEvent.click(screen.getByTestId('cert-save'));
    await waitFor(() =>
      expect(screen.getByTestId('cert-failure')).toHaveTextContent(
        /was not filed \(duplicate\)\. Nothing was written/,
      ),
    );
    expect(screen.getByTestId('cert-type')).toHaveValue('allergen');
  });

  it('says a removal that failed left it on file', async () => {
    team.remove.mockRejectedValue(new Error('locked'));
    draw();
    fireEvent.click(screen.getByTestId('cert-remove'));
    await waitFor(() =>
      expect(screen.getByTestId('cert-failure')).toHaveTextContent(/It is still on file/),
    );
  });

  it('refuses a certificate that expires before it was issued, and writes nothing', () => {
    draw();
    fireEvent.change(screen.getByTestId('cert-type'), { target: { value: 'allergen' } });
    fireEvent.change(screen.getByTestId('cert-issued'), { target: { value: '2026-05-01' } });
    fireEvent.change(screen.getByTestId('cert-expires'), { target: { value: '2026-01-01' } });
    fireEvent.click(screen.getByTestId('cert-save'));
    expect(screen.getByTestId('cert-refusal')).toHaveTextContent(/cannot expire before/);
    expect(team.create).not.toHaveBeenCalled();
  });
});

describe('what the record says, and what it cannot', () => {
  it('renders the server’s status word and never derives one', () => {
    draw();
    expect(screen.getByTestId('cert-status')).toHaveTextContent('expired');
    expect(screen.getByTestId('cert-dates-note')).toHaveTextContent(
      /never decides it a second time/,
    );
  });

  it('shows a missing expiry as a dash with its reason, never as today', () => {
    draw({
      certs: [{ ...CERTS[0], id: 'c9', expires_at: null, issued_at: null }],
    });
    expect(screen.getByTestId('cert-row')).toHaveTextContent(/no expiry recorded/);
  });

  it('says the file has no column for which shifts require it', () => {
    draw();
    expect(
      screen.getByText(/which shifts require it is not\s+recorded — the file has no column for it/),
    ).toBeInTheDocument();
  });
});

describe('certRefusal and STATUS_WORDS, on their own', () => {
  it('refuses an unnamed certificate and an impossible pair, and nothing else', () => {
    expect(certRefusal(EMPTY_CERT)).toMatch(/Name the certificate/);
    expect(certRefusal({ certType: 'x', issuedAt: '', expiresAt: '' })).toBeNull();
    // No expiry is ordinary and is not refused.
    expect(certRefusal({ certType: 'x', issuedAt: '2026-01-01', expiresAt: '' })).toBeNull();
    expect(certRefusal({ certType: 'x', issuedAt: '2026-05-01', expiresAt: '2026-01-01' })).toMatch(
      /cannot expire before/,
    );
  });

  it('gives each server status its own words', () => {
    expect(Object.keys(STATUS_WORDS).sort()).toEqual([
      'expired',
      'expiring',
      'submitted',
      'valid',
    ]);
    expect(STATUS_WORDS.submitted).toMatch(/not yet checked/);
  });
});
