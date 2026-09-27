/**
 * Guard: `/ask` is routed to the Mudavym page for every house, and
 * `/sommelier` only redirects to it (ADR 0145: the founder's 2026-09-12
 * answer "/sommelier redirects here"; the 2026-09-25 amendment: `/ask` is live
 * in code on the founder's 2026-09-22 Q2 "I want all locked pages to be live").
 *
 * Read from App.tsx's source, the way `no-wine-agent-fab.test.ts` reads the
 * tree: App mounts every provider in the product, and rendering it to prove
 * two route lines would test the providers, not the routes.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIVE_PAGES, MUDAVYM_PAGES } from '../lib/mudavym/useMudavymDesign';

const APP = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');

function routeLine(path: string): string {
  const lines = APP.split('\n').filter((l) => l.includes(`path="${path}"`));
  expect(lines, `exactly one <Route path="${path}">`).toHaveLength(1);
  return lines[0];
}

describe('/ask and /sommelier (ADR 0145)', () => {
  it('/ask and an old folio render AskNext through the ask page gate', () => {
    for (const path of ['/ask', '/ask/f/:folioId']) {
      const line = routeLine(path);
      expect(line).toMatch(/<PageGate page="ask"/);
      expect(line).toMatch(/next=\{<AskNext \/>\}/);
    }
  });

  it('/sommelier only redirects to /ask — the old chat is not reachable at its own URL', () => {
    const line = routeLine('/sommelier');
    expect(line).toMatch(/<Navigate to="\/ask" replace/);
    expect(line).not.toMatch(/<SommelierAI/);
  });

  it('ask is a Mudavym page, live for every house in code', () => {
    expect(MUDAVYM_PAGES).toContain('ask');
    expect(LIVE_PAGES.has('ask')).toBe(true);
  });
});
