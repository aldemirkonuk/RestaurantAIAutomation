/**
 * F-735: the routes with no house shell around them get a page boundary of
 * their own — the house error screen in its standalone words, cleared by any
 * navigation — instead of falling through to App.tsx's outermost card.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../lib/error-tracking', () => ({
  errorTracking: { captureException: vi.fn().mockReturnValue('event-id') },
}));

import { PageBoundary } from './PageBoundary';

describe('PageBoundary', () => {
  it('shows the standalone house screen, not the legacy card, and a same-page link clears it', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let crash = true;
    const Door = () => {
      if (crash) throw new Error('boom');
      return <div>the door</div>;
    };
    render(
      <MemoryRouter initialEntries={['/receiving/o-1/door']}>
        <Link to="/receiving/o-1/door?again=1">again</Link>
        <Routes>
          <Route
            path="/receiving/:orderId/door"
            element={
              <PageBoundary>
                <Door />
              </PageBoundary>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('This page ran into a problem.')).toBeTruthy();
    expect(screen.queryByText('Something went wrong')).toBeNull();
    expect(screen.queryByText(/shell/i)).toBeNull();
    crash = false;
    fireEvent.click(screen.getByText('again'));
    expect(screen.getByText('the door')).toBeTruthy();
    consoleError.mockRestore();
  });
});

describe('App.tsx wraps every route outside the shell', () => {
  const app = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');

  // The element of `<Route path="…"`, up to the route's closing `/>`.
  function elementOf(path: string): string {
    const at = app.indexOf(`path="${path}"`);
    expect(at, `route ${path} exists`).toBeGreaterThan(-1);
    return app.slice(at, app.indexOf('/>\n', app.indexOf('element=', at)));
  }

  it.each([
    '/receiving/:orderId/door',
    '/v/:slug',
    '/get-started',
    '/studio',
    '/studio/queue',
    '/studio/certify',
    '/studio/invite/:token',
    '/authorize/complete',
    '/authorize/:integrationId',
  ])('%s', (path) => {
    expect(elementOf(path)).toMatch(/element=\{\s*<PageBoundary[\s>]/);
  });

  it('the vendor portal offers no dashboard to a visitor', () => {
    expect(elementOf('/v/:slug')).toContain('<PageBoundary showHome={false}>');
  });
});
