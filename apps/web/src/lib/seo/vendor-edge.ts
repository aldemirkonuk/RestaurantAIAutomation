/**
 * The /v/:slug request, answered at the edge (apps/web/middleware.ts).
 *
 * Status is the part a crawler believes, so each outcome gets its true one:
 *
 *   published catalogue      200, indexable head, facts in the body
 *   not a catalogue          404, closed head, the app boots and says so
 *   gateway slow or failing  503 + Retry-After, closed head, the app boots
 *   template unreachable     continue: the host serves the app shell as it
 *                            did before this existed (a protected preview
 *                            answers the self-fetch with a sign-in redirect)
 *
 * A 503 rather than a 200-with-noindex on an outage: a crawler retries a 503
 * later, while a noindex it trusts drops a live catalogue from the index.
 *
 * Unpublished and nonexistent stay indistinguishable (the gateway answers 404
 * for both), so nothing here lets a stranger find a draft.
 *
 * Everything is injected so the behaviour is tested without the platform;
 * the gateway URL lives in middleware.ts, outside src, where the "no raw
 * gateway fetch" rule for the app does not apply to server code.
 */

import { VENDOR_SHELL_FILE, VENDOR_SLUG_RE, renderVendorClosed, renderVendorPage, type VendorHeadPayload } from './vendor.js';
import { titleWithSite } from './site.js';

export type HeadResult =
  | { kind: 'ok'; payload: VendorHeadPayload }
  | { kind: 'missing' }
  | { kind: 'unavailable' };

export interface VendorEdgeDeps {
  /** The template from this deployment, or null when it cannot be read. */
  loadTemplate(origin: string): Promise<string | null>;
  loadHead(slug: string): Promise<HeadResult>;
}

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=0, must-revalidate',
};

/** Hand the request back to the host's own routing (what `next()` in @vercel/functions sends). */
export function continueRequest(): Response {
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}

export async function handleVendorRequest(request: Request, deps: VendorEdgeDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return continueRequest();
  const url = new URL(request.url);
  const match = /^\/v\/([^/]+)$/.exec(url.pathname);
  if (!match) return continueRequest();

  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    slug = match[1];
  }

  // The gateway lowercases before reading, so /v/Acme and /v/acme are the
  // same catalogue. One URL keeps it: the other redirects.
  const lower = slug.toLowerCase();
  if (lower !== slug && VENDOR_SLUG_RE.test(lower)) {
    const target = new URL(url);
    target.pathname = `/v/${lower}`;
    return new Response(null, { status: 308, headers: { location: target.toString() } });
  }

  const template = await deps.loadTemplate(url.origin);
  if (!template) return continueRequest();

  if (!VENDOR_SLUG_RE.test(slug)) return closed(template, 404);

  const head = await deps.loadHead(slug);
  if (head.kind === 'missing') return closed(template, 404);
  if (head.kind === 'unavailable') return closed(template, 503);
  return new Response(renderVendorPage(template, head.payload), { status: 200, headers: HTML_HEADERS });
}

function closed(template: string, status: 404 | 503): Response {
  const headers: Record<string, string> = { ...HTML_HEADERS, 'x-robots-tag': 'noindex' };
  if (status === 503) headers['retry-after'] = '300';
  const title = titleWithSite(status === 404 ? 'Not found' : 'Catalogue unavailable');
  return new Response(renderVendorClosed(template, title), { status, headers });
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Reads the template once per running instance and keeps it: it only changes
 * with a deployment, and a deployment gets new instances.
 *
 * `redirect: 'manual'` and the slot check keep a sign-in page (a protected
 * preview) or any other HTML from ever being used as the template.
 */
export function templateLoader(fetchImpl: FetchLike): VendorEdgeDeps['loadTemplate'] {
  let cached: string | null = null;
  return async (origin) => {
    if (cached) return cached;
    try {
      const res = await fetchImpl(`${origin}/${VENDOR_SHELL_FILE}`, { redirect: 'manual' });
      if (!res.ok) return null;
      const text = await res.text();
      if (!text.includes('<!-- seo:vendor-head -->') || !text.includes('<!-- seo:vendor-body -->')) return null;
      cached = text;
      return text;
    } catch {
      return null;
    }
  };
}

export interface HeadLoaderOptions {
  fetchImpl: FetchLike;
  headUrl: (slug: string) => string;
  timeoutMs: number;
  /** How long a result is reused. A publish or unpublish shows within this. */
  ttlMs: number;
  maxEntries: number;
  now: () => number;
}

/**
 * Asks the gateway for a catalogue's head, with a timeout and a short cache
 * so a crawler walking many catalogues does not walk the database with it.
 * Only definite answers (200, 404) are cached; a failure is retried next time.
 */
export function headLoader(opts: HeadLoaderOptions): VendorEdgeDeps['loadHead'] {
  const cache = new Map<string, { until: number; result: HeadResult }>();
  return async (slug) => {
    const hit = cache.get(slug);
    if (hit && hit.until > opts.now()) {
      // Map iteration order is insertion order, and eviction below drops the
      // FIRST key — so a hit must re-insert to move this entry to the back,
      // or eviction is oldest-INSERTED rather than least-recently-used. Without
      // this, a crawl that visits many slugs evicts a frequently-viewed
      // catalogue while cold ones it only touched once stay cached.
      cache.delete(slug);
      cache.set(slug, hit);
      return hit.result;
    }

    let result: HeadResult;
    try {
      const res = await opts.fetchImpl(opts.headUrl(slug), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
      if (res.status === 404) {
        result = { kind: 'missing' };
      } else if (!res.ok) {
        return { kind: 'unavailable' };
      } else {
        const payload = (await res.json()) as VendorHeadPayload;
        if (!payload || typeof payload.canonical !== 'string' || !payload.page) return { kind: 'unavailable' };
        result = { kind: 'ok', payload };
      }
    } catch {
      return { kind: 'unavailable' };
    }

    cache.delete(slug);
    cache.set(slug, { until: opts.now() + opts.ttlMs, result });
    while (cache.size > opts.maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return result;
  };
}
