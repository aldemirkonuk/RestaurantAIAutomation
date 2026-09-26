/**
 * A route that was renamed, kept working at its old address (ADR 0221).
 *
 * `/providers` and `/distributors` became `/vendors`. Links outside this app
 * still carry the old paths and cannot be edited: notifications already sent
 * with `action_url: "/providers"` (the gateway's promotion extractor,
 * `promotion-extractor.service.ts`, and the orchestrator's email-intel agent,
 * `email_intel_agent.py`, both build that link), bookmarks, and mail. So the
 * old paths redirect for good, and they carry everything after the renamed
 * prefix — the rest of the path, the query (`?vendor=<id>` opens that card) and
 * the hash — rather than dropping the reader on a bare list.
 *
 * A plain `<Navigate to="/vendors" />` would lose the query, which is the one
 * part that says which vendor the link was about.
 */

import { Navigate, useLocation } from 'react-router-dom';

export interface RenamedLocation {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Where `loc` goes once the path prefix `from` is renamed to `to`.
 *
 * `defaults` are query parameters the old address implied; each is added only
 * when the incoming query does not already name that key, so a link that says
 * more than the old default keeps what it said.
 */
export function renamedTarget(
  loc: RenamedLocation,
  from: string,
  to: string,
  defaults: Record<string, string> = {},
): string {
  const { pathname } = loc;
  const inside = pathname === from || pathname.startsWith(`${from}/`);
  const tail = inside ? pathname.slice(from.length) : '';
  const params = new URLSearchParams(loc.search);
  for (const [key, value] of Object.entries(defaults)) {
    if (!params.has(key)) params.set(key, value);
  }
  const query = params.toString();
  return `${to}${tail}${query ? `?${query}` : ''}${loc.hash}`;
}

/** Redirects the current location from the old prefix to the new one, replacing history. */
export function RenamedRoute({
  from,
  to,
  defaults,
}: {
  from: string;
  to: string;
  defaults?: Record<string, string>;
}) {
  const location = useLocation();
  return <Navigate to={renamedTarget(location, from, to, defaults)} state={location.state} replace />;
}
