/**
 * A relative import inside `middleware.ts`'s dependency graph must carry an
 * explicit `.js` extension.
 *
 * Found live on this PR's preview deployment: `middleware.ts` imported
 * `./src/lib/seo/vendor-edge` (no extension) — correct under `tsc`'s
 * "bundler" resolution and under Vite, both of which resolve an extensionless
 * specifier to the sibling `.ts` file, so every local check passed. Vercel's
 * Node.js middleware runtime does not bundle the file; it runs it through
 * Node's native ESM loader, which never appends extensions the way `require`
 * does, and failed at every request:
 *
 *   Error [ERR_MODULE_NOT_FOUND]: Cannot find module
 *   '/var/task/apps/web/src/lib/seo/vendor-edge' imported from
 *   '/var/task/apps/web/middleware.js'
 *
 * `.js` is correct even though the source file is `.ts`: `tsconfig.json`'s
 * `"moduleResolution": "bundler"` resolves a `.js` specifier to the sibling
 * `.ts` file, which is the standard way to write Node-ESM-safe TypeScript.
 *
 * This test cannot run the middleware on Vercel's platform, so it proves the
 * one thing that actually failed: every specifier reachable from
 * `middleware.ts` is written the way Node's loader — not tsc's or Vite's —
 * needs it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB = join(__dirname, '..', '..', '..');
const ENTRY = join(WEB, 'middleware.ts');

const IMPORT_RE = /\bimport\s+(?:type\s+)?(?:[\s\S]*?\bfrom\s+)?['"](\.[^'"]+)['"]/g;

function relativeImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(IMPORT_RE)].map((m) => m[1]);
}

/** `./vendor-edge.js` from a file in `src/lib/seo` -> the real path on disk. */
function resolveSpecifier(fromFile: string, specifier: string): string {
  const stripped = specifier.endsWith('.js') ? specifier.slice(0, -3) : specifier;
  return resolve(dirname(fromFile), `${stripped}.ts`);
}

/** Every file `middleware.ts` reaches by relative import, transitively. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of relativeImports(file)) {
      queue.push(resolveSpecifier(file, specifier));
    }
  }
  return [...seen];
}

describe('middleware.ts import graph is Node-ESM-safe', () => {
  const files = importGraph(ENTRY);

  it('found more than just the entry file (the walk itself works)', () => {
    // A graph of one file means resolveSpecifier or relativeImports broke
    // silently, which would make every case below vacuously pass.
    expect(files.length).toBeGreaterThan(1);
  });

  it('every relative import in every reachable file carries an explicit extension', () => {
    const bare: string[] = [];
    for (const file of files) {
      for (const specifier of relativeImports(file)) {
        if (!/\.(js|json)$/.test(specifier)) {
          bare.push(`${file.replace(WEB + '/', '')}: "${specifier}"`);
        }
      }
    }
    expect(bare).toEqual([]);
  });
});
