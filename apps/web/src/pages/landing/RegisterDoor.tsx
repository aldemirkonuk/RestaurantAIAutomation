/**
 * `/register` has two readers (founder, 2026-10-28):
 *
 * - a stranger who arrives with nothing in the address, from a shared link or
 *   the login page, reads the landing page, the same one `/` shows them;
 * - a person the page sent on, or an invite sent on, gets the sign-up form:
 *   `?type=new` (the landing's "Start free"), `?type=join` (its invite-code
 *   line) and `?invite=CODE` (every invite link, InviteLanding and
 *   InviteTeamDialog) all open Register exactly as before.
 *
 * Any other query (a stray `?type=`) still reads the landing page, so the old
 * two-card chooser is no longer a page a stranger can land on.
 */
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

export function wantsForm(params: URLSearchParams): boolean {
  const type = params.get('type');
  return params.has('invite') || type === 'new' || type === 'join';
}

export function RegisterDoor({ landing, form }: { landing: ReactNode; form: ReactNode }) {
  const [params] = useSearchParams();
  return <>{wantsForm(params) ? form : landing}</>;
}

export default RegisterDoor;
