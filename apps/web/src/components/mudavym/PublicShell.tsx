/**
 * The public shell — the one door a stranger meets, seven times.
 *
 * ADR 0143 §Decision 1, locked by the founder 2026-09-12: `forgot-password`,
 * `reset-password`, `verify-email`, `invite/:code`, `no-access`, `privacy` and
 * `/v/:slug` are built on a single `PublicShell` — wordmark, the seal, one
 * sentence in the house voice, both grounds — rather than seven separate
 * treatments. "One thing to get right, one thing to review, and a stranger
 * meets the same house at every door."
 *
 * `login` and `register` are NOT in that set and this component is not for
 * them: the founder rejected their redrawn versions and asked for today's
 * pages improved instead, so their in-place treatment remains separate from this shell.
 *
 * WHAT THE SEVEN ACTUALLY CONTAIN (read 2026-09-12, not idealised)
 * ---------------------------------------------------------------
 * The shell was shaped from the pages as they ship, because four different
 * things have to fit through it:
 *
 *   a FORM            `ForgotPassword.tsx:97` — a labelled field, a submit,
 *                     an error that is not a colour, a way back.
 *   a ONE-SHOT        `VerifyEmail.tsx:72` — no input at all; a statement and
 *                     at most one act. `NoAccess.tsx`, `ResetPassword`'s
 *                     success and `InviteLanding`'s expired state are the same
 *                     shape wearing different words.
 *   a DOCUMENT        `Privacy.tsx:16` — one `h1` and six `h2`s of prose that
 *                     scrolls well past a phone viewport.
 *   a PUBLIC BOARD    `VendorPortal.tsx:196` — a vendor's own catalogue on a
 *                     token in the URL, with a toolbar and a six-column table
 *                     that cannot be read at 375px without scrolling.
 *
 * One shell holds all four by varying ONE thing — the measure of the column —
 * and nothing else. See `measure` below, and `public-shell.css` for the widths.
 * The masthead, the heading order, the focus behaviour and the grounds are
 * identical in all four: that is the part that was worth sharing.
 *
 * WHAT IT DELIBERATELY DOES NOT IMPORT
 * ------------------------------------
 * No `AuthContext`, no `DashboardLayout`, no `PageGate`, no `useMudavymDesign`,
 * no `react-router`. A signed-out page that pulls in the authenticated shell is
 * the bug this component exists to prevent, and "it happens to work today" is
 * not a guard — `PublicShell.test.tsx` reads this file back and fails the build
 * if any of those names appear in an import. Links are a `footer`/`children`
 * slot rather than a `<Link>` so the shell renders under a bare `render()` with
 * no Router and no provider of any kind above it.
 *
 * The one import from `lib/` is `import type { MudavymGround }`, which is
 * erased at compile time: one vocabulary for the ground, zero runtime coupling.
 *
 * GROUNDS FOLLOW THE CURRENT SHARED TOKEN CONTRACT
 * ------------------------------------------------
 * `mudavym.css` now defaults to the founder-decided Warm Charcoal, independent
 * of the legacy app theme. An explicit paper prop puts data-ground="paper" on
 * the SAME .mudavym node so the shared paper exception can take effect. This
 * shell defines no competing palette or media-query override.
 *
 * THE VOCABULARY IS `sheet.css`'s, NOT A SECOND ONE
 * -------------------------------------------------
 * `.mdv-label`, `.mdv-input`, `.mdv-btn`, `.mdv-btn--seal`, `.mdv-alert`,
 * `.mdv-link`, `.mdv-note`, `.mdv-quiet`, `.mdv-record` and `.mdv-panelbox` are
 * declared unscoped in `sheet.css` (they are not under `.mdv-ovl`), so a page
 * in this shell dresses its form in the house's own classes rather than
 * re-deriving ink and spacing — the same move `HouseHeader.tsx:88-91` makes and
 * for the same reason. This file imports `sheet.css` to guarantee they are
 * present even when no overlay has ever opened.
 */

import { useEffect, useId, type ReactNode } from 'react';
import { Seal } from './Seal';
import { Wordmark } from './Wordmark';
import type { MudavymGround } from '../../lib/mudavym/shellGround';
// The token column. `styles/globals.css:4` already `@import`s it for the whole
// app; the import here makes the shell self-sufficient in a sandbox or a test
// and is deduped by the bundler — the same reasoning as HouseHeader's.
import '../../styles/mudavym.css';
import './sheet.css';
import './public-shell.css';

/* ── Fraunces ─────────────────────────────────────────────────────────────
   index.html loads DM Sans / Plus Jakarta Sans / JetBrains Mono but not the
   house serif, and the title is set in it. The id is the one `Sheet.tsx:71`,
   `HouseHeader.tsx:106` and `pages/dashboard/next/fonts.ts:10` use, so all four
   injectors add at most one link between them. A fourth copy of six lines is
   worse than one shared helper and better than a component reaching up into a
   page tree for it; consolidating the four is a follow-up, not this task. */
const FRAUNCES_LINK_ID = 'mudavym-fraunces';

function ensureFraunces(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(FRAUNCES_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = FRAUNCES_LINK_ID;
  link.rel = 'stylesheet';
  link.href =
    'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..680;1,9..144,300..680&display=swap';
  document.head.appendChild(link);
}

/**
 * How wide the column is, chosen by what the page IS — not by taste.
 *
 *   `door`      a form or a one-shot outcome. A narrow plate, centred in the
 *               viewport when there is room for it.
 *   `document`  prose that scrolls. A reading measure, start-aligned.
 *   `board`     a public catalogue: a toolbar and a table. The full page.
 *
 * Three, not "a width prop": a fourth measure needs a reason, the way ADR 0112
 * made the sheet's second width a boolean rather than a number.
 */
export type PublicShellMeasure = 'door' | 'document' | 'board';

export interface PublicShellProps {
  /**
   * The page's own heading — the single `<h1>` on the page. Required: a door
   * with no sign is the thing this shell exists to stop (the same rule
   * `Sheet.tsx`'s required `label` follows).
   *
   * Content inside `children` therefore starts at `<h2>`.
   */
  title: ReactNode;
  /**
   * The one sentence in the house voice (ADR 0143). Each of the seven has its
   * own, so it is a prop and never a hardcoded string.
   */
  voice?: ReactNode;
  /** Mono eyebrow above the title — what KIND of door this is. */
  eyebrow?: ReactNode;
  /** The page. Rendered inside `<main>`. */
  children: ReactNode;
  /** Default `door`. See {@link PublicShellMeasure}. */
  measure?: PublicShellMeasure;
  /**
   * Force a ground. Left off, the shared charcoal default applies.
   * An explicit paper value uses the shared token stylesheet’s paper exception.
   */
  ground?: MudavymGround;
  /**
   * The wax seal above the name. Default true.
   *
   * It is a prop because the seal is the house's APPROVAL die (`Seal.tsx:1-8` —
   * the hold-to-approve gesture completes into it), and a page that carries a
   * third party's content rather than the house's own may not want the house
   * appearing to vouch for it. `/v/:slug` is the live instance of that question
   * and it is the founder's call, not this component's.
   */
  seal?: boolean;
  /**
   * Where the house signature points. A plain `<a>`, not a router `<Link>` —
   * see the file header. Omitted, the signature is text and takes no focus.
   */
  homeHref?: string;
  /** A quiet line under the content: a way back, a disclaimer, a house line. */
  footer?: ReactNode;
  className?: string;
  /** Extra class on `<main>` — a form grid, a prose rhythm, a board layout. */
  mainClassName?: string;
}

export function PublicShell({
  title,
  voice,
  eyebrow,
  children,
  measure = 'door',
  ground,
  seal = true,
  homeHref,
  footer,
  className,
  mainClassName,
}: PublicShellProps) {
  // `useId()` returns `:r0:`; the colons are legal in a fragment but make the
  // id unusable in a CSS selector, and a reader debugging this should not have
  // to know that. Stripped, it is still unique per instance.
  const mainId = `mdv-pub-main-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    ensureFraunces();
  }, []);

  /* The skip link exists only when there is something to skip. With no
     `homeHref` the masthead is the seal, the name, a heading and a sentence —
     all inert — so the first Tab already lands on the first control inside
     `<main>`, and a "skip to content" that skips nothing is one more stop
     between a person and the field they came to fill in. `<main>` is focusable
     either way (`tabIndex={-1}`), because a skip target that cannot take focus
     silently does nothing in Safari and Chrome. */
  const signatureTakesFocus = Boolean(homeHref);

  const signature = (
    <span className="mdv-pub__sign">
      {seal ? (
        <Seal size={measure === 'door' ? 34 : 24} className="mdv-pub__seal" />
      ) : null}
      <Wordmark size={measure === 'door' ? 19 : 15} />
    </span>
  );

  return (
    <div
      className={`mudavym mdv-pub${className ? ` ${className}` : ''}`}
      data-ground={ground}
      data-measure={measure}
    >
      {signatureTakesFocus ? (
        <a className="mdv-pub__skip" href={`#${mainId}`}>
          Skip to the content
        </a>
      ) : null}

      <div className="mdv-pub__col">
        <header className="mdv-pub__mast">
          {homeHref ? (
            <a className="mdv-pub__signlink" href={homeHref}>
              {signature}
            </a>
          ) : (
            signature
          )}
          {eyebrow ? <span className="mdv-pub__eyebrow">{eyebrow}</span> : null}
          <h1 className="mdv-pub__title">{title}</h1>
          {voice ? <p className="mdv-pub__voice">{voice}</p> : null}
        </header>

        <main
          id={mainId}
          tabIndex={-1}
          className={`mdv-pub__main${mainClassName ? ` ${mainClassName}` : ''}`}
        >
          {children}
        </main>

        {footer ? <footer className="mdv-pub__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

export default PublicShell;
