/**
 * The small pieces the parity build shares. Presentational only — nothing here
 * fetches, so nothing here can be wrong about what was measured.
 *
 * Fraunces is self-hosted; `@font-face` lives in `styles/mudavym.css`
 * (decision 0149 row 9).
 */

import type { ReactNode } from 'react';
import { EM, initialsOf, type ResolvedName } from './tm-format';

/** Initials, or an em dash when there is no name to shorten. */
export function Mark({
  name,
  avatarUrl,
  owner,
}: {
  name: ResolvedName;
  avatarUrl?: string | null;
  owner?: boolean;
}) {
  return (
    <span className="tm-mark" data-owner={owner ? 'true' : undefined} aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" /> : initialsOf(name)}
    </span>
  );
}

export function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div>
      <span className="tm-fact__k">{k}</span>
      <span className="tm-fact__v">{v}</span>
    </div>
  );
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tm-card">
      <h4 className="tm-card__h">{title}</h4>
      {children}
    </section>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="tm-kv">
      <span>{k}</span>
      <b>{v ?? EM}</b>
    </div>
  );
}

export function Tag({ children, mark }: { children: ReactNode; mark?: boolean }) {
  return (
    <span className="tm-tag" data-mark={mark ? 'true' : undefined}>
      {children}
    </span>
  );
}

/**
 * A failure or a refusal, said in words. `role="alert"` because it is a settled
 * message about something that just happened, not a live region that chatters.
 */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <p className="tm-alert" role="alert">
      {children}
    </p>
  );
}

/** A mutation's failure, in the verb's own words. Never a silent no-op. */
export function MutationError({ when, children }: { when: boolean; children: ReactNode }) {
  if (!when) return null;
  return <Alert>{children}</Alert>;
}
