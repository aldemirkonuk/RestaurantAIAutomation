/**
 * F-287: `/dev-sandbox` invents wines and sale totals and saves them as house
 * events. A production build must send everyone home from it (the /simpos
 * pattern), and every event it sends must carry the `sandbox` stamp the
 * gateway refuses in production.
 *
 * Read from source, the way `ask-route.test.ts` reads App.tsx.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
const SANDBOX = readFileSync(join(__dirname, '..', 'pages', 'DevSandbox.tsx'), 'utf8');

describe('/dev-sandbox in production (F-287)', () => {
  it('a production build redirects home instead of rendering the sandbox', () => {
    const lines = APP.split('\n').filter((l) => l.includes('path="/dev-sandbox"'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /\{import\.meta\.env\.PROD \? <Navigate to="\/" replace \/> : <DevSandbox \/>\}/,
    );
  });

  it('every event the sandbox saves is stamped so the gateway can refuse it', () => {
    const dispatches = SANDBOX.match(/dispatch(InventoryUpdate|CalendarEvent)\(\{[\s\S]*?\n {4}\}\)/g) ?? [];
    expect(dispatches.length).toBe(3);
    for (const call of dispatches) expect(call).toMatch(/\n\s+sandbox: true,/);
  });
});
