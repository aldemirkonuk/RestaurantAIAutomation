import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The app's one QueryClient asks every read to re-read on mount, which would
 * make a drawer's `staleTime` dead config. `keepFreshWindows` is what lets the
 * listed keys keep theirs, and nothing but App.tsx can call it on the live
 * client: a bare `new QueryClient(...)` there passes every other test. So this
 * reads the source that builds the client (r41 inventory, From #1678).
 */
const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');

describe("App.tsx's query client", () => {
  it('imports keepFreshWindows from lib/freshWindows', () => {
    expect(app).toMatch(/import\s*\{\s*keepFreshWindows\s*\}\s*from\s*'\.\/lib\/freshWindows'/);
  });

  it('is built by wrapping new QueryClient in keepFreshWindows, not bare', () => {
    expect(app).toMatch(/const queryClient\s*=\s*keepFreshWindows\(\s*new QueryClient\(/);
    expect(app).not.toMatch(/const queryClient\s*=\s*new QueryClient\(/);
  });

  it('hands that same client to the provider', () => {
    expect(app).toMatch(/<QueryClientProvider client=\{queryClient\}/);
  });
});
