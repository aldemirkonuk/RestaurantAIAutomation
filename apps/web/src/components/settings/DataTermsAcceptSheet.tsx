/**
 * The house's data-and-privacy terms, and the owner's hold-to-accept
 * (ADR 0207, question 13's build in round 4; the SHEET itself, and the
 * every-owner-at-sign-in gate around it, is round 5 — question 19).
 *
 * THE FOUNDER, 2026-09-22, round 6y (question 13, verbatim): "owner only,
 * but also we're going to use this as complete data and privacy usage, they
 * have to accept that, and when they do they'd accept the jev too with their
 * names and sensitive topics redacted."
 *
 * THE FOUNDER, 2026-09-22, round 6z (question 19, his pick, over the
 * recommended "only to turn Jev on"): "Every owner, next sign-in." He was
 * told this puts the terms in front of every owner, and that — because
 * accepting includes Jev — it turns Jev on for every house whose owner
 * accepts. He picked it anyway.
 *
 * THIS FILE renders exactly the terms the gateway already states
 * (`GET /settings/data-terms` → `apps/api-gateway/.../house-data-terms.ts`)
 * — a `fact` statement per data flow, cited to a code path, and a `term`
 * statement (who is responsible) that carries no evidence and is on the
 * ADR's lawyer list. NOTHING HERE INVENTS LEGAL TEXT: every sentence a
 * reader sees is either the gateway's own words or this component's plain
 * scaffolding around them ("Facts", "What we do not promise", a link to
 * `/privacy`). There is no dedicated `/terms` page in this codebase yet
 * (only `/privacy`); this sheet does not create one, and does not draft
 * legal language to fill the gap — see ADR 0207's *Round 5* section for what
 * that means for the lawyer's review. [PR 478, 2026-09-27: a `/terms` page
 * now exists (`pages/Terms.tsx`), as an unreviewed placeholder Terms of
 * Service. It is a separate document: this sheet neither renders nor links
 * it, and nobody is asked to accept it. `Terms.tsx`'s "Changes" section names
 * these data terms as the separate, recorded acceptance.]
 *
 * SHAPE: `Panel` (ADR 0112) — centered, because this is a question the
 * reader must answer, not a record or a menu. Motion is whatever `Panel`
 * and `HoldToApprove` already use (ADR 0134's locked tokens, on the
 * `feat/motion-rules-locked` branch as of this build — not yet merged to
 * this worktree's `main`); nothing here hand-rolls an animation.
 *
 * TWO CALLERS, ONE COMPONENT:
 *   `DataTermsSignInGate` — `dismissable={false}`. Every owner meets this at
 *     their next sign-in (every authenticated page load, until accepted).
 *     No close control, and Esc/an outside click do nothing (`onClose` is a
 *     no-op) — "must accept to continue" in the founder's own words. This is
 *     an overlay's own inability to be dismissed, never an app-wide lockout:
 *     the page underneath is still there, still rendered, still navigable by
 *     URL: what changes is that this sheet keeps reappearing until an owner
 *     accepts. See that file's header for what "fail closed for Jev, never
 *     lock the owner out" means for an UNREADABLE store (this component is
 *     never even mounted in that case).
 *   `MailReadingSection`'s "Turn on" — `dismissable={true}`. An owner opened
 *     this on purpose to turn Jev on; "Put it down" leaves the switch off,
 *     exactly as a 409 from the gateway already would have.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Users, ChevronDown } from 'lucide-react';
import { Panel, HoldToApprove } from '../mudavym';
import { Collapse } from '../mudavym/Collapse';
import './data-terms-sheet.css';
import {
  acceptDataTerms,
  issueDataTermsSealChallenge,
  type DataTermsAcceptanceReceipt,
  type DataTermsReadout,
} from '../../services/api/dataTerms';
import { useInvalidateDataTerms } from '../../hooks/queries/useDataTerms';

/** The hold is 1.2 s: long enough to be a decision, short enough to finish. */
const HOLD_MS = 1200;

const SANS = "'DM Sans', system-ui, sans-serif";

function spokenMessage(error: unknown): string {
  const m = (error as { message?: string })?.message;
  return typeof m === 'string' && m.trim() ? m : 'request failed';
}

export interface DataTermsAcceptSheetProps {
  readout: DataTermsReadout;
  dismissable: boolean;
  onClose?: () => void;
  /** Fired once the gateway confirms the acceptance, with its receipt. */
  onAccepted?: (receipt: DataTermsAcceptanceReceipt) => void;
}

/**
 * What accepting does to Jev, in this house, right now. The house's FIRST
 * acceptance turns Jev on; after that an owner's own acceptance (question 19:
 * every owner accepts for themselves) leaves the switch as it was — so the
 * sheet must not promise to turn on what another owner may have turned off.
 */
export function jevConsequence(readout: DataTermsReadout): { short: string; long: string } {
  if (readout.acceptance === null) {
    return {
      short: 'accepting turns Jev on for this house.',
      long:
        'Accepting turns on Jev (TypeSafe), which reads this house’s vendor mail with names and sensitive topics removed.',
    };
  }
  if (readout.jev.enabled) {
    return readout.current
      ? {
          short: 'Jev already reads this house’s vendor mail; accepting records your own agreement.',
          long:
            'Jev (TypeSafe) already reads this house’s vendor mail, with names and sensitive topics removed. Accepting records your own agreement to these terms.',
        }
      : {
          short: 'accepting lets Jev read this house’s vendor mail again.',
          long:
            'Jev (TypeSafe) is switched on for this house but paused until these terms are accepted. Accepting lets it read the house’s vendor mail again, with names and sensitive topics removed.',
        };
  }
  return {
    short: 'Jev is switched off for this house; accepting does not turn it on.',
    long:
      'Jev (TypeSafe) is switched off for this house, and accepting does not turn it on — an owner can, under Settings → Mail reading.',
  };
}

export function DataTermsAcceptSheet({
  readout,
  dismissable,
  onClose,
  onAccepted,
}: DataTermsAcceptSheetProps) {
  const invalidate = useInvalidateDataTerms();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [folded, setFolded] = useState(false);

  const facts = readout.statements.filter((s) => s.kind === 'fact');
  const terms = readout.statements.filter((s) => s.kind === 'term');
  const changed = readout.changedSince[String(readout.version)] ?? [];
  const reaccepting = readout.acceptance !== null && !readout.current;
  const jev = jevConsequence(readout);
  const receivers = readout.subprocessors.map((sp) => sp.name);

  const onChallenge = async (): Promise<string | null> => {
    setRefusal(null);
    try {
      const token = await issueDataTermsSealChallenge();
      if (!token) {
        setRefusal('The seal could not be issued, so nothing was accepted. Begin the hold again.');
        return null;
      }
      return token;
    } catch (err) {
      setRefusal(spokenMessage(err));
      return null;
    }
  };

  const onApprove = async (challenge?: string | null) => {
    try {
      const receipt = await acceptDataTerms(readout.version, readout.digest, challenge ?? null);
      await invalidate();
      onAccepted?.(receipt);
    } catch (err) {
      setRefusal(spokenMessage(err));
      setAttempt((a) => a + 1);
      throw err;
    }
  };

  // Non-dismissable: Esc and an outside click call this and nothing else —
  // the Panel primitive then simply stays open (it is driven by `open`,
  // which this sheet's callers never set false on their own).
  const handleClose = dismissable ? (onClose ?? (() => {})) : () => {};

  return (
    <Panel
      open
      onClose={handleClose}
      showClose={dismissable}
      // Non-dismissable, the Panel primitive (main, 2026-09) names its scrim
      // with this label as the way out. There is no way out here, so the
      // scrim says so instead of offering "Put it down" and doing nothing.
      closeLabel={dismissable ? 'Put it down' : 'These terms stay open until you accept them'}
      scrim
      className="dt-sheet"
      label={
        reaccepting
          ? `This house's data and privacy terms changed. Reading them asks nothing of you yet; ${jev.short}`
          : `This house's data and privacy terms, including Jev (TypeSafe). Reading them asks nothing of you yet; ${jev.short}`
      }
      eyebrow="Data & privacy terms"
      title={reaccepting ? 'The terms changed — read them again' : 'This house’s data & privacy terms'}
      contract={
        <span>
          {jev.long} It changes nothing else — every other flow below already happens whether or
          not you accept.
        </span>
      }
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <HoldToApprove
              key={`data-terms-accept-${attempt}`}
              label="Hold to accept"
              approvedLabel="Accepted"
              ring
              holdMs={HOLD_MS}
              className="dt-hold"
              onApprove={onApprove}
              onChallenge={onChallenge}
            />
            <span style={{ fontFamily: SANS, fontSize: 12, color: 'var(--ink-4, #665D50)' }}>
              version {readout.version}
            </span>
          </div>
          {refusal && (
            <p role="alert" style={{ margin: 0, fontFamily: SANS, fontSize: 13, color: 'var(--alarm, #A33A2B)' }}>
              {refusal}
            </p>
          )}
        </div>
      }
    >
      <div className="dt-body">
        {readout.acceptance && (
          <p className="dt-meta">
            {reaccepting
              ? `Last accepted version ${readout.acceptance.version} by ${readout.acceptance.acceptedBy.name ?? 'a former owner'} on ${readout.acceptance.acceptedAt.slice(0, 10)}.`
              : `Accepted (version ${readout.acceptance.version}) by ${readout.acceptance.acceptedBy.name ?? 'a former owner'} on ${readout.acceptance.acceptedAt.slice(0, 10)}.`}
          </p>
        )}

        {changed.length > 0 && (
          <div>
            <p className="dt-head">What changed since version {readout.acceptance?.version ?? '—'}</p>
            <ul className="dt-list">
              {changed.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Three lines, in the house's plain words. Scaffolding only: every
            sentence of the terms themselves is under "Read it all". */}
        <ul className="dt-points">
          <li>
            <Eye aria-hidden className="dt-points__icon" />
            <span>
              <strong>Read</strong>
              {facts.length} ways this house’s data moves, each one written out under “Read it all”.
            </span>
          </li>
          <li>
            <EyeOff aria-hidden className="dt-points__icon" />
            <span>
              <strong>Never read</strong>
              Names and sensitive topics are removed before Jev reads vendor mail.
            </span>
          </li>
          <li>
            <Users aria-hidden className="dt-points__icon" />
            <span>
              <strong>Who sees it</strong>
              {receivers.length > 0
                ? `${receivers.join(', ')}, and the services named under “Read it all”.`
                : 'The services named under “Read it all”.'}
            </span>
          </li>
        </ul>

        <button
          type="button"
          className="dt-fold"
          aria-expanded={folded}
          aria-controls="dt-fold-body"
          onClick={() => setFolded((v) => !v)}
        >
          <span>{folded ? 'Hide the full terms' : 'Read it all'}</span>
          <ChevronDown aria-hidden className="dt-fold__chev" />
        </button>

        <Collapse open={folded} className="dt-collapse">
          <div id="dt-fold-body" className="dt-full">
            <div>
              <p className="dt-head">Where this house’s data goes</p>
              <ul className="dt-list dt-list--plain">
                {facts.map((s) => (
                  <li key={s.key}>{s.text}</li>
                ))}
              </ul>
            </div>

            {readout.subprocessors.length > 0 && (
              <div>
                <p className="dt-head">Who receives it</p>
                <ul className="dt-list dt-list--plain dt-list--tight">
                  {readout.subprocessors.map((sp) => (
                    <li key={sp.host}>
                      <strong>{sp.name}</strong> — {sp.what}
                      {sp.masked ? ' (masked first)' : ''} · {sp.when}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {terms.length > 0 && (
              <div>
                <p className="dt-head">What Mudavym does and does not promise</p>
                <ul className="dt-list dt-list--plain">
                  {terms.map((s) => (
                    <li key={s.key}>{s.text}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Collapse>

        <p className="dt-meta">
          The full picture of what Mudavym collects is on the{' '}
          <Link to="/privacy">privacy page</Link>.
        </p>
      </div>
    </Panel>
  );
}

export default DataTermsAcceptSheet;
