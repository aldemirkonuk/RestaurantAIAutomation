import { describe, expect, it, vi } from 'vitest';
import { renderVendorShell, type VendorHeadPayload } from './vendor';
import { handleVendorRequest, headLoader, templateLoader, type HeadResult } from './vendor-edge';

const SHELL = [
  '<!doctype html><html><head>',
  '    <!-- seo:head:start -->',
  '    <title>Mudavym</title>',
  '    <meta name="robots" content="noindex, nofollow" />',
  '    <!-- seo:head:end -->',
  '<script type="module" src="/assets/index-abc.js"></script></head>',
  '<body><div id="root"></div></body></html>',
].join('\n');
const TEMPLATE = renderVendorShell(SHELL);

const PAYLOAD: VendorHeadPayload = {
  slug: 'acme',
  canonical: 'https://mudavym.com/v/acme',
  title: 'Acme catalogue',
  description: 'Natural wine importer.',
  image: null,
  jsonLd: { '@type': 'WebPage' },
  page: {
    displayName: 'Acme',
    tagline: 'Natural wine importer.',
    about: null,
    websiteUrl: null,
    contactEmail: null,
    contactPhone: null,
    listings: [{ productName: 'Barolo', producer: null, vintage: 2019, origin: null, format: null, price: '$20.00', inStock: null }],
  },
};

function deps(head: HeadResult, template: string | null = TEMPLATE) {
  return {
    loadTemplate: vi.fn(async () => template),
    loadHead: vi.fn(async () => head),
  };
}

const get = (path: string, method = 'GET') => new Request(`https://mudavym.com${path}`, { method });

describe('/v/:slug at the edge', () => {
  it('a published catalogue is 200 with its own head and facts in the body', async () => {
    const res = await handleVendorRequest(get('/v/acme'), deps({ kind: 'ok', payload: PAYLOAD }));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Acme catalogue</title>');
    expect(html).toContain('<meta name="robots" content="index, follow" />');
    expect(html).toContain('<td>Barolo</td>');
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('not a catalogue is a 404 that still boots the app, closed', async () => {
    const d = deps({ kind: 'missing' });
    const res = await handleVendorRequest(get('/v/nightly-not-a-vendor'), d);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('src="/assets/index-abc.js"');
    expect(html).toContain('noindex, nofollow');
    expect(html).toContain('<div id="root"></div>');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('a slug the database cannot hold is a 404 without asking the gateway', async () => {
    const d = deps({ kind: 'ok', payload: PAYLOAD });
    const res = await handleVendorRequest(get('/v/a_b'), d);
    expect(res.status).toBe(404);
    expect(d.loadHead).not.toHaveBeenCalled();
  });

  it('an outage is a 503 with Retry-After, never a 200 or a noindex-200', async () => {
    const res = await handleVendorRequest(get('/v/acme'), deps({ kind: 'unavailable' }));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('300');
  });

  it('mixed case redirects to the one lowercase URL, keeping the query', async () => {
    const res = await handleVendorRequest(get('/v/Acme?ref=x'), deps({ kind: 'ok', payload: PAYLOAD }));
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('https://mudavym.com/v/acme?ref=x');
  });

  it('without a template (a protected preview) the host carries on as before', async () => {
    const res = await handleVendorRequest(get('/v/acme'), deps({ kind: 'ok', payload: PAYLOAD }, null));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('other methods and deeper paths are not handled', async () => {
    const d = deps({ kind: 'ok', payload: PAYLOAD });
    expect((await handleVendorRequest(get('/v/acme', 'POST'), d)).headers.get('x-middleware-next')).toBe('1');
    expect((await handleVendorRequest(get('/v/acme/x'), d)).headers.get('x-middleware-next')).toBe('1');
  });
});

describe('loaders', () => {
  it('the template loader refuses a redirect or a page without slots, and keeps a good one', async () => {
    const signIn = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://vercel.com/sso' } }));
    expect(await templateLoader(signIn)('https://preview.test')).toBeNull();
    expect(signIn).toHaveBeenCalledWith('https://preview.test/crawl/vendor-shell.html', { redirect: 'manual' });

    const wrong = vi.fn(async () => new Response('<html>sign in</html>', { status: 200 }));
    expect(await templateLoader(wrong)('https://x.test')).toBeNull();

    const good = vi.fn(async () => new Response(TEMPLATE, { status: 200 }));
    const load = templateLoader(good);
    expect(await load('https://x.test')).toBe(TEMPLATE);
    await load('https://x.test');
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('the head loader caches definite answers only, and times out to unavailable', async () => {
    let now = 0;
    const responses: Response[] = [
      new Response(null, { status: 500 }),
      new Response(JSON.stringify(PAYLOAD), { status: 200 }),
      new Response(null, { status: 404 }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const load = headLoader({
      fetchImpl,
      headUrl: (s) => `https://gw.test/${s}`,
      timeoutMs: 50,
      ttlMs: 1000,
      maxEntries: 1,
      now: () => now,
    });
    expect((await load('acme')).kind).toBe('unavailable');
    expect((await load('acme')).kind).toBe('ok');
    expect((await load('acme')).kind).toBe('ok'); // cached
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await load('other')).kind).toBe('missing'); // evicts acme (maxEntries 1)
    now = 5000;
    const hang = vi.fn((_u: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const slow = headLoader({ fetchImpl: hang, headUrl: (s) => s, timeoutMs: 20, ttlMs: 1000, maxEntries: 5, now: () => now });
    expect((await slow('acme')).kind).toBe('unavailable');
  });

  it('a hit re-inserts, so eviction is least-recently-used, not oldest-inserted', async () => {
    const now = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      const slug = url.split('/').pop();
      return new Response(JSON.stringify({ ...PAYLOAD, slug }), { status: 200 });
    });
    const load = headLoader({
      fetchImpl,
      headUrl: (s) => `https://gw.test/${s}`,
      timeoutMs: 50,
      ttlMs: 10_000,
      maxEntries: 2,
      now: () => now,
    });
    await load('a'); // cache: [a]
    await load('b'); // cache: [a, b]
    await load('a'); // a is HIT and re-inserted: [b, a]
    await load('c'); // over capacity: evicts the oldest, which is now b, not a
    expect(fetchImpl).toHaveBeenCalledTimes(3); // a, b, c each fetched once so far

    await load('a'); // still cached — a survived
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await load('b'); // evicted — refetches
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});
