/**
 * Render contract for the public shell (ADR 0143 §1).
 *
 * Six things, and they are the six the decision actually promised: a stranger
 * meets the same house at every door; both grounds arrive by tokens alone; one
 * shell holds a form, a one-shot outcome, a document and a public board; the
 * keyboard gets in and gets past the masthead; and none of it needs a house.
 *
 * Two of these are source-level guards rather than render assertions, on
 * purpose (CLAUDE.md 5b — a claim that can be checked by a command is written
 * as one):
 *
 *   - "does not import the authenticated shell" cannot be observed by
 *     rendering, because a component that imports `AuthContext` and never reads
 *     it renders perfectly. The claim is about the import graph, so the test
 *     reads the import graph.
 *   - "no colour is defined outside a token, or only inside a media query"
 *     cannot be observed in jsdom, which resolves no stylesheet and matches no
 *     media query. The claim is about the stylesheet's text, so the test reads
 *     the stylesheet's text.
 *
 * Both would otherwise be prose that nothing re-reads.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { PublicShell } from './PublicShell';

/* `import.meta.url` is an http: URL under the jsdom environment, so the source
   guards read from the vitest root (`apps/web`) the way this suite's other
   source-reading tests do (components/locations/locationDialogs.test.tsx:315).
   `readFileSync` throws on a missing path — a failed read must never arrive
   here as an empty string that every `not.toMatch` then passes. */
const HERE = resolve(process.cwd(), 'src/components/mudavym');
const SOURCE = readFileSync(resolve(HERE, 'PublicShell.tsx'), 'utf8');
const STYLES = readFileSync(resolve(HERE, 'public-shell.css'), 'utf8');

/* The stylesheet's DECLARATIONS, with every comment removed. The guards below
   are about what the browser is told, and a comment that names a hex or a
   media feature in order to explain why there isn't one would otherwise fail
   the check it is documenting — and, worse, a real hex hidden in a comment
   would pass a naive `toContain`. Assert on what ships. */
const CSS_RULES = STYLES.replace(/\/\*[\s\S]*?\*\//g, '');

/** The tab order, in document order. Mirrors `Sheet.tsx`'s FOCUSABLE list. */
const FOCUSABLE = [
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function tabOrder(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** The one `.mudavym` node. There must be exactly one — see the ground test. */
function shellRoot(container: HTMLElement): HTMLElement {
  const roots = container.querySelectorAll<HTMLElement>('.mudavym');
  expect(roots).toHaveLength(1);
  return roots[0];
}

/* ── the house is at the door ─────────────────────────────────────────────── */

describe('PublicShell — the same house at every door', () => {
  it('prints the seal, the wordmark, one heading and the sentence it was given', () => {
    const { container } = render(
      <PublicShell
        title="Reset your password"
        voice="Tell us the address on the account and we will send a link to it."
      >
        <p>body</p>
      </PublicShell>,
    );

    // The wordmark is the existing component: "Mudavym" plus a seal-coloured
    // stop, rendered as two nodes, so the text is matched on the container.
    expect(container.textContent).toContain('Mudavym');
    // The seal is the existing component, decorative by default.
    expect(container.querySelector('.mdv-pub__seal')).not.toBeNull();
    expect(container.querySelector('.mdv-pub__seal')).toHaveAttribute('aria-hidden', 'true');

    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
    expect(headings[0].tagName).toBe('H1');
    expect(headings[0]).toHaveTextContent('Reset your password');

    expect(
      screen.getByText('Tell us the address on the account and we will send a link to it.'),
    ).toBeInTheDocument();
  });

  it('the sentence is a prop, never a string of its own', () => {
    const { container, rerender } = render(
      <PublicShell title="A" voice="First sentence.">
        <p>body</p>
      </PublicShell>,
    );
    expect(container.textContent).toContain('First sentence.');

    rerender(
      <PublicShell title="A" voice="A different sentence.">
        <p>body</p>
      </PublicShell>,
    );
    expect(container.textContent).toContain('A different sentence.');
    expect(container.textContent).not.toContain('First sentence.');
  });

  it('drops the seal when a page may not let the house appear to vouch for it', () => {
    const { container } = render(
      <PublicShell title="Kaya Şarapçılık" seal={false} measure="board">
        <p>body</p>
      </PublicShell>,
    );
    expect(container.querySelector('.mdv-pub__seal')).toBeNull();
    // The name stays: the house still says where the page is hosted.
    expect(container.textContent).toContain('Mudavym');
  });

  it('renders a <main> and a <footer> only when there is a footer to render', () => {
    const { container, rerender } = render(
      <PublicShell title="A">
        <p>body</p>
      </PublicShell>,
    );
    expect(container.querySelector('main')).not.toBeNull();
    expect(container.querySelector('footer')).toBeNull();

    rerender(
      <PublicShell title="A" footer={<a href="/login">Back to sign in</a>}>
        <p>body</p>
      </PublicShell>,
    );
    expect(container.querySelector('footer')).not.toBeNull();
  });
});

/* ── both grounds ────────────────────────────────────────────────────────── */

describe('PublicShell — both grounds (ADR 0042)', () => {
  it('declares no ground of its own, so it follows the app theme', () => {
    const { container } = render(
      <PublicShell title="A">
        <p>body</p>
      </PublicShell>,
    );
    const root = shellRoot(container);
    expect(root).toHaveAttribute('data-measure', 'door');
    expect(root.hasAttribute('data-ground')).toBe(false);
  });

  it('puts a forced charcoal ground on the SAME element that carries .mudavym', () => {
    // The trap PageGate.tsx:10-21 documents: a custom property declared on a
    // descendant beats one inherited from an ancestor, so two `.mudavym` nodes
    // with the ground on the outer one leaves the inner subtree on the light
    // token column. One node, both attributes, or the charcoal never lands.
    const { container } = render(
      <PublicShell title="A" ground="charcoal">
        <p>body</p>
      </PublicShell>,
    );
    const root = shellRoot(container);
    expect(root).toHaveClass('mudavym');
    expect(root).toHaveAttribute('data-ground', 'charcoal');
  });

  it('treats an explicit paper ground as "no claim", not as a second declaration', () => {
    const { container } = render(
      <PublicShell title="A" ground="paper">
        <p>body</p>
      </PublicShell>,
    );
    // `data-ground="paper"` would freeze the page on the light column even
    // under the app's own dark theme. Paper is the absence of a claim.
    expect(shellRoot(container).hasAttribute('data-ground')).toBe(false);
  });

  it('defines no colour outside the token column', () => {
    // No hex literal anywhere — every colour is a `var(--…)` from mudavym.css.
    expect(CSS_RULES).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // No rgb()/rgba()/hsl() literal either: a shadow colour is still a colour.
    expect(CSS_RULES).not.toMatch(/\b(rgba?|hsla?)\(/);
    // Nothing may be defined ONLY inside a theme branch, so there are no theme
    // branches here at all; the ground turns in mudavym.css, for the whole app.
    expect(CSS_RULES).not.toContain('prefers-color-scheme');
    expect(CSS_RULES).not.toContain('[data-theme');
    // And it really does paint a ground — an unpainted body borrows whatever
    // is behind it, which on a charcoal page is a white flash.
    expect(CSS_RULES).toContain('background: var(--paper-0)');
    expect(CSS_RULES).toContain('color: var(--ink-1)');
  });

  it('cancels the app-wide wine focus ring and lands a seal ring on a paper gap', () => {
    // styles/globals.css ships `*:focus-visible { ring-2 ring-wine-500 }` as a
    // box-shadow; an outline alone does not replace it.
    expect(CSS_RULES).toContain('.mdv-pub :focus-visible');
    expect(CSS_RULES).toContain('outline: 2px solid var(--seal)');
    expect(CSS_RULES).toContain('box-shadow: none');
  });

  it('renders no motion at all for a reader who asked for none', () => {
    expect(CSS_RULES).toContain('@media (prefers-reduced-motion: reduce)');
    expect(CSS_RULES).toContain('animation: none');
  });
});

/* ── the four shapes ─────────────────────────────────────────────────────── */

describe('PublicShell — the four shapes the seven pages actually are', () => {
  it('holds a FORM: the field, its label and the submit live inside <main>', () => {
    // The shape of /forgot-password and /reset-password.
    const { container } = render(
      <PublicShell
        title="Reset your password"
        voice="We will send a link to the address on the account."
        eyebrow="Password"
        footer={<a href="/login">Back to sign in</a>}
      >
        <form>
          <label className="mdv-label" htmlFor="email">
            Email address
          </label>
          <input className="mdv-input" id="email" type="email" />
          <button className="mdv-btn mdv-btn--seal" type="submit">
            Send the link
          </button>
        </form>
      </PublicShell>,
    );

    const main = container.querySelector('main') as HTMLElement;
    expect(within(main).getByLabelText('Email address')).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Send the link' })).toBeInTheDocument();
    expect(shellRoot(container)).toHaveAttribute('data-measure', 'door');
    // The eyebrow says what kind of door this is without becoming a heading.
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(container.textContent).toContain('Password');
  });

  it('holds a ONE-SHOT outcome: a statement and at most one act, no input', () => {
    // The shape of /verify-email's verified state, /no-access, and the expired
    // branch of /invite/:code.
    const { container } = render(
      <PublicShell
        title="This invitation has expired"
        voice="Ask the house that sent it for a new link."
        footer={<a href="/login">Back to sign in</a>}
      >
        <p className="mdv-quiet">Nothing was changed on your account.</p>
      </PublicShell>,
    );

    const main = container.querySelector('main') as HTMLElement;
    expect(main.querySelectorAll('input, textarea, select')).toHaveLength(0);
    expect(screen.getByText('Nothing was changed on your account.')).toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
  });

  it('holds a DOCUMENT: one h1 from the shell, every content heading an h2', () => {
    // The shape of /privacy — six sections of prose past a phone viewport.
    const { container } = render(
      <PublicShell
        title="Privacy and data"
        voice="What Mudavym stores, what leaves your browser, and what you control."
        measure="document"
        mainClassName="mdv-pub__prose"
      >
        <section>
          <h2>Cookies</h2>
          <p>Mudavym sets no tracking cookies.</p>
        </section>
        <section>
          <h2>Signing in with Google</h2>
          <p>We never receive your Google password.</p>
        </section>
      </PublicShell>,
    );

    expect(shellRoot(container)).toHaveAttribute('data-measure', 'document');

    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName.slice(1)));
    // Exactly one h1, it comes first, and nothing skips a level after it.
    expect(levels.filter((l) => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    expect(levels.slice(1).every((l) => l === 2)).toBe(true);
  });

  it('holds a PUBLIC BOARD: a wide table scrolls inside the page, not the page', () => {
    // The shape of /v/:slug — a vendor's own catalogue, six columns, read on a
    // phone. A public page that scrolls sideways as a whole is unreadable.
    const { container } = render(
      <PublicShell
        title="Kaya Şarapçılık"
        voice="A catalogue published by this vendor. Prices are the vendor's own."
        measure="board"
        seal={false}
      >
        <div className="mdv-pub__scroll" role="region" aria-label="Catalogue" tabIndex={0}>
          <table>
            <caption>Wines</caption>
            <thead>
              <tr>
                <th scope="col">Wine</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Kalecik Karası</td>
                <td>—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PublicShell>,
    );

    expect(shellRoot(container)).toHaveAttribute('data-measure', 'board');
    const scroller = container.querySelector('.mdv-pub__scroll') as HTMLElement;
    expect(scroller).not.toBeNull();
    expect(within(scroller).getByRole('table')).toBeInTheDocument();
    // A scrollable box no keyboard can reach is WCAG 2.1.1; the class cannot
    // add that for the page, so the shell's own stylesheet says so and this
    // test is the worked example the conversion copies.
    expect(scroller).toHaveAttribute('tabindex', '0');
    expect(scroller).toHaveAccessibleName('Catalogue');
    // The vendor's name is the page's heading; the house is the signature.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Kaya Şarapçılık');
  });
});

/* ── focus order ─────────────────────────────────────────────────────────── */

describe('PublicShell — the keyboard', () => {
  it('offers a skip link first when the masthead can take focus, and it points at <main>', () => {
    const { container } = render(
      <PublicShell title="Reset your password" homeHref="/">
        <button type="button">Send the link</button>
      </PublicShell>,
    );

    const order = tabOrder(container);
    expect(order[0]).toHaveTextContent('Skip to the content');
    expect(order[1]).toHaveClass('mdv-pub__signlink');
    expect(order[2]).toHaveTextContent('Send the link');

    const main = container.querySelector('main') as HTMLElement;
    expect(order[0].getAttribute('href')).toBe(`#${main.id}`);
    expect(main.id).not.toBe('');
    // A skip target that cannot take focus silently does nothing in Safari and
    // Chrome — the anchor scrolls and the focus stays where it was.
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('offers no skip link when there is nothing above the content to skip', () => {
    const { container } = render(
      <PublicShell title="Reset your password">
        <button type="button">Send the link</button>
      </PublicShell>,
    );

    expect(container.querySelector('.mdv-pub__skip')).toBeNull();
    const order = tabOrder(container);
    expect(order[0]).toHaveTextContent('Send the link');
    // The target is still focusable: a page may put its own skip link in.
    expect(container.querySelector('main')).toHaveAttribute('tabindex', '-1');
  });

  it('gives two shells on one page distinct main ids', () => {
    const { container } = render(
      <div>
        <PublicShell title="One" homeHref="/">
          <p>a</p>
        </PublicShell>
        <PublicShell title="Two" homeHref="/">
          <p>b</p>
        </PublicShell>
      </div>,
    );
    const ids = Array.from(container.querySelectorAll('main')).map((m) => m.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    // `useId()` returns `:r0:`; a colon is legal in a fragment but unusable in
    // a CSS selector, so it is stripped.
    expect(ids.every((id) => !id.includes(':'))).toBe(true);
  });
});

/* ── no house ────────────────────────────────────────────────────────────── */

describe('PublicShell — a signed-out page has no house', () => {
  it('renders with no auth context, no router and no provider of any kind', () => {
    // Deliberately a bare render: no MemoryRouter, no AuthProvider, no
    // QueryClientProvider. Any of those becoming necessary is the regression.
    expect(() =>
      render(
        <PublicShell title="You have no house yet" voice="Ask an owner for an invitation.">
          <p>body</p>
        </PublicShell>,
      ),
    ).not.toThrow();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('You have no house yet');
  });

  it('imports nothing that assumes a signed-in house', () => {
    const specifiers = [
      ...SOURCE.matchAll(/^\s*import\s[^\n]*?\sfrom\s+'([^']+)'/gm),
      ...SOURCE.matchAll(/^\s*import\s+'([^']+)'/gm),
    ].map((m) => m[1]);

    expect(specifiers.length).toBeGreaterThan(0);

    // Each of these is a way for the authenticated shell to arrive by accident.
    const forbidden = [
      'react-router',
      'AuthContext',
      '/contexts/',
      'DashboardLayout',
      './PageGate',
      'useMudavymDesign',
      './HouseHeader',
      '/layout/',
    ];
    for (const name of forbidden) {
      expect(specifiers.some((s) => s.includes(name))).toBe(false);
    }

    // The one `lib/` reference is a TYPE, erased before any bundle is written.
    expect(SOURCE).toContain("import type { MudavymGround } from '../../lib/mudavym/shellGround'");
  });

  it('is not re-exported from the barrel, so a CSS import cannot ride into every chunk', () => {
    // `App.tsx:73` takes `PageGate` from the barrel eagerly, so anything the
    // barrel re-exports lands in the main chunk — the reason `StripeCardPanel`
    // is kept out of it (index.ts:5-13). This shell imports three stylesheets
    // and its only callers are seven routes; the same rule applies.
    const barrel = readFileSync(resolve(HERE, 'index.ts'), 'utf8');
    expect(barrel).not.toMatch(/export\s*\{[^}]*PublicShell/);
    expect(barrel).toContain('PublicShell');
  });
});
