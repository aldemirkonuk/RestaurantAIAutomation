/**
 * The served `<head>` identity block, rendered from data.
 *
 * `apps/web/index.html` carries one marked block. The shell served for every
 * signed-in route keeps it as written there (a bare title and
 * `noindex, nofollow`), and the build swaps it per public route, so a route
 * nobody registered is closed by default: forgetting to register a page can
 * never make it indexable. The block is replaced, never appended to, so a
 * public file cannot carry both robots values.
 *
 * Crawler-facing tags are only ever SERVED, never set after mount: Google does
 * not reliably honour a robots or canonical tag that JavaScript changes, and
 * the AI crawlers do not run JavaScript at all.
 */

import { escapeHtml, serializeJsonLd } from './escape.js';
import { SITE, absoluteUrl } from './site.js';

const SITE_SUFFIX = ` · ${SITE.name}`;

/** `Sign in · Mudavym` -> `Sign in`; a bare `Mudavym` stays as it is. */
export function shareTitleOf(title: string): string {
  return title.endsWith(SITE_SUFFIX) ? title.slice(0, -SITE_SUFFIX.length) : title;
}

export const HEAD_START = '<!-- seo:head:start -->';
export const HEAD_END = '<!-- seo:head:end -->';
export const ROOT_EMPTY = '<div id="root"></div>';

export type Robots = 'index, follow' | 'noindex, nofollow';

export interface HeadMeta {
  title: string;
  description: string;
  robots: Robots;
  /**
   * Title for link previews and social cards. Defaults to `title` without the
   * ` · Mudavym` suffix: og:site_name carries the brand, and Apple's preview
   * guidance (TN3156) asks that og:title not repeat it.
   */
  shareTitle?: string;
  /** Absolute canonical URL. Required when robots is `index, follow`. */
  canonical?: string;
  /** Share image; defaults to the mark. Absolute URL. */
  image?: { url: string; width?: number; height?: number; alt: string };
  /** One JSON-LD document (an object or an `@graph` wrapper). */
  jsonLd?: unknown;
}

function tag(html: string): string {
  return `    ${html}`;
}

/** The lines between the markers, markers included. */
export function renderHeadBlock(meta: HeadMeta): string {
  if (meta.robots === 'index, follow' && !meta.canonical) {
    // An indexable page with no canonical lets every query-string variant
    // (`/login?redirect=...`) compete as its own URL.
    throw new Error(`renderHeadBlock: indexable head "${meta.title}" has no canonical`);
  }
  const lines = [
    HEAD_START,
    tag(`<title>${escapeHtml(meta.title)}</title>`),
    tag(`<meta name="description" content="${escapeHtml(meta.description)}" />`),
    tag(`<meta name="robots" content="${meta.robots}" />`),
  ];
  if (meta.robots === 'index, follow' && meta.canonical) {
    const image = meta.image ?? {
      url: absoluteUrl(SITE.logo.path),
      width: SITE.logo.width,
      height: SITE.logo.height,
      alt: SITE.logo.alt,
    };
    lines.push(
      tag(`<link rel="canonical" href="${escapeHtml(meta.canonical)}" />`),
      tag(`<meta property="og:site_name" content="${escapeHtml(SITE.name)}" />`),
      tag(`<meta property="og:type" content="website" />`),
      tag(`<meta property="og:title" content="${escapeHtml(meta.shareTitle ?? shareTitleOf(meta.title))}" />`),
      tag(`<meta property="og:description" content="${escapeHtml(meta.description)}" />`),
      tag(`<meta property="og:url" content="${escapeHtml(meta.canonical)}" />`),
      tag(`<meta property="og:image" content="${escapeHtml(image.url)}" />`),
    );
    if (image.width && image.height) {
      lines.push(
        tag(`<meta property="og:image:width" content="${image.width}" />`),
        tag(`<meta property="og:image:height" content="${image.height}" />`),
      );
    }
    lines.push(
      tag(`<meta property="og:image:alt" content="${escapeHtml(image.alt)}" />`),
      // `summary` is the square card; the mark is square. See site.ts on why
      // there is no large card.
      tag(`<meta name="twitter:card" content="summary" />`),
    );
  }
  if (meta.jsonLd !== undefined) {
    lines.push(tag(`<script type="application/ld+json">${serializeJsonLd(meta.jsonLd)}</script>`));
  }
  lines.push(tag(HEAD_END));
  return lines.join('\n');
}

/**
 * Swap the marked block in `html` for `block`. Throws when the markers are
 * missing or repeated: a silent no-op here would ship every public page with
 * the closed default head, which reads as success in every check that does
 * not fetch the page.
 */
export function replaceHeadBlock(html: string, block: string): string {
  const start = html.indexOf(HEAD_START);
  const end = html.indexOf(HEAD_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error('replaceHeadBlock: seo:head markers not found in index.html');
  }
  if (html.indexOf(HEAD_START, start + 1) >= 0 || html.indexOf(HEAD_END, end + 1) >= 0) {
    throw new Error('replaceHeadBlock: seo:head markers appear more than once');
  }
  return html.slice(0, start) + block.trimStart() + html.slice(end + HEAD_END.length);
}

/**
 * Put static markup inside the empty root, for readers that do not run
 * JavaScript. `createRoot` replaces it on mount, so people see the app.
 */
export function fillRoot(html: string, markup: string): string {
  const at = html.indexOf(ROOT_EMPTY);
  if (at < 0) throw new Error('fillRoot: <div id="root"></div> not found');
  return `${html.slice(0, at)}<div id="root">${markup}</div>${html.slice(at + ROOT_EMPTY.length)}`;
}
