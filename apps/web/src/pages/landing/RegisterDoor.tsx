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
 * Any other query (a stray `?type=`, or an `?invite=` with no code) still reads
 * the landing page, so the old two-card chooser is no longer a page a stranger
 * can land on (empty invite: founder, 2026-10-29).
 */
import { useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SITE, titleWithSite } from '../../lib/seo/site';

export function wantsForm(params: URLSearchParams): boolean {
  const type = params.get('type');
  return !!params.get('invite') || type === 'new' || type === 'join';
}

export function RegisterDoor({ landing, form }: { landing: ReactNode; form: ReactNode }) {
  const [params] = useSearchParams();
  const showForm = wantsForm(params);
  // The tab names what is drawn. RouteHead keys on the path alone, and its
  // registry head for /register is the landing's (seo/routes.ts), so the door
  // that picks between the two names the form itself, and names the landing
  // again when a Back button drops the query.
  useEffect(() => {
    document.title = showForm ? titleWithSite('Create an account') : SITE.name;
  }, [showForm]);
  return <>{showForm ? form : landing}</>;
}

export default RegisterDoor;
