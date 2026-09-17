/**
 * llms.txt: a plain summary for answer engines, in the llmstxt.org shape
 * (H1 name, blockquote summary, prose, H2 link lists).
 *
 * The Technical SEO team called this file a bet, not a standard, and asked
 * that it ship with an honesty note in the same commit (GRO-9). The note is
 * the paragraph under the summary. `llms-full.txt` is not built: no team
 * document asks for it, and there is no long-form content to concatenate.
 *
 * Shape follows the v2 text (llmstxt.org, 2026-08-10): prose sits above the
 * first H2, and every H2 holds only `[name](url): note` items.
 *
 * The "does not publish" sentence is the answer-surface form of emit-no-claim:
 * it gives an assistant a citable negative instead of a gap to fill.
 */

import { PUBLIC_ROUTES, VENDOR_PREFIX } from './routes';
import { SITE, absoluteUrl } from './site';

/** One line per page: the registry title without the site suffix. */
function pageLine(path: string): string | null {
  const route = PUBLIC_ROUTES.find((r) => r.path === path);
  if (!route) return null;
  const name = route.head.title.replace(` · ${SITE.name}`, '');
  const note = route.head.description === SITE.sentence ? '' : `: ${route.head.description}`;
  return `- [${name}](${absoluteUrl(path)})${note}`;
}

export function renderLlmsTxt(): string {
  const pages = PUBLIC_ROUTES.filter((r) => r.sitemap)
    .map((r) => pageLine(r.path))
    .filter((l): l is string => l !== null);
  return [
    `# ${SITE.name}`,
    '',
    `> ${SITE.sentence}`,
    '',
    'This file follows a young convention that no reader is obliged to use. It costs us one file, and we do not claim it does anything.',
    '',
    `Almost everything at ${SITE.host} is behind a sign-in and is not public. The pages below are. Vendors also publish their own catalogues here, at ${absoluteUrl(VENDOR_PREFIX)}{slug}. Prices, stock and product details on a catalogue are that vendor's statements, not Mudavym's. Search and answer engines may read and cite catalogues; they are not offered for model training.`,
    '',
    "This site does not publish a price for Mudavym itself, customer counts, ratings or reviews, or any restaurant's own records.",
    '',
    '## Pages',
    '',
    ...pages,
    '',
    '## Vendor catalogues',
    '',
    `- [Sitemap](${absoluteUrl('/sitemap.xml')}): every published catalogue, and the pages above`,
    `- [Crawl rules](${absoluteUrl('/robots.txt')}): which readers may fetch catalogues`,
    '',
    '## Contact',
    '',
    `- [Support](mailto:${SITE.supportEmail}): ${SITE.supportEmail}`,
    '',
  ].join('\n');
}
