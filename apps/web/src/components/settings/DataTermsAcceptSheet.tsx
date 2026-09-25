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
 * that means for the lawyer's review.
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
import { Panel, HoldToApprove } from '../mudavym';
import {
  acceptDataTerms,
  issueDataTermsSealChallenge,
  type DataTermsReadout,
} from '../../services/api/dataTerms';
import { useInvalidateDataTerms } from '../../hooks/queries/useDataTerms';

const SANS = "'DM Sans', system-ui, sans-serif";
const SERIF = "'Fraunces', Georgia, serif";
const MONO = "'JetBrains Mono', monospace";

function spokenMessage(error: unknown): string {
  const m = (error as { message?: string })?.message;
  return typeof m === 'string' && m.trim() ? m : 'request failed';
}

export interface DataTermsAcceptSheetProps {
  readout: DataTermsReadout;
  dismissable: boolean;
  onClose?: () => void;
  /** Fired once the gateway confirms the acceptance. */
  onAccepted?: () => void;
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

  const facts = readout.statements.filter((s) => s.kind === 'fact');
  const terms = readout.statements.filter((s) => s.kind === 'term');
  const changed = readout.changedSince[String(readout.version)] ?? [];
  const reaccepting = readout.acceptance !== null && !readout.current;

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
      await acceptDataTerms(readout.version, readout.digest, challenge ?? null);
      await invalidate();
      onAccepted?.();
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
      closeLabel="Put it down"
      scrim
      label={
        reaccepting
          ? "This house's data and privacy terms changed. Reading them asks nothing of you yet; accepting turns Jev back on for this house."
          : "This house's data and privacy terms, including Jev (TypeSafe). Reading them asks nothing of you yet; accepting turns Jev on for this house."
      }
      eyebrow="Data & privacy terms"
      title={reaccepting ? 'The terms changed — read them again' : 'This house’s data & privacy terms'}
      contract={
        <span>
          Accepting turns on Jev (TypeSafe), which reads this house’s vendor mail with names and
          sensitive topics removed. It changes nothing else — every other flow below already
          happens whether or not you accept.
        </span>
      }
      footer={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <HoldToApprove
              key={`data-terms-accept-${attempt}`}
              label="Hold to accept"
              approvedLabel="Accepted"
              onApprove={onApprove}
              onChallenge={onChallenge}
            />
            <span style={{ fontFamily: SANS, fontSize: 11, color: 'var(--ink-3, #7C7365)' }}>
              version {readout.version}
            </span>
          </div>
          {refusal && (
            <p role="alert" style={{ margin: 0, fontFamily: SANS, fontSize: 11.5, color: 'var(--alarm, #A33A2B)' }}>
              {refusal}
            </p>
          )}
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: SANS, fontSize: 12.5, lineHeight: 1.55 }}>
        {readout.acceptance && (
          <p style={{ margin: 0, fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em', color: 'var(--ink-3, #7C7365)' }}>
            {reaccepting
              ? `Last accepted version ${readout.acceptance.version} by ${readout.acceptance.acceptedBy.name ?? 'a former owner'} on ${readout.acceptance.acceptedAt.slice(0, 10)}.`
              : `Accepted (version ${readout.acceptance.version}) by ${readout.acceptance.acceptedBy.name ?? 'a former owner'} on ${readout.acceptance.acceptedAt.slice(0, 10)}.`}
          </p>
        )}

        {changed.length > 0 && (
          <div>
            <p style={{ margin: '0 0 4px', fontFamily: SERIF, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
              What changed since version {readout.acceptance?.version ?? '—'}
            </p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {changed.map((line) => (
                <li key={line} style={{ color: 'var(--ink-2, #4F473C)' }}>{line}</li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p style={{ margin: '0 0 6px', fontFamily: SERIF, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
            Where this house’s data goes
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {facts.map((s) => (
              <li key={s.key} style={{ color: 'var(--ink-2, #4F473C)' }}>{s.text}</li>
            ))}
          </ul>
        </div>

        {readout.subprocessors.length > 0 && (
          <div>
            <p style={{ margin: '0 0 6px', fontFamily: SERIF, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
              Who receives it
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {readout.subprocessors.map((sp) => (
                <li key={sp.host} style={{ fontSize: 12, color: 'var(--ink-2, #4F473C)' }}>
                  <strong style={{ color: 'var(--ink-1, #211C16)' }}>{sp.name}</strong> — {sp.what}
                  {sp.masked ? ' (masked first)' : ''} · {sp.when}
                </li>
              ))}
            </ul>
          </div>
        )}

        {terms.length > 0 && (
          <div>
            <p style={{ margin: '0 0 6px', fontFamily: SERIF, fontSize: 13.5, fontWeight: 600, color: 'var(--ink-1, #211C16)' }}>
              What Mudavym does and does not promise
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {terms.map((s) => (
                <li key={s.key} style={{ color: 'var(--ink-2, #4F473C)' }}>{s.text}</li>
              ))}
            </ul>
          </div>
        )}

        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-3, #7C7365)' }}>
          The full picture of what Mudavym collects is on the{' '}
          <Link to="/privacy" style={{ color: 'var(--seal-deep, #14515C)' }}>
            privacy page
          </Link>
          .
        </p>
      </div>
    </Panel>
  );
}

export default DataTermsAcceptSheet;
