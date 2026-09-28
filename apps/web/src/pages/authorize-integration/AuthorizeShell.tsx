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
 * Design OFF -> renders `PublicShell` UNCHANGED: a flag-off house (or an
 * unknown one with the public door also off) sees exactly today's page,
 * byte for byte. This is the whole reason `PublicShell` is still imported
 * here rather than replaced outright.
 *
 * Design ON -> two chrome modes, because the two call sites are not in the
 * same position:
 *   - `chrome="own"` (the default) -- for `/authorize/complete`, which sits
 *     OUTSIDE `PageGate`/`ProtectedRoute` in App.tsx and so has no ambient
 *     masthead of any kind. Draws a light Wordmark-only signature (no Seal --
 *     neither call site has ever asked for one; both already pass
 *     `seal={false}` to today's `PublicShell`), the page's own eyebrow/title/
 *     voice, and a footer slot.
 *   - `chrome="ambient"` -- for `/authorize/:integrationId`'s Next component,
 *     which `PageGate` already wraps in a `HouseHeader` whenever its `next`
 *     branch renders (`PageGate.tsx`: "above `next`, on the branch that is
 *     already showing the redesign"). A second Wordmark signature under that
 *     would be a second, competing signed-in masthead on one screen, so this
 *     mode renders the page's own eyebrow/title/voice/content WITHOUT a
 *     second signature line. Because reaching this component at all means
 *     `PageGate` already chose the redesign, `chrome="ambient"` never falls
 *     back to `PublicShell` -- there is no "off" state reachable here.
 *
 * Visual polish beyond reusing `PublicShell`'s own tokens and structural
 * classes (`.mdv-pub__*`, from `public-shell.css`) is deliberately NOT
 * invented here: there is no founder-reviewed sketch for a signed-in
 * treatment of this ceremony, and the ask was the architecture (the shell
 * choice, driven by the flag and the switch), not new unreviewed chrome --
 * the same "delegate the shape, keep the mechanism honest" split ADR 0144
 * §2 drew for `/help`.
 */

import { useContext, useId, type ReactNode } from 'react';
import { AuthContext } from '../../contexts/AuthContext';
import { useMudavymDesign } from '../../lib/mudavym/useMudavymDesign';
import { usePublicDesign } from '../../lib/mudavym/publicDesign';
import { PublicShell, type PublicShellProps } from '../../components/mudavym/PublicShell';
import { Wordmark } from '../../components/mudavym/Wordmark';

/**
 * `true` when this ceremony should wear the Mudavym redesign. Exported so its
 * two-branch fallback (per-house flag, else the public-door switch) is
 * covered by its own unit tests, not only observed through the shell.
 */
export function useAuthorizeDesignOn(): boolean {
  const activeRestaurantId = useContext(AuthContext)?.activeRestaurantId ?? null;
  // Both hooks are always called -- Rules of Hooks -- even when the caller
  // (chrome="ambient") never reads this value.
  const houseDesignOn = useMudavymDesign('authorize_integration');
  const publicDoorOn = usePublicDesign();
  return activeRestaurantId ? houseDesignOn : publicDoorOn;
}

export interface AuthorizeShellProps extends Omit<PublicShellProps, 'ground' | 'seal'> {
  /**
   * 'own' (default): draw a light masthead of this shell's own. Used by
   * `/authorize/complete`, which has no ambient masthead.
   * 'ambient': content only, no signature line. Used by
   * `/authorize/:integrationId`'s Next component, which `PageGate` already
   * places under a `HouseHeader`.
   */
  chrome?: 'own' | 'ambient';
  children: ReactNode;
}

export function AuthorizeShell({ chrome = 'own', title, eyebrow, voice, footer, measure, homeHref, className, mainClassName, children }: AuthorizeShellProps) {
  const mainId = `mdv-auth-main-${useId().replace(/:/g, '')}`;
  // Always called, unconditionally, above every branch below (Rules of
  // Hooks) -- the 'ambient' path does not read the result, because reaching
  // it at all means PageGate already decided the design is on.
  const designOn = useAuthorizeDesignOn();
  // The heading block every ON rendering shares. `signature` is `null` in
  // ambient mode (PageGate's HouseHeader already signed the screen) and a
  // Wordmark-only mark (never a Seal -- see file header) otherwise.
  function heading(signature: ReactNode) {
    return (
      <header className="mdv-pub__mast">
        {signature}
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

  if (chrome === 'ambient') {
    return (
      <div className={`mudavym mdv-pub mdv-auth-shell mdv-auth-shell--ambient${className ? ` ${className}` : ''}`} data-measure={measure ?? 'door'}>
        <div className="mdv-pub__col">
          {heading(null)}
          {main}
          {foot}
        </div>
      </div>
    );
  }

  if (!designOn) {
    return (
      <PublicShell title={title} eyebrow={eyebrow} voice={voice} footer={footer} measure={measure} homeHref={homeHref}
        className={className} mainClassName={mainClassName} seal={false}>
        {children}
      </PublicShell>
    );
  }

  const signatureTakesFocus = Boolean(homeHref);
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

  return (
    <div className={`mudavym mdv-pub mdv-auth-shell${className ? ` ${className}` : ''}`} data-measure={measure ?? 'door'}>
      {signatureTakesFocus ? (
        <a className="mdv-pub__skip" href={`#${mainId}`}>
          Skip to the content
        </a>
      ) : null}
      <div className="mdv-pub__col">
        {heading(signature)}
        {main}
        {foot}
      </div>
    </div>
  );
}

export default AuthorizeShell;
