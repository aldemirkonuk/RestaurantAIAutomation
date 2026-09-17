/**
 * sitemap-pages.xml: the house's own public pages, from the registry.
 *
 * The index at /sitemap.xml is served by the gateway (seo.controller.ts)
 * because only the database knows whether any vendor catalogue is published,
 * and a sitemap with no `<url>` is invalid against the sitemaps.org schema.
 * This file is static because nothing in it depends on data.
 *
 * No `<lastmod>`: a build date is not the date a page changed, and Google
 * stops trusting a site's lastmod once it sees it is not accurate.
 *
 * Every file sits at the host root. A sitemap may only list URLs under its
 * own directory (sitemaps.org, "Sitemap file location"), so /sitemaps/x.xml
 * could not list /login.
 */

import { escapeHtml } from './escape';
import { PUBLIC_ROUTES } from './routes';
import { absoluteUrl } from './site';

export const PAGES_SITEMAP_PATH = '/sitemap-pages.xml';

export function renderPagesSitemap(): string {
  const urls = PUBLIC_ROUTES.filter((r) => r.sitemap).map(
    (r) => `  <url><loc>${escapeHtml(absoluteUrl(r.path))}</loc></url>`,
  );
  if (urls.length === 0) {
    throw new Error('renderPagesSitemap: no routes marked sitemap; an empty urlset is invalid');
  }
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
