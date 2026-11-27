/**
 * Every owner meets the data terms at their next sign-in (ADR 0207 round 5,
 * question 19).
 *
 * THE FOUNDER, 2026-09-22, round 6z, his pick — over the recommended
 * "only to turn Jev on" — having been told what it costs: "Every owner,
 * next sign-in." Because accepting bundles Jev in (question 13's own
 * ruling), every house whose owner accepts now has Jev turned on for it;
 * he chose that anyway. This REPLACES "Off until switched on" as the thing
 * that decides whether Jev ends up on for a house — see ADR 0207 §19 for
 * the record.
 *
 * [2026-09-25, settings-b lane: "every owner" is read as EACH owner. The
 * sheet shows until THIS owner has accepted the current version
 * (`yours.current`). A co-owner's acceptance makes the house current, but it
 * does not satisfy this owner's gate. Only the house's FIRST acceptance turns
 * Jev on, and a later owner's acceptance leaves the switch where an owner put
 * it. This was built, not ruled; see ADR 0207 question 19.]
 *
 * WHAT "NEXT SIGN-IN" MEANS HERE: every authenticated page load, for as
 * long as the signed-in person is an owner and has not accepted the CURRENT
 * terms version. There is no per-session "seen it, go away" flag — the
 * founder's words are "must accept to continue," so the sheet returns at
 * the very next load exactly because nothing here remembers a dismissal
 * (there is none to remember: `DataTermsAcceptSheet` renders non-dismissable
 * here).
 *
 * WHAT NEVER HAPPENS:
 *   - A manager or staff member sees this. `isOwner` gates the query itself
 *     (`enabled: isOwner`), so nobody else even fetches `/settings/data-terms`
 *     on their account, let alone renders a sheet from it.
 *   - An unreadable store locks anyone out of the app. `q.data` stays
 *     undefined until a read SUCCEEDS; a failed read (network error, 5xx,
 *     `readable: false`) renders nothing — Jev's own fail-closed behaviour
 *     lives at the gateway (`vendor-tone-scoring.service.ts` refuses a house
 *     whose acceptance cannot be proven), not here. This component's only
 *     job is showing the sheet when it can PROVE acceptance is needed, never
 *     inferring a need from an absence (ADR 0020).
 *   - Two of these stack. It renders at most one sheet; SheetStack/Panel's
 *     own single-topmost-overlay contract (ADR 0112) covers the rest.
 */

import { useAuth } from '../../contexts/AuthContext';
import { useDataTerms } from '../../hooks/queries/useDataTerms';
import { DataTermsAcceptSheet } from './DataTermsAcceptSheet';

export function DataTermsSignInGate() {
  // No session context (a signed-out render, or a test that mounts the
  // layout alone) is not an owner: nothing is read and nothing shows.
  const auth = useAuth() as { activeRole?: string | null } | null;
  const activeRole = auth?.activeRole ?? null;
  const isOwner = activeRole === 'owner';
  const q = useDataTerms(isOwner);

  if (!isOwner) return null;
  // Loading, or a failed fetch that has not yet resolved to data: render
  // nothing rather than a spinner that would itself be a kind of block.
  if (!q.data) return null;
  // The store could not be read. Never treated as "not accepted" — that
  // would turn a read failure into a gate the app cannot get past, which is
  // exactly the lockout the founder's answer rules out.
  if (!q.data.readable) return null;
  // EVERY owner accepts for themselves (question 19): a co-owner's
  // acceptance makes the HOUSE current, not this owner. A gateway older than
  // the per-owner field only knows the house, and is read as that.
  const acceptedByYou = q.data.yours ? q.data.yours.current : q.data.current;
  if (acceptedByYou) return null;

  return <DataTermsAcceptSheet readout={q.data} dismissable={false} />;
}

export default DataTermsSignInGate;
