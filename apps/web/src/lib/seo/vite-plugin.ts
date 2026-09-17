/**
 * Writes the crawl surface next to the built app.
 *
 * Runs once, after Vite has written dist/index.html with its hashed script
 * tags, and derives every crawl file from that same shell and the registry:
 *
 *   dist/crawl/app.html             the shell as Vite wrote it (closed head);
 *                                   every signed-in route rewrites here
 *   dist/index.html                 REWRITTEN with the root's public head: the
 *                                   host serves this file for "/" before any
 *                                   rewrite can run
 *   dist/crawl/heads/<route>.html   one per other PUBLIC_ROUTES entry
 *   dist/crawl/vendor-shell.html    the /v/:slug template the middleware fills
 *   dist/404.html                   the shell, closed, titled "Not found"
 *   dist/crawl/robots-mudavym.txt   served as /robots.txt on mudavym.com
 *   dist/crawl/robots-other.txt     served as /robots.txt on every other host
 *   dist/sitemap-pages.xml
 *   dist/llms.txt
 *
 * Because the heads are cut from the shell this build produced, a deploy can
 * never serve a head whose scripts point at another deploy's asset hashes.
 * Nothing here is served by Vite's dev server: `vite dev` keeps index.html's
 * closed default, which is what a development host should say anyway.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { HEAD_END, HEAD_START, renderHeadBlock, replaceHeadBlock } from './head';
import { renderLlmsTxt } from './llms';
import { renderOtherHostRobots, renderRobots } from './robots';
import { PUBLIC_ROUTES } from './routes';
import { renderPagesSitemap } from './sitemap';
import { titleWithSite, SITE } from './site';
import { VENDOR_SHELL_FILE, renderVendorShell } from './vendor';

export const CRAWL_FILES = {
  appShell: 'crawl/app.html',
  notFound: '404.html',
  robots: 'crawl/robots-mudavym.txt',
  robotsOther: 'crawl/robots-other.txt',
  sitemapPages: 'sitemap-pages.xml',
  llms: 'llms.txt',
  vendorShell: VENDOR_SHELL_FILE,
} as const;

/** Every file the plugin writes, relative to outDir, given the built shell. */
export function crawlFiles(shell: string): Record<string, string> {
  const block = shell.slice(shell.indexOf(HEAD_START), shell.indexOf(HEAD_END));
  if (!block.includes('noindex, nofollow')) {
    // The input must be Vite's untouched shell. If this plugin ever read its
    // own output (a second run over dist/index.html, which it rewrites with
    // the root's public head), every signed-in route would be served
    // indexable. Refuse rather than build that.
    throw new Error('crawlFiles: index.html head block is not the closed default');
  }
  const files: Record<string, string> = { [CRAWL_FILES.appShell]: shell };
  for (const route of PUBLIC_ROUTES) {
    files[route.file] = replaceHeadBlock(shell, renderHeadBlock(route.head));
  }
  files[CRAWL_FILES.notFound] = replaceHeadBlock(
    shell,
    renderHeadBlock({
      title: titleWithSite('Not found'),
      description: SITE.sentence,
      robots: 'noindex, nofollow',
    }),
  );
  files[CRAWL_FILES.vendorShell] = renderVendorShell(shell);
  files[CRAWL_FILES.robots] = renderRobots();
  files[CRAWL_FILES.robotsOther] = renderOtherHostRobots();
  files[CRAWL_FILES.sitemapPages] = renderPagesSitemap();
  files[CRAWL_FILES.llms] = renderLlmsTxt();
  return files;
}

export function crawlSurface(): Plugin {
  let outDir = '';
  return {
    name: 'mudavym-crawl-surface',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      const shell = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      for (const [file, body] of Object.entries(crawlFiles(shell))) {
        const target = resolve(outDir, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, body);
      }
    },
  };
}
