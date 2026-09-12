/**
 * The small pieces the parity build shares. Presentational only — nothing here
 * fetches, so nothing here can be wrong about what was measured.
 *
 * The Fraunces loader is copied rather than imported across pages (the p4 rule:
 * a `next` directory stands alone), and shares the dashboard's link id so at
 * most one stylesheet link is ever added.
 */

import type { ReactNode } from 'react';
import { EM, initialsOf, type ResolvedName } from './tm-format';

const FRAUNCES_LINK_ID = 'mudavym-fraunces';

export function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

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
