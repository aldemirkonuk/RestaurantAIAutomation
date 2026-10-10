import { describe, expect, it } from 'vitest';
import { actLine } from './counterRows';

/**
 * F-176: eight pending invitations printed as eight identical rows, "An
 * invitation as staff, not yet accepted · expires Oct 9", with nothing to say
 * what the owner could do about one, or that all eight ended the next day.
 * An invitation is a code, not a person (organization_invites carries no name
 * or email), so the row cannot name the invitee; it can say what the owner
 * decides and where.
 */
const HOUR = 3_600_000;

function row(over: { role?: string | null; expiresAt?: string | null } = {}) {
  return {
    id: 'inv-1',
    role: 'role' in over ? over.role! : 'staff',
    expiresAt: 'expiresAt' in over ? over.expiresAt! : new Date(Date.now() + 5 * 24 * HOUR).toISOString(),
    createdAt: new Date(Date.now() - 24 * HOUR).toISOString(),
  };
}

describe('the counter invitation row says what the owner decides', () => {
  it('names the role and that nobody has used it, and points to Team for the act', () => {
    const l = actLine('invitations', row(), null);
    expect(l.what).toBe('A staff invitation nobody has used yet');
    expect(l.detail).toMatch(/^ends .+ · send it again or withdraw it on Team$/);
  });

  it('says when it ends within a day', () => {
    const l = actLine('invitations', row({ expiresAt: new Date(Date.now() + 6 * HOUR).toISOString() }), null);
    expect(l.detail).toMatch(/^ends within a day \(.+\) · send it again or withdraw it on Team$/);
  });

  it('says an invitation that has run out has run out', () => {
    const l = actLine('invitations', row({ expiresAt: new Date(Date.now() - 2 * HOUR).toISOString() }), null);
    expect(l.detail).toMatch(/^ran out .+ · withdraw it or send a new one on Team$/);
  });

  it('prints a missing role or expiry as missing, with the right article', () => {
    expect(actLine('invitations', row({ role: 'owner' }), null).what).toBe('An owner invitation nobody has used yet');
    expect(actLine('invitations', row({ role: null }), null).what).toBe('An invitation (role not recorded) nobody has used yet');
    expect(actLine('invitations', row({ expiresAt: null }), null).detail).toBe(
      'no end date recorded · send it again or withdraw it on Team',
    );
  });
});
