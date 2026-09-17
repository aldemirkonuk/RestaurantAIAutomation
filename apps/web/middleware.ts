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

import { handleVendorRequest, headLoader, templateLoader } from './src/lib/seo/vendor-edge';

export const config = {
  matcher: ['/v/:slug'],
  runtime: 'nodejs',
};

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
