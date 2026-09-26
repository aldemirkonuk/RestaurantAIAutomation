/**
 * ADR 0221: `/providers` and `/distributors` became `/vendors`, and the old
 * addresses keep working with everything after the renamed prefix carried
 * over. Three layers, each able to fail on its own:
 *
 *   1. `renamedTarget` — the pure mapping (path tail, query, hash, defaults);
 *   2. `RenamedRoute` inside a real router — the redirect lands, replaces
 *      history, and keeps navigation state;
 *   3. App.tsx itself — the canonical route and both redirects are declared
 *      the way (2) mounts them, read from the file so a revert fails here.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { RenamedRoute, renamedTarget } from './renamedRoute';

const loc = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });

describe('renamedTarget', () => {
  it('moves the bare old path to the new one', () => {
    expect(renamedTarget(loc('/providers'), '/providers', '/vendors')).toBe('/vendors');
  });

  it('keeps the query — ?vendor=<id> is the part that says which vendor', () => {
    expect(renamedTarget(loc('/providers', '?vendor=p1'), '/providers', '/vendors')).toBe('/vendors?vendor=p1');
    expect(renamedTarget(loc('/providers', '?promotions=1'), '/providers', '/vendors')).toBe('/vendors?promotions=1');
  });

  it('keeps the rest of the path and the hash', () => {
    expect(renamedTarget(loc('/providers/p1/terms', '?x=1', '#usual'), '/providers', '/vendors')).toBe(
      '/vendors/p1/terms?x=1#usual',
    );
  });

  it('does not treat a longer word as the renamed prefix', () => {
    // `/providersX` is not under `/providers/`; the tail is dropped rather than glued on.
    expect(renamedTarget(loc('/providersX'), '/providers', '/vendors')).toBe('/vendors');
  });

  it('adds an implied default only when the link did not say otherwise', () => {
    const d = { tab: 'discover' };
    expect(renamedTarget(loc('/distributors'), '/distributors', '/vendors', d)).toBe('/vendors?tab=discover');
    expect(renamedTarget(loc('/distributors', '?q=rioja'), '/distributors', '/vendors', d)).toBe(
      '/vendors?q=rioja&tab=discover',
    );
    expect(renamedTarget(loc('/distributors', '?tab=mine'), '/distributors', '/vendors', d)).toBe('/vendors?tab=mine');
  });
});

function Where() {
  const l = useLocation();
  return (
    <p data-testid="where">
      {l.pathname}
      {l.search}
      {l.hash}|{JSON.stringify(l.state)}
    </p>
  );
}

/** The same three declarations App.tsx makes (checked against the file below). */
function mountAt(entry: string | { pathname: string; search?: string; state?: unknown }) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/vendors" element={<Where />} />
        <Route path="/providers/*" element={<RenamedRoute from="/providers" to="/vendors" />} />
        <Route
          path="/distributors/*"
          element={<RenamedRoute from="/distributors" to="/vendors" defaults={{ tab: 'discover' }} />}
        />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RenamedRoute in a router', () => {
  it('/providers?vendor=p1 lands on /vendors?vendor=p1', () => {
    mountAt('/providers?vendor=p1');
    expect(screen.getByTestId('where').textContent).toBe('/vendors?vendor=p1|null');
  });

  it('/providers?promotions=1 (the link stored notifications carry) keeps its query', () => {
    mountAt('/providers?promotions=1');
    expect(screen.getByTestId('where').textContent).toBe('/vendors?promotions=1|null');
  });

  it('/distributors lands on the discover tab of /vendors', () => {
    mountAt('/distributors');
    expect(screen.getByTestId('where').textContent).toBe('/vendors?tab=discover|null');
  });

  it('a sub-path of an old address keeps its tail (and still reaches the catch-all, as before)', () => {
    mountAt('/providers/p1#terms');
    expect(screen.getByTestId('where').textContent).toBe('/vendors/p1#terms|null');
  });

  it('navigation state survives the hop', () => {
    mountAt({ pathname: '/providers', state: { from: '/orders' } });
    expect(screen.getByTestId('where').textContent).toBe('/vendors|{"from":"/orders"}');
  });
});

describe('App.tsx declares the rename', () => {
  const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
  // The declaration from its `path="..."` up to the next `<Route` — enough to
  // hold one element, whatever its line breaks.
  const routeFor = (path: string) => {
    const at = app.indexOf(`path="${path}"`);
    if (at < 0) throw new Error(`App.tsx: no <Route path="${path}">`);
    const next = app.indexOf('<Route', at);
    return app.slice(at, next < 0 ? undefined : next).replace(/\s+/g, ' ');
  };

  it('/vendors is the page (the providers slug and flag stay)', () => {
    expect(routeFor('/vendors')).toContain('<PageGate page="providers" legacy={<Providers />} next={<ProvidersNext />} />');
  });

  it('/providers/* and /distributors/* redirect with RenamedRoute', () => {
    expect(routeFor('/providers/*')).toContain('<RenamedRoute from="/providers" to="/vendors" />');
    expect(routeFor('/distributors/*')).toContain(
      `<RenamedRoute from="/distributors" to="/vendors" defaults={{ tab: 'discover' }} />`,
    );
  });

  it('no route renders the vendors page at the old addresses', () => {
    expect(app).not.toMatch(/<Route\s+path="\/(providers|distributors)"/);
    expect(app.match(/next=\{<ProvidersNext \/>\}/g)).toHaveLength(1);
  });
});
