/**
 * The signed-in ceremony shell for `/authorize/:integrationId` and
 * `/authorize/complete`.
 *
 * [Founder, batch 4, 2026-09-19, on ADR 0144's "Still open" bullet 3 --
 * "`/authorize` and `/authorize/complete` render on `PublicShell`, built for
 * signed-OUT pages, for a signed-IN ceremony; `/authorize/complete` also
 * ignores the house's design flag and the ADR 0133 public-door switch" --
 * "do what's needed, not short term": give both pages a proper signed-in
 * frame that honours the design flag and the public-door switch, instead of
 * `PublicShell`.]
 *
 * `PublicShell` says, in its own file header, that it is for the seven
 * signed-OUT routes and deliberately imports no `AuthContext`, no
 * `DashboardLayout`, no `useMudavymDesign` -- a signed-out page that pulled
 * those in would be the bug it exists to prevent. `/authorize/:integrationId`
 * is a signed-in member granting a provider access to THIS house, and
 * `/authorize/complete` can be reached with a SESSION THAT HAS ALREADY
 * EXPIRED (the OAuth round trip "can outlast a session", ADR 0144) -- so
 * neither page is honestly a `PublicShell` page, and neither can assume a
 * house is always known either. This component is the third shape: not
 * `PublicShell` (signed-out, never a house), not `DashboardLayout` (the full
 * app chrome, sidebar nav and all -- which App.tsx's own route comment keeps
 * OUT of this ceremony on purpose, "sidebar navigation and page tips would
 * only offer ways to wander off mid-grant"), but a light, signed-in-capable
 * frame scoped to exactly this decision point.
 *
 * WHICH DESIGN WINS, in order (`useAuthorizeDesignOn`, exported for its own
 * test):
 *   1. A house is known (`AuthContext.activeRestaurantId` is set): the
 *      PER-HOUSE flag decides (`useMudavymDesign('authorize_integration')`)
 *      -- the same flag `/authorize/:integrationId` is already gated on via
 *      `PageGate` in App.tsx.
 *   2. No house is known (a lapsed session on the return leg, or a render
 *      outside any `AuthProvider`): the per-house flag is structurally unable
 *      to be on (it returns `false` before any request with no restaurant
 *      id, by its own file header) -- so this falls back to the ADR 0133
 *      PUBLIC-DOOR SWITCH (`usePublicDesign`) instead of silently defaulting
 *      to legacy for a reason that has nothing to do with the founder's
 *      redesign call.
 *
 * [2026-09-25: `authorize_integration` is in `LIVE_PAGES` (ADR 0149 row 36's
 * bracket, founder Q2/Q4 of 2026-09-22), so branch 1 is now ON for every
 * house, with or without a flag row, and the "structurally unable to be on"
 * reason in branch 2 no longer holds — the hook would answer true. Branch 2
 * still asks the public-door switch when no house is known; that choice is
 * unchanged here, and a "flag-off house" below now exists only under the
 * browser's QA override.]
 *
 * Design OFF -> renders `PublicShell` UNCHANGED: a flag-off house (or an
 * unknown one with the public door also off) sees exactly today's page,
 * byte for byte. This is the whole reason `PublicShell` is still imported
 * here rather than replaced outright.
 *
 * Design ON -> ONE frame, both call sites, that STATES ITS IDENTITY when it
 * has one:
 *   - A house is known (`AuthContext.activeRestaurantId`): the masthead names
 *     WHO is granting (`AuthContext.user.name`) and FOR WHICH HOUSE (the
 *     matching `AuthContext.availableRestaurants` entry), read straight from
 *     context -- never invented, never a second network read. No navigation
 *     accompanies it: a name and a house, never a switcher or a link to
 *     anywhere but this shell's own single "leave" affordance (`homeHref`,
 *     unchanged), so the identity line does not reopen the "ways to wander
 *     off mid-grant" door App.tsx's own route comment keeps shut.
 *   - No house is known: there is nothing true to say about who or which
 *     house, so the masthead falls back to a plain Wordmark signature and no
 *     identity claim -- the shape this shell has always drawn for its
 *     design-ON, no-house case.
 * Both `/authorize/complete` and `/authorize/:integrationId`'s Next component
 * call this SAME function, with no mode flag between them: which branch
 * renders is a fact about whether a house is known, not about which route
 * called it.
 *
 * [CORRECTED 2026-09-21 -- what stood here before was wrong, and it was a
 * regression, not a style choice. The prior build (2026-09-19) gave the two
 * call sites two different `chrome` props: `chrome="own"` drew this shell's
 * Wordmark-only frame unconditionally (never stating who or which house, so
 * design-ON looked identical to design-OFF's `PublicShell`), and
 * `chrome="ambient"` drew NOTHING of this shell's own -- on the belief that
 * `PageGate` already wraps `/authorize/:integrationId`'s Next component in a
 * working `HouseHeader`. It does not: `authorize_integration` is listed in
 * `NO_CHROME` (`lib/mudavym/pageNames.ts`) precisely so this ceremony gets no
 * app-wide chrome, and `HouseHeader` returns `null` for any `NO_CHROME` page
 * (`components/mudavym/HouseHeader.tsx`). So with the design flag ON, that
 * page lost every trace of a frame it had ever had: no wordmark, no skip
 * link, no exit link (reproduced with a DOM probe against `PageGate`: 1
 * wordmark and 2 links before this build, 0 and 0 after). Fixed by deleting
 * the `chrome` prop and the mode split entirely -- there was never a real
 * ambient masthead to defer to, so there was nothing to preserve by keeping
 * two branches. Tests: `AuthorizeShell.test.tsx`'s former
 * `chrome="ambient"` describe block is replaced by one covering the identity
 * frame; `consent-flow.test.tsx` adds a `PageGate`-mounted regression test
 * for the exact defect above.]
 *
 * Visual polish beyond reusing `PublicShell`'s own tokens and structural
 * classes (`.mdv-pub__*`, from `public-shell.css`) was deliberately NOT
 * invented by the 2026-09-21 correction above: there was no founder-reviewed
 * sketch for a signed-in treatment of this ceremony, and that fix's ask was
 * the architecture (the shell choice, driven by the flag and the switch),
 * not new unreviewed chrome -- the same "delegate the shape, keep the
 * mechanism honest" split ADR 0144 §2 drew for `/help`.
 *
 * [STYLED 2026-09-21, same round, later in the session -- the founder was
 * then asked directly, since a bare unstyled line is itself a visual
 * choice and CLAUDE.md §0.1 forbids treating one as a non-decision. His
 * words: "style it I trust you, do not show me. Just say done, keep it
 * simple, use anthropic's or other tech co's approach". Recorded direction
 * (a paraphrase, not his words): a clean consent screen in the house tokens
 * like Anthropic's/Google's/GitHub's OAuth consent (app name, what it can
 * do, who is granting for which house, one primary act, a quiet cancel), no
 * new sketch. His sentence is recorded verbatim in ADR 0144's review trail.
 * This is scoped to the identity line only -- the app
 * name (`title`), what it can do (the scopes section,
 * `next/AuthorizeIntegrationNext.tsx`) and the primary act / quiet cancel
 * (`HoldToApprove` and the Cancel `.mdv-btn`) already exist and are
 * untouched here.
 *
 * Built as `authorize-shell.css`, imported below, holding the SAME
 * discipline `public-shell.css`'s own header states: tokens only, no hex
 * literal, no `prefers-color-scheme`/`[data-theme]` block, no
 * `box-shadow` colour. The line reads the way an OAuth consent chip reads
 * -- on its own line under the wordmark, a one-letter mark on the seal
 * colour (`--seal`; decorative, `aria-hidden`, never a substitute for the
 * name), the person's name in `--ink-1`, the house beside it in `--ink-2`,
 * on a `--paper-1` pill against the page's `--paper-0` ground, the same
 * hairline-and-ground-change separation `.mdv-pub__plate` uses at page scale
 * rather than a shadow. Markup and class names (`mdv-auth-shell__identity`,
 * `mdv-auth-shell__person`, `mdv-auth-shell__house`) are unchanged from the
 * 2026-09-21 correction above -- this adds a wrapper span and the avatar
 * mark, and a stylesheet; no existing test's class or text assertion needed
 * to change, and one new case in `AuthorizeShell.test.tsx` covers the mark.
 */

import { useContext, useId, type ReactNode } from 'react';
import { AuthContext } from '../../contexts/AuthContext';
import { useMudavymDesign } from '../../lib/mudavym/useMudavymDesign';
import { usePublicDesign } from '../../lib/mudavym/publicDesign';
import { PublicShell, type PublicShellProps } from '../../components/mudavym/PublicShell';
import { Wordmark } from '../../components/mudavym/Wordmark';
import './authorize-shell.css';

/**
 * `true` when this ceremony should wear the Mudavym redesign. Exported so its
 * two-branch fallback (per-house flag, else the public-door switch) is
 * covered by its own unit tests, not only observed through the shell.
 */
export function useAuthorizeDesignOn(): boolean {
  const activeRestaurantId = useContext(AuthContext)?.activeRestaurantId ?? null;
  // Both hooks are always called -- Rules of Hooks -- even when the result of
  // one is not the one that decides.
  const houseDesignOn = useMudavymDesign('authorize_integration');
  const publicDoorOn = usePublicDesign();
  return activeRestaurantId ? houseDesignOn : publicDoorOn;
}

export interface AuthorizeShellProps extends Omit<PublicShellProps, 'ground' | 'seal'> {
  children: ReactNode;
}

export function AuthorizeShell({ title, eyebrow, voice, footer, measure, homeHref, className, mainClassName, children }: AuthorizeShellProps) {
  const mainId = `mdv-auth-main-${useId().replace(/:/g, '')}`;
  const auth = useContext(AuthContext);
  const designOn = useAuthorizeDesignOn();

  // The heading block every ON rendering shares. `identity` is `null` when no
  // house is known (nothing true to say) and the who/which-house line
  // otherwise.
  function heading(signature: ReactNode, identity: ReactNode) {
    return (
      <header className="mdv-pub__mast">
        {signature}
        {identity}
        {eyebrow ? <span className="mdv-pub__eyebrow">{eyebrow}</span> : null}
        <h1 className="mdv-pub__title">{title}</h1>
        {voice ? <p className="mdv-pub__voice">{voice}</p> : null}
      </header>
    );
  }
  const main = (
    <main id={mainId} tabIndex={-1} className={`mdv-pub__main${mainClassName ? ` ${mainClassName}` : ''}`}>
      {children}
    </main>
  );
  const foot = footer ? <footer className="mdv-pub__foot">{footer}</footer> : null;

  if (!designOn) {
    return (
      <PublicShell title={title} eyebrow={eyebrow} voice={voice} footer={footer} measure={measure} homeHref={homeHref}
        className={className} mainClassName={mainClassName} seal={false}>
        {children}
      </PublicShell>
    );
  }

  const activeRestaurantId = auth?.activeRestaurantId ?? null;
  const houseKnown = Boolean(activeRestaurantId);
  // Same lookup HouseHeader's own `HouseOfRecord` makes, so a person mid-list
  // load or an id with no matching name behaves the same way here as it does
  // there: fall back to the first known branch, else say nothing rather than
  // invent a house name (ADR 0020).
  const house = houseKnown
    ? auth?.availableRestaurants?.find((b) => b.id === activeRestaurantId) ?? auth?.availableRestaurants?.[0] ?? null
    : null;
  const person = houseKnown ? auth?.user?.name || null : null;

  const mark = (
    <span className="mdv-pub__sign">
      <Wordmark size={measure === 'document' ? 15 : 19} />
    </span>
  );
  const signature = homeHref ? (
    <a className="mdv-pub__signlink" href={homeHref}>
      {mark}
    </a>
  ) : (
    mark
  );

  // Who is granting, and for which house -- no navigation, only a fact.
  // The mark is the person's own initial, decorative and aria-hidden: the
  // name text beside it is the actual information, never the mark alone.
  // `Array.from`, not `charAt(0)`: a name opening on an astral character (a
  // surrogate pair) must give the whole character, never half of one.
  const initial = person ? (Array.from(person.trim())[0] ?? '').toUpperCase() || null : null;
  const identity = person || house ? (
    <p className="mdv-auth-shell__identity">
      {initial ? (
        <span className="mdv-auth-shell__avatar" aria-hidden="true">{initial}</span>
      ) : null}
      <span className="mdv-auth-shell__identity-text">
        {person ? <span className="mdv-auth-shell__person">{person}</span> : null}
        {person && house ? (
          <span className="mdv-auth-shell__identity-sep" aria-hidden="true"> · </span>
        ) : null}
        {house ? <span className="mdv-auth-shell__house">{house.name}</span> : null}
      </span>
    </p>
  ) : null;

  const signatureTakesFocus = Boolean(homeHref);

  return (
    <div
      className={`mudavym mdv-pub mdv-auth-shell${houseKnown ? ' mdv-auth-shell--identity' : ''}${className ? ` ${className}` : ''}`}
      data-measure={measure ?? 'door'}
    >
      {signatureTakesFocus ? (
        <a className="mdv-pub__skip" href={`#${mainId}`}>
          Skip to the content
        </a>
      ) : null}
      <div className="mdv-pub__col">
        {heading(signature, identity)}
        {main}
        {foot}
      </div>
    </div>
  );
}

export default AuthorizeShell;
