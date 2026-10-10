/**
 * The small pieces the parity build shares. Presentational only — nothing here
 * fetches, so nothing here can be wrong about what was measured.
 *
 * Fraunces is self-hosted; `@font-face` lives in `styles/mudavym.css`
 * (decision 0149 row 9).
 */

import { createContext, useContext, type ReactNode } from 'react';
import { EM, fmtTime, initialsOf, type ResolvedName } from './tm-format';

/**
 * The house's locale for shift times (F-1007): set once where the week is
 * read, so every chip, card and sheet below prints "17:00" in a Turkish house
 * without each one being handed it. Unset, the desk's "5p" stands.
 */
const ShiftClock = createContext<string | undefined>(undefined);

export function ShiftClockProvider({
  locale,
  children,
}: {
  locale: string | undefined;
  children: ReactNode;
}) {
  return <ShiftClock.Provider value={locale}>{children}</ShiftClock.Provider>;
}

/** `fmtTime` on the house's clock, for whatever is inside a ShiftClockProvider. */
export function useShiftTime(): (t: string) => string {
  const locale = useContext(ShiftClock);
  return (t) => fmtTime(t, locale);
}

/**
 * The house's country code ("TR"), read off the same locale (F-1020), so a
 * sheet can name a country's law only in a house that is in that country.
 * `undefined` when the country is not known.
 */
export function useHouseRegion(): string | undefined {
  const locale = useContext(ShiftClock);
  if (!locale) return undefined;
  try {
    return new Intl.Locale(locale).region;
  } catch {
    return undefined;
  }
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
