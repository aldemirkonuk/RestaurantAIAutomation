/**
 * Vercel Routing Middleware for mudavym.com (ADR 0158).
 *
 * It runs for ONE route, /v/:slug, the published vendor catalogues: the only
 * public page whose head and facts depend on the database, so the only one
 * the build cannot write ahead of time. Every other route is a static file
 * (apps/web/vercel.json), and costs no invocation.
 *
 * It must sit next to apps/web/package.json because the Vercel project's Root
 * Directory is apps/web. All behaviour lives in src/lib/seo/vendor-edge.ts.
 */

import { handleVendorRequest, headLoader, templateLoader } from './src/lib/seo/vendor-edge.js';

export const config = {
  matcher: ['/v/:slug'],
  runtime: 'nodejs',
};

/**
 * `apps/web` is a browser project with no `@types/node` anywhere in its tree
 * (it never needed one before this file). Vercel type-checks `middleware.ts`
 * in isolation as part of building it, so a bare `process.env` reference
 * failed that check with `Cannot find name 'process'` and the deployment
 * silently served every /v/:slug request from the SPA rewrite instead of
 * this file — no build error, no runtime error, just a route that never ran
 * (found by curling this PR's own preview deployment; see ADR 0158's "Known
 * limits"). This local declaration is enough for `process.env` and adds no
 * dependency the rest of the app would inherit.
 */
declare const process: { env: Record<string, string | undefined> };

/** The same gateway the host's /api rewrite points at (vercel.json). */
const GATEWAY_ORIGIN = process.env.SEO_GATEWAY_ORIGIN || 'https://wineopsapi-gateway-production.up.railway.app';

const loadTemplate = templateLoader((input, init) => fetch(input, init));
const loadHead = headLoader({
  fetchImpl: (input, init) => fetch(input, init),
  headUrl: (slug) => `${GATEWAY_ORIGIN}/api/v1/seo/vendors/${encodeURIComponent(slug)}/head`,
  timeoutMs: 1500,
  ttlMs: 60_000,
  maxEntries: 500,
  now: () => Date.now(),
});

export default function middleware(request: Request): Promise<Response> {
  return handleVendorRequest(request, { loadTemplate, loadHead });
}
