/**
 * The /team forms tell the truth about what they save (F-713, F-714, F-718).
 *
 * F-713: an edit sent an emptied box as `undefined`, which the gateway reads
 * as "leave it", so a wrong email, phone, wage or certificate expiry could
 * never be taken off.
 * F-714: an email the gateway's `@IsEmail()` refuses, or a negative wage,
 * reached the gateway and came back as a banner with no reason.
 * F-718: a cleared "People" box saved a rule for no one, and the same rule
 * could be added twice.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({
  createTeamMember: vi.fn((..._a: unknown[]) => Promise.resolve({})),
  updateTeamMember: vi.fn((..._a: unknown[]) => Promise.resolve({})),
  updateCertification: vi.fn((..._a: unknown[]) => Promise.resolve({})),
  createCoverageTemplate: vi.fn((..._a: unknown[]) => Promise.resolve({})),
}));

vi.mock('../../../services/api/team', () => ({
  createTeamMember: api.createTeamMember,
  updateTeamMember: api.updateTeamMember,
  deleteTeamMember: vi.fn(() => Promise.resolve({})),
  getHandoverPreview: vi.fn(() => Promise.resolve({})),
  setMemberPayAccess: vi.fn(),
  createCertification: vi.fn(() => Promise.resolve({})),
  updateCertification: api.updateCertification,
  deleteCertification: vi.fn(() => Promise.resolve(undefined)),
  createCoverageTemplate: api.createCoverageTemplate,
  deleteCoverageTemplate: vi.fn(() => Promise.resolve({})),
}));

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    activeRestaurantId: 'r1',
    activeRole: 'owner',
    user: { userId: 'u-owner', restaurantId: 'r1', role: 'owner' },
  }),
}));

import { MemberSheet, memberFormRefusal, memberSaveRefusal } from './RosterSheet';
import { CertificationsSheet } from './CertificationsSheet';
import { CoverageRuleForm, coverageRuleRefusal } from './CoverageRulesSheet';
import type { CoverageRule } from './useTeamNextData';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const row = {
  id: 'm1',
  restaurant_id: 'r1',
  user_id: null,
  display_name: 'Ayşe Yılmaz',
  email: 'ayse@tuzlu.com.tr',
  phone: '0532 000 00 00',
  position: 'Server',
  employment_type: 'full_time',
  home_location: 'Kadıköy',
  hourly_wage: 150,
  skills: [],
  status: 'active',
  notes: 'old note',
  role: 'staff',
};

function draw(member: typeof row | null) {
  render(
    <MemberSheet
      member={member as never}
      moneyVisible
      viewerIsOwner
      ownerCount={2}
      onClose={() => {}}
      onChanged={() => {}}
    />,
    { wrapper },
  );
}

const box = (value: string) => screen.getByDisplayValue(value);

beforeEach(() => {
  api.createTeamMember.mockReset().mockResolvedValue({});
  api.updateTeamMember.mockReset().mockResolvedValue({});
  api.updateCertification.mockReset().mockResolvedValue({});
  api.createCoverageTemplate.mockReset().mockResolvedValue({});
});

describe('an edit can take a field off (F-713)', () => {
  it('sends an emptied box as null, which the gateway writes as none', async () => {
    draw(row);
    for (const v of ['ayse@tuzlu.com.tr', '0532 000 00 00', 'Server', 'Kadıköy', '150', 'old note']) {
      fireEvent.change(box(v), { target: { value: '' } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateTeamMember).toHaveBeenCalled());
    expect(api.updateTeamMember.mock.calls[0][1]).toMatchObject({
      email: null,
      phone: null,
      position: null,
      homeLocation: null,
      hourlyWage: null,
      notes: null,
    });
  });

  it('leaves blank boxes out of a new person, and an unknown wage unknown', async () => {
    draw(null);
    const [name] = screen.getAllByRole('textbox');
    fireEvent.change(name, { target: { value: 'Elif' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to the roster' }));
    await waitFor(() => expect(api.createTeamMember).toHaveBeenCalled());
    const sent = api.createTeamMember.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.email).toBeUndefined();
    expect(sent.hourlyWage).toBeUndefined();
    expect(sent.notes).toBeUndefined();
  });
});

describe('a refusal is said in words, before and after the click (F-714)', () => {
  it('refuses an address with no domain ending, as the gateway does', () => {
    expect(memberFormRefusal({ email: 'ayse@tuzlu', hourlyWage: '' })).toMatch(/not a full address/);
    expect(memberFormRefusal({ email: 'ayse@tuzlu.com', hourlyWage: '' })).toBeNull();
    expect(memberFormRefusal({ email: '', hourlyWage: '' })).toBeNull();
  });

  it('refuses a negative wage and keeps zero and decimals', () => {
    expect(memberFormRefusal({ email: '', hourlyWage: '-5' })).toMatch(/zero or more/);
    expect(memberFormRefusal({ email: '', hourlyWage: '0' })).toBeNull();
    expect(memberFormRefusal({ email: '', hourlyWage: '152.50' })).toBeNull();
  });

  it('holds the save and names the problem on the sheet', () => {
    draw(row);
    fireEvent.change(box('ayse@tuzlu.com.tr'), { target: { value: 'ayse@tuzlu' } });
    expect(screen.getByTestId('member-form-refusal')).toHaveTextContent(/not a full address/);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('turns the gateway’s field text into words, never the field name', () => {
    const err = {
      response: { data: { message: ['email must be an email', 'hourlyWage must not be less than 0'] } },
    };
    const said = memberSaveRefusal(err)!;
    expect(said).toMatch(/email is not a full address/);
    expect(said).toMatch(/wage must be a number of zero or more/);
    expect(said).not.toMatch(/hourlyWage/);
    expect(memberSaveRefusal(new Error('Network Error'))).toBeNull();
  });
});

describe('a certificate can lose a wrong expiry (F-713)', () => {
  it('sends an emptied expiry as null', async () => {
    render(
      <CertificationsSheet
        open
        member={{ id: 'm1', display_name: 'Elif Şahin' } as never}
        certs={[
          {
            id: 'c1',
            member_id: 'm1',
            cert_type: 'food-handler',
            issued_at: '2025-08-01',
            expires_at: '2026-08-20',
            doc_url: null,
            status: 'expired',
          },
        ]}
        restaurantId="r1"
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByTestId('cert-edit'));
    fireEvent.change(screen.getByTestId('cert-expires'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('cert-save'));
    await waitFor(() => expect(api.updateCertification).toHaveBeenCalled());
    expect(api.updateCertification.mock.calls[0][1]).toMatchObject({ expiresAt: null });
  });
});

describe('a coverage rule asks for someone, once (F-718)', () => {
  const bar: CoverageRule = { id: 't1', role: 'Bar', day_of_week: 5, shift_period: 'pm', min_staff: 2 };
  const form = { role: 'Bar', dayOfWeek: '5', shiftPeriod: 'pm', minStaff: '1' };

  it('refuses a blank, zero or fractional number of people', () => {
    for (const minStaff of ['', '0', '2.5']) {
      expect(coverageRuleRefusal({ ...form, role: 'Floor', minStaff }, [])).toMatch(/at least 1/);
    }
    expect(coverageRuleRefusal({ ...form, role: 'Floor' }, [bar])).toBeNull();
  });

  it('refuses the same role, day and service already on file, whatever the case', () => {
    expect(coverageRuleRefusal({ ...form, role: ' bar ' }, [bar])).toMatch(/already on file/);
    expect(coverageRuleRefusal({ ...form, dayOfWeek: '' }, [bar])).toBeNull();
    expect(coverageRuleRefusal({ ...form, shiftPeriod: 'am' }, [bar])).toBeNull();
  });

  it('holds the button with an emptied People box, and sends nothing', () => {
    render(<CoverageRuleForm weekStart="2026-10-05" rules={[bar]} />, { wrapper });
    const [role] = screen.getAllByRole('textbox');
    fireEvent.change(role, { target: { value: 'Floor' } });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(screen.getByTestId('rule-refusal')).toHaveTextContent(/at least 1/);
    const add = screen.getByRole('button', { name: 'Add coverage rule' });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(api.createCoverageTemplate).not.toHaveBeenCalled();
  });
});

// F-933: the gateway refuses a manager removing an owner, so a manager is not
// offered a Remove on a co-owner's row; an owner still is.
describe('Remove on an owner follows who is looking (F-933)', () => {
  const coOwner = { ...row, id: 'm-own', user_id: 'u-co', role: 'owner' };
  function drawAs(viewerIsOwner: boolean) {
    render(
      <MemberSheet
        member={coOwner as never}
        moneyVisible={false}
        viewerIsOwner={viewerIsOwner}
        ownerCount={2}
        onClose={() => {}}
        onChanged={() => {}}
      />,
      { wrapper },
    );
  }

  it('a manager sees why there is no Remove, not a Remove that always fails', () => {
    drawAs(false);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByText(/Only an owner can remove an owner/)).toBeInTheDocument();
  });

  it('an owner is offered Remove on a co-owner', () => {
    drawAs(true);
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    expect(screen.queryByText(/Only an owner can remove an owner/)).toBeNull();
  });
});
