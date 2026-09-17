import { describe, expect, it } from 'vitest';
import { clip, escapeHtml, serializeJsonLd } from './escape';
import { HEAD_END, HEAD_START, fillRoot, renderHeadBlock, replaceHeadBlock } from './head';
import { renderLlmsTxt } from './llms';
import { ROBOTS_MARKER, TRAINING_BOTS, renderOtherHostRobots, renderRobots, rulesFor } from './robots';
import { PUBLIC_ROUTES, TOKEN_PREFIXES, VENDOR_PREFIX, publicRouteFor } from './routes';
import { renderPagesSitemap } from './sitemap';
import { SITE } from './site';
import { VENDOR_SLUG_RE, renderVendorBody, renderVendorPage, renderVendorShell, type VendorHeadPayload } from './vendor';
import { crawlFiles } from './vite-plugin';

/** Split robots.txt into groups: agents + rules, in file order. */
function parseGroups(text: string) {
  const groups: { agents: string[]; rules: string[] }[] = [];
  let current: { agents: string[]; rules: string[] } | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('Sitemap:')) continue;
    if (line.startsWith('User-agent:')) {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(line.slice('User-agent:'.length).trim());
    } else if (current) {
      current.rules.push(line);
    }
  }
  return groups;
}

/** RFC 9309 matching: longest pattern wins, Allow wins a tie. */
function allowed(rules: string[], path: string): boolean {
  let best: { len: number; allow: boolean } | null = null;
  for (const rule of rules) {
    const [kind, pattern] = rule.split(/:\s*/, 2);
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const literal = body
      .split('*')
      .map((s) => s.replace(/[.+?^$(){}|[\]\\]/g, (ch) => '\\' + ch))
      .join('.*');
    const re = new RegExp('^' + literal + (anchored ? '$' : ''));
    if (!re.test(path)) continue;
    const allow = kind === 'Allow';
    if (!best || pattern.length > best.len || (pattern.length === best.len && allow)) {
      best = { len: pattern.length, allow };
    }
  }
  return best ? best.allow : true;
}

describe('escape', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('keeps JSON-LD parseable while no sequence can close the script element', () => {
    const hostile = { name: '</script><script>alert(1)</script><!--', sep: 'a\u2028b\u2029c & d' };
    const out = serializeJsonLd(hostile);
    expect(out).not.toMatch(/<|>|&|\u2028|\u2029/);
    expect(JSON.parse(out)).toEqual(hostile);
  });

  it('clips at a word boundary and collapses whitespace', () => {
    expect(clip('one two\n\nthree', 50)).toBe('one two three');
    const out = clip('alpha beta gamma delta epsilon', 16);
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out).toBe('alpha beta…');
  });
});

describe('head block', () => {
  const shell = `<head>\n    ${HEAD_START}\n    <title>Mudavym</title>\n    ${HEAD_END}\n</head><body><div id="root"></div></body>`;

  it('refuses an indexable head without a canonical', () => {
    expect(() => renderHeadBlock({ title: 't', description: 'd', robots: 'index, follow' })).toThrow(/canonical/);
  });

  it('a closed head carries no canonical, no social tags and no index', () => {
    const block = renderHeadBlock({ title: 'Mudavym', description: 'd', robots: 'noindex, nofollow' });
    expect(block).toContain('noindex, nofollow');
    expect(block).not.toContain('canonical');
    expect(block).not.toContain('og:');
  });

  it('replaces the marked block exactly once and throws when markers are missing', () => {
    const block = renderHeadBlock(PUBLIC_ROUTES[1].head);
    const out = replaceHeadBlock(shell, block);
    expect(out.match(/<meta name="robots"/g)).toHaveLength(1);
    expect(out).toContain('<link rel="canonical" href="https://mudavym.com/login" />');
    expect(out).not.toContain('<title>Mudavym</title>');
    expect(() => replaceHeadBlock('<head></head>', block)).toThrow(/markers not found/);
    expect(() => replaceHeadBlock(shell + shell, block)).toThrow(/more than once/);
  });

  it('fills only an empty root', () => {
    expect(fillRoot(shell, '<main>x</main>')).toContain('<div id="root"><main>x</main></div>');
    expect(() => fillRoot('<div id="root">y</div>', 'x')).toThrow();
  });
});

describe('registry', () => {
  it('every public route is indexable, canonical to itself, and free of em dashes', () => {
    for (const r of PUBLIC_ROUTES) {
      expect(r.head.robots).toBe('index, follow');
      expect(r.head.canonical).toBe(`${SITE.origin}${r.path}`);
      expect(`${r.head.title} ${r.head.description}`).not.toContain('—');
      expect(r.head.description.length).toBeLessThanOrEqual(160);
    }
  });

  it('no public route or sitemap entry is token-bearing', () => {
    for (const r of PUBLIC_ROUTES) {
      for (const t of TOKEN_PREFIXES) expect(r.path.startsWith(t.replace(/\/$/, ''))).toBe(false);
    }
  });

  it('resolves exact paths only, ignoring a trailing slash', () => {
    expect(publicRouteFor('/login/')?.path).toBe('/login');
    expect(publicRouteFor('/login-x')).toBeUndefined();
    expect(publicRouteFor('/inventory')).toBeUndefined();
  });
});

describe('robots.txt', () => {
  const text = renderRobots();
  const groups = parseGroups(text);
  const groupFor = (agent: string) =>
    groups.find((g) => g.agents.includes(agent)) ?? groups.find((g) => g.agents.includes('*'))!;

  it('starts with the marker the census greps for and names the sitemap', () => {
    expect(text.split('\n')[0]).toBe(ROBOTS_MARKER);
    expect(text).toContain('Sitemap: https://mudavym.com/sitemap.xml');
    expect(text).not.toContain('—');
  });

  it('every group ends closed, so an unlisted path is disallowed', () => {
    for (const g of groups) {
      expect(g.rules[g.rules.length - 1]).toBe('Disallow: /');
      expect(allowed(g.rules, '/inventory')).toBe(false);
      expect(allowed(g.rules, '/admin/health')).toBe(false);
      expect(allowed(g.rules, '/api/v1/auth/me')).toBe(false);
    }
  });

  it('no reader may fetch a token route', () => {
    for (const g of groups) {
      for (const p of ['/invite/abc', '/reset-password?token=x', '/verify-email?token=x', '/studio/invite/t']) {
        expect(allowed(g.rules, p)).toBe(false);
      }
    }
  });

  it('search and answer engines read vendor catalogues; training crawlers and strangers do not', () => {
    for (const bot of ['Googlebot', 'OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Twitterbot']) {
      expect(allowed(groupFor(bot).rules, `${VENDOR_PREFIX}acme-wines`)).toBe(true);
      expect(allowed(groupFor(bot).rules, '/login')).toBe(true);
    }
    for (const bot of [...TRAINING_BOTS, 'SomeUnknownBot', 'Slackbot']) {
      expect(allowed(groupFor(bot).rules, `${VENDOR_PREFIX}acme-wines`)).toBe(false);
      expect(allowed(groupFor(bot).rules, '/privacy')).toBe(true);
      expect(allowed(groupFor(bot).rules, '/llms.txt')).toBe(true);
    }
  });

  it('only the root is anchored, and source maps stay out while the bundle is readable', () => {
    const anchored = renderRobots().split('\n').filter((l) => l.endsWith('$'));
    expect(new Set(anchored)).toEqual(new Set(['Allow: /$', 'Disallow: /assets/*.map$']));
    const open = rulesFor('open');
    expect(allowed(open, '/login')).toBe(true);
    expect(allowed(open, '/')).toBe(true);
    expect(allowed(open, '/vendor-prices')).toBe(false);
    expect(allowed(open, '/assets/index-abc.js')).toBe(true);
    expect(allowed(open, '/assets/index-abc.js.map')).toBe(false);
  });

  it('a name appears in exactly one group', () => {
    const all = groups.flatMap((g) => g.agents);
    expect(new Set(all).size).toBe(all.length);
  });

  it('other hosts are crawlable so their noindex header can be seen', () => {
    const other = renderOtherHostRobots();
    expect(other).toMatch(/User-agent: \*\nAllow: \/\n/);
    expect(other).not.toContain('Disallow');
  });
});

describe('sitemap and llms.txt', () => {
  it('lists the sitemap routes on the canonical host only', () => {
    const xml = renderPagesSitemap();
    expect(xml).toContain('<loc>https://mudavym.com/login</loc>');
    expect(xml).toContain('<loc>https://mudavym.com/privacy</loc>');
    expect(xml).not.toContain('<loc>https://mudavym.com/</loc>');
    expect(xml).not.toContain('lastmod');
  });

  it('llms.txt has the llmstxt.org v2 shape, the honesty note, and no price or rating claim', () => {
    const txt = renderLlmsTxt();
    const lines = txt.split('\n');
    expect(lines[0]).toBe('# Mudavym');
    expect(lines[2]).toBe(`> ${SITE.sentence}`);
    expect(txt).toContain('we do not claim it does anything');
    expect(txt).toContain('[Privacy & data](https://mudavym.com/privacy)');
    // v2: prose only above the first H2; under an H2, only link list items.
    const firstH2 = lines.findIndex((l) => l.startsWith('## '));
    expect(firstH2).toBeGreaterThan(3);
    for (const l of lines.slice(firstH2)) {
      if (l === '' || l.startsWith('## ')) continue;
      expect(l).toMatch(/^- \[[^\]]+\]\((https:\/\/mudavym\.com\/|mailto:)[^)]*\)(: .+)?$/);
    }
    expect(txt).not.toMatch(/\$\d|per month|\d(\.\d)? ?(stars|out of)|\d+ (restaurants|customers)/i);
    expect(txt).not.toContain('—');
  });
});

describe('vendor page', () => {
  const shell = [
    '<!doctype html><html><head>',
    '    <!-- seo:head:start -->',
    '    <title>Mudavym</title>',
    '    <meta name="robots" content="noindex, nofollow" />',
    '    <!-- seo:head:end -->',
    '<script type="module" src="/assets/index-abc.js"></script></head>',
    '<body><div id="root"></div></body></html>',
  ].join('\n');
  const hostile = '</script><script>alert(1)</script> $& $1';
  const payload: VendorHeadPayload = {
    slug: 'acme',
    canonical: 'https://mudavym.com/v/acme',
    title: `${hostile} catalogue · Mudavym`,
    description: 'd',
    image: null,
    jsonLd: { '@type': 'WebPage', name: hostile },
    page: {
      displayName: hostile,
      tagline: null,
      about: null,
      websiteUrl: 'javascript:alert(1)',
      contactEmail: null,
      contactPhone: null,
      listings: [
        { productName: 'Barolo', producer: null, vintage: 2019, origin: 'Piedmont, Italy', format: '6 x 750 ml', price: 'EUR 240.00', inStock: null },
        { productName: 'Etna', producer: 'X', vintage: null, origin: null, format: null, price: null, inStock: false },
      ],
    },
  };

  it('keeps the build shell scripts and fills both slots', () => {
    const template = renderVendorShell(shell);
    const html = renderVendorPage(template, payload);
    expect(html).toContain('src="/assets/index-abc.js"');
    expect(html).not.toContain('seo:vendor');
    expect(html).not.toContain('noindex');
    expect(html).toContain('<link rel="canonical" href="https://mudavym.com/v/acme" />');
    expect(html.match(/<meta name="robots"/g)).toHaveLength(1);
  });

  it('no vendor string can open a tag, and replacement patterns stay literal', () => {
    const html = renderVendorPage(renderVendorShell(shell), payload);
    expect(html.match(/<script/g)).toHaveLength(2); // the ld+json block and the app bundle
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('$&amp; $1');
    expect(html).not.toContain('javascript:');
  });

  it('states stock only when the vendor did', () => {
    const body = renderVendorBody(payload);
    expect(body).not.toContain('In stock');
    expect(body).toContain('Out of stock');
  });

  it('refuses a template without slots rather than serving the closed shell', () => {
    expect(() => renderVendorPage(shell, payload)).toThrow(/slots/);
  });

  it('accepts exactly the database slug shape', () => {
    for (const ok of ['a', 'acme', 'acme-wines', 'a1b']) expect(VENDOR_SLUG_RE.test(ok)).toBe(true);
    for (const bad of ['ab', 'Acme', '-acme', 'acme-', 'a_b', 'a'.repeat(64), '../x']) {
      expect(VENDOR_SLUG_RE.test(bad)).toBe(false);
    }
  });
});

describe('build output', () => {
  it('writes every crawl file from the shell, closed where it must be', () => {
    const shell = '<head>\n    <!-- seo:head:start -->\n    <title>Mudavym</title>\n    <meta name="robots" content="noindex, nofollow" />\n    <!-- seo:head:end -->\n</head><body><div id="root"></div></body>';
    const files = crawlFiles(shell);
    expect(Object.keys(files).sort()).toEqual(
      [
        ...PUBLIC_ROUTES.map((r) => r.file),
        '404.html',
        'crawl/app.html',
        'crawl/robots-other.txt',
        'crawl/robots-mudavym.txt',
        'crawl/vendor-shell.html',
        'llms.txt',
        'sitemap-pages.xml',
      ].sort(),
    );
    expect(files['404.html']).toContain('noindex, nofollow');
    expect(files['crawl/heads/login.html']).toContain('<title>Sign in · Mudavym</title>');
    expect(files['crawl/heads/login.html']).toContain('<meta property="og:title" content="Sign in" />');
    expect(files['crawl/app.html']).toBe(shell);
    expect(files['index.html']).toContain('<link rel="canonical" href="https://mudavym.com/" />');
    expect(files['index.html']).toContain('"@type":"WebSite"');
    // Fed its own output, the plugin refuses instead of opening every route.
    expect(() => crawlFiles(files['index.html'])).toThrow(/closed default/);
  });
});
