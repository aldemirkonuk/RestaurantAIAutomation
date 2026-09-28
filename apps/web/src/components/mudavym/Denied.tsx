/**
 * Permission-denied, as a surface — the largest single gap the census left.
 *
 * Measured (finder B, D24, from `census.json`): four of sixty live overlay rows
 * draw a failure state and **none** draws permission-denied. Under ADR 0112's
 * authority rule every sealed act is one a staff member cannot do, so on the
 * day the rule ships, a hundred and twenty surfaces have a state they have
 * never drawn. A control that is simply missing is the worst possible answer:
 * the reader concludes the software is broken, or that the act does not exist.
 *
 * THE WORDING IS THE AUTHORITY RULE (ADR 0112 · F11–F12)
 * -----------------------------------------------------
 * F12's second amendment, the founder's own: *"one man approval if the
 * authority is valid — owner/manager or authorized personnel (owner can give
 * access), otherwise double approval is needed."* So the sentence names three
 * things and no more: that looking is allowed, who may change it, and the one
 * person to ask. It never hides the control and never says "contact your
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
  /** The person who can grant it — a name, never a role alone. */
  who: string;
  /**
   * What they would be granting, in the house's own words: "release payments",
   * "write off stock". Omit it and the grant line is not drawn — a promise
   * about an authority nobody named is not a promise.
   */
  grant?: string;
  /** The act, for the first sentence. Default "change it". */
  verb?: ReactNode;
  className?: string;
}

export function Denied({ who, grant, verb = 'change it', className }: DeniedProps) {
  return (
    <div className={`mdv-denied${className ? ` ${className}` : ''}`} role="note">
      <span className="mdv-denied__head">You may look, not {verb}</span>
      <p className="mdv-denied__body">
        You can see this, but only an owner or a manager may {verb}. Ask {who} to grant it.
      </p>
      {grant ? (
        <p className="mdv-denied__grant">
          An owner can authorise you to {grant}. Every owner is told when they do — a grant is a
          security change, and security changes are never quiet.
        </p>
      ) : null}
    </div>
  );
}

/**
 * What did NOT happen — the house's one wording for a refusal or a failure.
 *
 * Finder B, D25: three vocabularies for "why not" are already in the census
 * (row 19 requires a reason, row 103 denies with a bare button,
 * recommendations dismiss with a reason and notifications without one), and
 * D23 has two shapes for one idea. This is the shape, so pages stop inventing
 * it: the thing, the verb that did not happen, "It is unchanged", then the
 * server's own sentence, then the one thing to do.
 *
 * "It is unchanged" is the load-bearing clause. Everything else is context; the
 * reader's actual question after a failure is whether anything moved.
 */
export interface RefusedProps {
  /** The thing. "The order", "The count", "The letter". */
  thing: string;
  /** The verb that did not happen, past participle: "sent", "written". */
  verb: string;
  /** The server's own sentence, verbatim. Never paraphrased. */
  because?: ReactNode;
  /** The one thing to do about it. */
  next?: ReactNode;
  className?: string;
}

export function Refused({ thing, verb, because, next, className }: RefusedProps) {
  return (
    <div className={`mdv-alert${className ? ` ${className}` : ''}`} role="alert">
      <span className="mdv-alert__head">What did not happen</span>
      <p>
        {thing} was not {verb}. It is unchanged.
      </p>
      {because ? <p className="mdv-refused__because">{because}</p> : null}
      {next ? <p className="mdv-refused__next">{next}</p> : null}
    </div>
  );
}

export default Denied;
