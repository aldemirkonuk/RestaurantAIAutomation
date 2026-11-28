/**
 * Guard: what a stranger downloads before the first paint.
 *
 * Every module `main.tsx` reaches through static imports lands in the entry
 * chunk (or a chunk the entry imports statically), and `index.html` loads all
 * of it before anything renders, for the landing page and the sign-in screen
 * alike. On 2026-11-07 that was about 797 KB of gzipped JS, because:
 *
 *  - `App.tsx` imported Login, Register and the inventory pages statically,
 *    which brought the register form's phone library and the whole inventory
 *    desk into the entry;
 *  - `ToastContext.tsx`, an entry module, imported the `@wineops/ui` barrel,
 *    which re-exports the Tremor charts, so Tremor and recharts came along
 *    (~615 KB of recharts alone, before minifying) although only the Reports
 *    page draws a chart;
 *  - `vite.config.ts` named `@tremor/react` in the eagerly loaded `ui`
 *    manual chunk, which pins a package and its dependencies to that chunk.
 *
 * After the fix it measured about 350 KB (2026-11-07 bundle QA, H1). This walks
 * the static import graph from `main.tsx` in source, the way `ask-route.test.ts`
 * reads App.tsx, rather than running a production build inside the test run.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '..');
const UI_SRC = resolve(SRC, '..', '..', '..', 'packages', 'ui', 'src');

/** Packages that must load with the page that needs them, never on first paint. */
const LATE_PACKAGES = ['recharts', '@tremor/react', 'libphonenumber-js', 'react-phone-number-input'];

/** Route pages that load with their own route (React.lazy in App.tsx). */
const LATE_PAGES = [
  'pages/Login.tsx',
  'pages/Register.tsx',
  'pages/ForgotPassword.tsx',
  'pages/ResetPassword.tsx',
  'pages/VerifyEmail.tsx',
  'pages/InviteLanding.tsx',
  'pages/NoAccess.tsx',
  'pages/ChooseHouse.tsx',
  'pages/inventory/next/InventoryRoute.tsx',
  'pages/inventory/command/InventoryCommandPage.tsx',
  'pages/reports/next/ReportsNext.tsx',
];

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

function resolveFile(base: string): string | null {
  for (const ext of EXTENSIONS) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** Static specifiers only: `import x from`, `import 'x'`, `export … from`. Not `import()`, not type-only. */
function staticSpecifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m[2]) continue; // `import type` / `export type` is erased at build
    if (m[1] === 'export' && !m[3]) continue;
    out.push(m[4]);
  }
  return out;
}

function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

interface Graph {
  files: Set<string>;
  /** bare package → the first local file that imports it */
  packages: Map<string, string>;
}

function walk(entry: string): Graph {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.(ts|tsx|js|jsx)$/.test(file)) continue;
    for (const spec of staticSpecifiers(readFileSync(file, 'utf8'))) {
      let target: string | null = null;
      if (spec.startsWith('.')) target = resolveFile(resolve(dirname(file), spec));
      else if (spec.startsWith('@/')) target = resolveFile(join(SRC, spec.slice(2)));
      else if (spec === '@wineops/ui') target = resolveFile(join(UI_SRC, 'index'));
      else if (spec.startsWith('@wineops/ui/')) target = resolveFile(join(UI_SRC, spec.slice('@wineops/ui/'.length)));
      else {
        const name = packageName(spec);
        if (!packages.has(name)) packages.set(name, file);
        continue;
      }
      if (target) stack.push(target);
    }
  }
  return { files, packages };
}

const rel = (p: string) => p.replace(SRC + '/', 'src/').replace(UI_SRC + '/', 'packages/ui/src/');

describe('first-paint bundle (2026-11-07 bundle QA, H1)', () => {
  const graph = walk(join(SRC, 'main.tsx'));

  it('walks the real entry graph (the walker is not vacuous)', () => {
    expect(graph.files.has(join(SRC, 'App.tsx'))).toBe(true);
    expect(graph.files.has(join(SRC, 'contexts', 'ToastContext.tsx'))).toBe(true);
    expect(graph.packages.has('react-router-dom')).toBe(true);
    expect(graph.files.size).toBeGreaterThan(50);
  });

  it('no chart or phone-number package is reachable from main.tsx by static import', () => {
    const reached = LATE_PACKAGES.filter((p) => graph.packages.has(p)).map(
      (p) => `${p} (imported by ${rel(graph.packages.get(p)!)})`,
    );
    expect(reached).toEqual([]);
  });

  it('sign-in, sign-up, inventory and reports pages load with their own route', () => {
    const reached = LATE_PAGES.filter((p) => graph.files.has(join(SRC, p)));
    expect(reached).toEqual([]);
  });

  // A route chunk carries every package its page reaches by static import, so
  // checking main.tsx alone said nothing about what a stranger downloads on
  // /login or /register. On 2026-11-07 every sign-in page imported
  // `components/ui`, whose `@wineops/ui` barrel re-exports the Tremor charts:
  // /login fetched about 585 KB of gzipped JS, both chart chunks included.
  // The phone-number packages are Register's own, so they are allowed there.
  const CHART_PACKAGES = ['recharts', '@tremor/react'];
  const PUBLIC_PAGES = [
    'pages/landing/Landing.tsx',
    'pages/Login.tsx',
    'pages/Register.tsx',
    'pages/ForgotPassword.tsx',
    'pages/ResetPassword.tsx',
    'pages/VerifyEmail.tsx',
    'pages/InviteLanding.tsx',
  ];

  it.each(PUBLIC_PAGES)('%s reaches no chart package by static import', (page) => {
    const entry = join(SRC, page);
    expect(existsSync(entry), `${page} exists`).toBe(true);
    const pageGraph = walk(entry);
    expect(pageGraph.packages.has('react'), 'the walker read the page').toBe(true);
    const reached = CHART_PACKAGES.filter((p) => pageGraph.packages.has(p)).map(
      (p) => `${p} (imported by ${rel(pageGraph.packages.get(p)!)})`,
    );
    expect(reached).toEqual([]);
  });

  it('vite.config.ts pins no chart package to an eagerly loaded manual chunk', () => {
    const config = readFileSync(join(SRC, '..', 'vite.config.ts'), 'utf8');
    const block = config.match(/manualChunks:\s*\{([\s\S]*?)\n\s*\}/);
    expect(block, 'manualChunks block found').not.toBeNull();
    for (const pkg of ['@tremor/react', 'recharts']) {
      expect(block![1]).not.toContain(`'${pkg}'`);
    }
  });
});
