/**
 * `AuthorizeShell` (founder, batch 4, 2026-09-19 -- ADR 0144's "Still open"
 * bullet 3): `/authorize` and `/authorize/complete` get a proper signed-in
 * frame, driven by the per-house design flag when a house is known and by
 * the ADR 0133 public-door switch when it is not, instead of always
 * rendering `PublicShell`.
 *
 * `useMudavymDesign` and `usePublicDesign` are mocked rather than driven
 * through their own internals (localStorage, the feature-flag API, the env
 * var) -- both are unit-tested on their own elsewhere; what this file proves
 * is which one `AuthorizeShell` LISTENS to, and when.
 *
 * [Round 5, 2026-09-21: the `chrome="own"` / `chrome="ambient"` split this
 * file used to test is deleted -- see AuthorizeShell.tsx's file header for
 * why it was a regression, not a style choice. There is now exactly one
 * design-ON frame, and this file's second describe block tests it: it states
 * WHO is granting and FOR WHICH HOUSE when `AuthContext` knows one, and falls
 * back to a plain, identity-free Wordmark signature when it does not.]
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AuthContext } from '../../contexts/AuthContext';
import { AuthorizeShell, useAuthorizeDesignOn } from './AuthorizeShell';

const mudavymDesign = vi.fn();
const publicDesign = vi.fn();

vi.mock('../../lib/mudavym/useMudavymDesign', () => ({
  useMudavymDesign: (page: string) => mudavymDesign(page),
}));
vi.mock('../../lib/mudavym/publicDesign', () => ({
  usePublicDesign: () => publicDesign(),
}));

function HookProbe() {
  return <span data-testid="probe">{String(useAuthorizeDesignOn())}</span>;
}

const withHouse = (activeRestaurantId: string | null) =>
  ({ activeRestaurantId } as never);

/** A house AuthContext carries a person's name and/or a matching branch name. */
const withIdentity = (activeRestaurantId: string, personName: string | null, houseName: string | null) =>
  ({
    activeRestaurantId,
    user: personName ? { name: personName } : null,
    availableRestaurants: houseName
      ? [{ id: activeRestaurantId, name: houseName, city: null, chain_id: null, chain_name: null }]
      : [],
  } as never);

beforeEach(() => {
  mudavymDesign.mockReset().mockReturnValue(false);
  publicDesign.mockReset().mockReturnValue(false);
});

describe('useAuthorizeDesignOn: which switch is asked, and when', () => {
  it('with no AuthContext at all (a lapsed session), asks the public-door switch, never the per-house flag result', () => {
    publicDesign.mockReturnValue(true);
    render(<HookProbe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
    expect(mudavymDesign).toHaveBeenCalledWith('authorize_integration'); // called (Rules of Hooks)...
    // ...but its `false` return must not have overridden the public switch's `true`.
  });

  it('with a house context but no active restaurant id, still asks the public-door switch', () => {
    publicDesign.mockReturnValue(true);
    mudavymDesign.mockReturnValue(false);
    render(<AuthContext.Provider value={withHouse(null)}><HookProbe /></AuthContext.Provider>);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('with an active restaurant id, the per-house flag decides -- true even while the public switch is false', () => {
    mudavymDesign.mockReturnValue(true);
    publicDesign.mockReturnValue(false);
    render(<AuthContext.Provider value={withHouse('house-1')}><HookProbe /></AuthContext.Provider>);
    expect(screen.getByTestId('probe')).toHaveTextContent('true');
  });

  it('with an active restaurant id, the per-house flag decides -- false even while the public switch is true', () => {
    mudavymDesign.mockReturnValue(false);
    publicDesign.mockReturnValue(true);
    render(<AuthContext.Provider value={withHouse('house-1')}><HookProbe /></AuthContext.Provider>);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  it('reads the authorize_integration page key -- the same flag PageGate gates /authorize/:integrationId on', () => {
    render(<AuthContext.Provider value={withHouse('house-1')}><HookProbe /></AuthContext.Provider>);
    expect(mudavymDesign).toHaveBeenCalledWith('authorize_integration');
  });
});

describe('AuthorizeShell, no house known: the standalone /authorize/complete case', () => {
  it('design OFF renders on PublicShell (today’s page, unchanged) -- no .mdv-auth-shell marker', () => {
    const { container } = render(
      <AuthorizeShell title="Finishing your connection" homeHref="/profile">
        <p role="status">Checking…</p>
      </AuthorizeShell>,
    );
    const root = container.querySelector('.mudavym');
    expect(root).not.toBeNull();
    expect(root).not.toHaveClass('mdv-auth-shell');
    expect(screen.getByRole('heading', { level: 1, name: 'Finishing your connection' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking…');
  });

  it('design ON (public-door switch, no house) renders the signed-in-capable frame, not PublicShell, with no identity claim', () => {
    publicDesign.mockReturnValue(true);
    const { container } = render(
      <AuthorizeShell title="Finishing your connection" homeHref="/profile">
        <p role="status">Checking…</p>
      </AuthorizeShell>,
    );
    const root = container.querySelector('.mudavym');
    expect(root).toHaveClass('mdv-auth-shell');
    expect(root).not.toHaveClass('mdv-auth-shell--identity');
    expect(container.querySelector('.mdv-auth-shell__identity')).toBeNull();
    // Still exactly one <h1> -- "a door with no sign" rule carries over.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Skip to the content/ })).toBeInTheDocument();
  });

  it('design ON via the per-house flag (a house context, still reachable on the return leg), but with no name or branch on it, also falls back to no identity claim', () => {
    mudavymDesign.mockReturnValue(true);
    const { container } = render(
      <AuthContext.Provider value={withHouse('house-1')}>
        <AuthorizeShell title="Finishing your connection">
          <p role="status">Checking…</p>
        </AuthorizeShell>
      </AuthContext.Provider>,
    );
    expect(container.querySelector('.mudavym')).toHaveClass('mdv-auth-shell');
    // A house id is known, but nothing named it (no user, no matching
    // branch) -- ADR 0020: say nothing rather than invent a name.
    expect(container.querySelector('.mdv-auth-shell__identity')).toBeNull();
  });

  it('never renders a Seal in either state (neither call site has ever asked for one)', () => {
    const { container, rerender } = render(
      <AuthorizeShell title="t"><p>x</p></AuthorizeShell>,
    );
    expect(container.querySelector('.mdv-pub__seal')).toBeNull();
    publicDesign.mockReturnValue(true);
    rerender(<AuthorizeShell title="t"><p>x</p></AuthorizeShell>);
    expect(container.querySelector('.mdv-pub__seal')).toBeNull();
  });
});

describe('AuthorizeShell, a house is known: the identity frame both /authorize/:integrationId and /authorize/complete share', () => {
  it('states who is granting and for which house, read straight from AuthContext', () => {
    mudavymDesign.mockReturnValue(true);
    const { container } = render(
      <AuthContext.Provider value={withIdentity('house-1', 'Jordan Rivera', 'The Anchor')}>
        <AuthorizeShell title="Connect Gmail" eyebrow="A personal permission" homeHref="/profile">
          <p>content</p>
        </AuthorizeShell>
      </AuthContext.Provider>,
    );
    const root = container.querySelector('.mudavym');
    expect(root).toHaveClass('mdv-auth-shell');
    expect(root).toHaveClass('mdv-auth-shell--identity');
    expect(screen.getByRole('heading', { level: 1, name: 'Connect Gmail' })).toBeInTheDocument();
    expect(screen.getByText('Jordan Rivera')).toBeInTheDocument();
    expect(screen.getByText('The Anchor')).toBeInTheDocument();
  });

  it('has a masthead and an exit link -- this is the regression PageGate does NOT supply for this NO_CHROME page', () => {
    mudavymDesign.mockReturnValue(true);
    render(
      <AuthContext.Provider value={withIdentity('house-1', 'Jordan Rivera', 'The Anchor')}>
        <AuthorizeShell title="Connect Gmail" homeHref="/profile">
          <p>content</p>
        </AuthorizeShell>
      </AuthContext.Provider>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    // The signature itself is the exit: homeHref wraps the Wordmark in a link
    // to /profile, the shell's one "leave the flow entirely" affordance.
    const links = screen.getAllByRole('link');
    expect(links.some((link) => link.getAttribute('href') === '/profile')).toBe(true);
  });

  it('carries no navigation beyond its own single exit -- no house switcher, no second link', () => {
    mudavymDesign.mockReturnValue(true);
    render(
      <AuthContext.Provider value={withIdentity('house-1', 'Jordan Rivera', 'The Anchor')}>
        <AuthorizeShell title="Connect Gmail" homeHref="/profile">
          <p>content</p>
        </AuthorizeShell>
      </AuthContext.Provider>,
    );
    // Exactly two links exist on the whole frame: the skip link and the
    // homeHref-wrapped signature. Neither is a switcher or a way to wander.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('still shows an identity line built from only a name, or only a house, when the other is unavailable', () => {
    mudavymDesign.mockReturnValue(true);
    const { container, rerender } = render(
      <AuthContext.Provider value={withIdentity('house-1', 'Jordan Rivera', null)}>
        <AuthorizeShell title="Connect Gmail"><p>content</p></AuthorizeShell>
      </AuthContext.Provider>,
    );
    expect(screen.getByText('Jordan Rivera')).toBeInTheDocument();
    expect(container.querySelector('.mdv-auth-shell__house')).toBeNull();

    rerender(
      <AuthContext.Provider value={withIdentity('house-1', null, 'The Anchor')}>
        <AuthorizeShell title="Connect Gmail"><p>content</p></AuthorizeShell>
      </AuthContext.Provider>,
    );
    expect(screen.getByText('The Anchor')).toBeInTheDocument();
    expect(container.querySelector('.mdv-auth-shell__person')).toBeNull();
  });

  it('still renders the page’s own eyebrow, title, voice and footer', () => {
    mudavymDesign.mockReturnValue(true);
    render(
      <AuthContext.Provider value={withIdentity('house-1', 'Jordan Rivera', 'The Anchor')}>
        <AuthorizeShell title="Connect Gmail" eyebrow="A personal permission" voice="One sentence." footer={<span>bye</span>}>
          <p>content</p>
        </AuthorizeShell>
      </AuthContext.Provider>,
    );
    expect(screen.getByText('A personal permission')).toBeInTheDocument();
    expect(screen.getByText('One sentence.')).toBeInTheDocument();
    expect(screen.getByText('bye')).toBeInTheDocument();
  });
});
