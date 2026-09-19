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

describe('AuthorizeShell, chrome="own" (default): the standalone /authorize/complete case', () => {
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

  it('design ON (public-door switch, no house) renders the signed-in-capable frame, not PublicShell', () => {
    publicDesign.mockReturnValue(true);
    const { container } = render(
      <AuthorizeShell title="Finishing your connection" homeHref="/profile">
        <p role="status">Checking…</p>
      </AuthorizeShell>,
    );
    const root = container.querySelector('.mudavym');
    expect(root).toHaveClass('mdv-auth-shell');
    expect(root).not.toHaveClass('mdv-auth-shell--ambient');
    // Still exactly one <h1> -- "a door with no sign" rule carries over.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Skip to the content/ })).toBeInTheDocument();
  });

  it('design ON via the per-house flag (a house context, still reachable on the return leg) also renders the frame', () => {
    mudavymDesign.mockReturnValue(true);
    const { container } = render(
      <AuthContext.Provider value={withHouse('house-1')}>
        <AuthorizeShell title="Finishing your connection">
          <p role="status">Checking…</p>
        </AuthorizeShell>
      </AuthContext.Provider>,
    );
    expect(container.querySelector('.mudavym')).toHaveClass('mdv-auth-shell');
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

describe('AuthorizeShell, chrome="ambient": the PageGate-wrapped /authorize/:integrationId case', () => {
  it('never falls back to PublicShell, even with every design switch OFF -- PageGate already decided', () => {
    const { container } = render(
      <AuthorizeShell chrome="ambient" title="Connect Gmail" eyebrow="A personal permission">
        <p>content</p>
      </AuthorizeShell>,
    );
    const root = container.querySelector('.mudavym');
    expect(root).toHaveClass('mdv-auth-shell');
    expect(root).toHaveClass('mdv-auth-shell--ambient');
    expect(screen.getByRole('heading', { level: 1, name: 'Connect Gmail' })).toBeInTheDocument();
  });

  it('renders no signature line -- PageGate already mounted a HouseHeader above this tree', () => {
    const { container } = render(
      <AuthorizeShell chrome="ambient" title="Connect Gmail" homeHref="/profile">
        <p>content</p>
      </AuthorizeShell>,
    );
    expect(container.querySelector('.mdv-pub__sign')).toBeNull();
    expect(container.querySelector('.mdv-pub__signlink')).toBeNull();
    // No skip link either: nothing of this shell's own precedes <main>.
    expect(screen.queryByRole('link', { name: /Skip to the content/ })).toBeNull();
  });

  it('still renders the page’s own eyebrow, title, voice and footer', () => {
    render(
      <AuthorizeShell chrome="ambient" title="Connect Gmail" eyebrow="A personal permission" voice="One sentence." footer={<span>bye</span>}>
        <p>content</p>
      </AuthorizeShell>,
    );
    expect(screen.getByText('A personal permission')).toBeInTheDocument();
    expect(screen.getByText('One sentence.')).toBeInTheDocument();
    expect(screen.getByText('bye')).toBeInTheDocument();
  });
});
