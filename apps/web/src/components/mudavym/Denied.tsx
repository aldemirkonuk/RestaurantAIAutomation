/**
 * Permission-denied, as a surface — the largest single gap the census left.
 *
 * Measured (finder B, D24, from `census.json`): four of sixty live overlay rows
 * draw a failure state and **none** draws permission-denied. Under ADR 0112's
 * authority rule every sealed act is one some reader cannot do alone, so on the
 * day the rule ships, a hundred and twenty surfaces have a state they have
 * never drawn. A control that is simply missing is the worst possible answer:
 * the reader concludes the software is broken, or that the act does not exist.
 *
 * THE WORDING IS THE AUTHORITY RULE (ADR 0112 · F11–F12)
 * -----------------------------------------------------
 * F12's second amendment, the founder's own: *"one man approval if the
 * authority is valid — owner/manager or authorized personnel (owner can give
 * access), otherwise double approval is needed."* Three things follow, and the
 * sentence says each of them:
 *
 *   1. who holds authority — an owner, a manager, **or a person an owner has
 *      authorised**. The first cut of this file (2026-09-06) said "only an owner
 *      or a manager", which is false the moment an owner grants anyone;
 *   2. who can GRANT it — only an owner ("owner can give access"). The person
 *      named is therefore typed `owner`: the first cut took any `who`, so a page
 *      could send the reader to a manager who cannot say yes;
 *   3. that without authority an act may still go ahead with a second approver
 *      — but only where the surface actually offers that route, so it is the
 *      caller's `otherwise` and never a sentence this component asserts on its
 *      own. Whether every Denied surface must offer it is the founder's call
 *      (open question, A-fix 2026-09-17).
 *
 * It never hides the control's reason and never says "contact your
 * administrator", which names nobody.
 *
 * F12's third amendment — *"a security change is always told to every owner:
 * … an authority grant or revocation …"* — is why the grant line says the
 * telling out loud. Someone asking for authority should know, before they ask,
 * that the grant is not private.
 */

import { ReactNode } from 'react';
import './sheet.css';

export interface DeniedProps {
  /**
   * The owner to ask — a name, never a role alone. Only an owner can grant
   * authority (F12 amendment 2), so this is never a manager's name.
   */
  owner: string;
  /**
   * What they would be granting, in the house's own words: "release payments",
   * "write off stock". Omit it and the grant line is not drawn — a promise
   * about an authority nobody named is not a promise.
   */
  grant?: string;
  /** The act, for the first sentence. Default "change it". */
  verb?: ReactNode;
  /**
   * The route this surface offers a reader without authority, when it offers
   * one — under the authority rule, a second approver (F12 amendment 2). Drawn
   * after the sentence, in the caller's words and controls. Omit it where the
   * surface has no such route: this component never promises one.
   */
  otherwise?: ReactNode;
  className?: string;
}

export function Denied({ owner, grant, verb = 'change it', otherwise, className }: DeniedProps) {
  return (
    <div className={`mdv-denied${className ? ` ${className}` : ''}`} role="note">
      <span className="mdv-denied__head">You may look, not {verb}</span>
      <p className="mdv-denied__body">
        You can see this. An owner, a manager, or someone an owner has authorised may {verb}. Ask{' '}
        {owner} to grant it.
      </p>
      {grant ? (
        <p className="mdv-denied__grant">
          An owner can authorise you to {grant}. Every owner is told when they do — a grant is a
          security change, and security changes are never quiet.
        </p>
      ) : null}
      {otherwise ? <div className="mdv-denied__otherwise">{otherwise}</div> : null}
    </div>
  );
}

/**
 * What did NOT happen — the house's one wording for a refusal, and the one
 * wording for an outcome nobody can confirm.
 *
 * Finder B, D25: three vocabularies for "why not" are already in the census
 * (row 19 requires a reason, row 103 denies with a bare button,
 * recommendations dismiss with a reason and notifications without one), and
 * D23 has two shapes for one idea. This is the shape, so pages stop inventing
 * it: the thing, the verb, what is known about the outcome, then the server's
 * own sentence, then the one thing to do.
 *
 * THE OUTCOME IS REQUIRED
 * -----------------------
 * The first cut (2026-09-06) said "It is unchanged" after ANY failure. After a
 * timeout, a dropped connection or a 5xx nobody knows that — the write may
 * have landed — and saying it is the fabricated answer ADR 0020 forbids; it
 * also contradicted `HoldToApprove`'s own "could not be confirmed". So the
 * caller must say which it has:
 *
 *   · `refused` — the server answered and refused. "{thing} was not {verb}. It
 *     is unchanged." Only here is "unchanged" a fact.
 *   · `unknown` — no answer that settles it. "{thing} could not be confirmed as
 *     {verb}. Check the record before trying again." Never "nothing was sent".
 *
 * There is no default, because either default would be a lie on some call.
 */
export type RefusedOutcome = 'refused' | 'unknown';

export interface RefusedProps {
  /** The thing. "The order", "The count", "The letter". */
  thing: string;
  /** The verb, past participle: "sent", "written". */
  verb: string;
  /** What is known about the outcome — see the note above. */
  outcome: RefusedOutcome;
  /** The server's own sentence, verbatim. Never paraphrased. */
  because?: ReactNode;
  /** The one thing to do about it. */
  next?: ReactNode;
  className?: string;
}

export function Refused({ thing, verb, outcome, because, next, className }: RefusedProps) {
  return (
    <div
      className={`mdv-alert${className ? ` ${className}` : ''}`}
      role="alert"
      data-outcome={outcome}
    >
      <span className="mdv-alert__head">
        {outcome === 'refused' ? 'What did not happen' : 'Not confirmed'}
      </span>
      {outcome === 'refused' ? (
        <p>
          {thing} was not {verb}. It is unchanged.
        </p>
      ) : (
        <p>
          {thing} could not be confirmed as {verb}. Check the record before trying again.
        </p>
      )}
      {because ? <p className="mdv-refused__because">{because}</p> : null}
      {next ? <p className="mdv-refused__next">{next}</p> : null}
    </div>
  );
}

export default Denied;
