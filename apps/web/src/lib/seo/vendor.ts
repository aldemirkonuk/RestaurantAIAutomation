/**
 * The served HTML for a published vendor catalogue, /v/:slug.
 *
 * The page is the one public content route Mudavym has (the Growth teams'
 * pilot answer surface, GRO-6). Answer engines do not run JavaScript, so a
 * catalogue that exists only after the app mounts does not exist for them.
 * The edge fills a template cut from this build's shell with a head and a
 * plain body of the same facts the page shows; `createRoot` replaces the body
 * on mount, so people get the app and machines get the facts, from ONE URL
 * and ONE response (no user-agent sniffing).
 *
 * Every string here came from a vendor and is untrusted. Text goes through
 * escapeHtml, JSON-LD through serializeJsonLd (escape.ts).
 */

import { clip, escapeHtml } from './escape.js';
import { HEAD_END, HEAD_START, fillRoot, renderHeadBlock, replaceHeadBlock } from './head.js';
import { SITE } from './site.js';

export const VENDOR_SHELL_FILE = 'crawl/vendor-shell.html';
export const VENDOR_HEAD_SLOT = '<!-- seo:vendor-head -->';
export const VENDOR_BODY_SLOT = '<!-- seo:vendor-body -->';
/** The template's whole head block; replaced in one piece, markers included. */
const VENDOR_HEAD_BLOCK = `${HEAD_START}\n    ${VENDOR_HEAD_SLOT}\n    ${HEAD_END}`;

/**
 * The slug shape the database enforces (vendor_portal_pages CHECK). Anything
 * else cannot be a page, so it is answered 404 without asking the gateway.
 */
export const VENDOR_SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

/** One listing as the gateway's head payload states it (seo.service.ts). */
export interface VendorListingFacts {
  productName: string;
  producer: string | null;
  vintage: number | null;
  origin: string | null;
  format: string | null;
  price: string | null;
  inStock: boolean | null;
}

/** GET /api/v1/seo/vendors/:slug/head */
export interface VendorHeadPayload {
  slug: string;
  canonical: string;
  title: string;
  description: string;
  image: { url: string; alt: string } | null;
  jsonLd: unknown;
  page: {
    displayName: string;
    tagline: string | null;
    about: string | null;
    websiteUrl: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    listings: VendorListingFacts[];
  };
}

/** The template: the build's shell with an empty head block and root slot. */
export function renderVendorShell(shell: string): string {
  const slotted = replaceHeadBlock(shell, VENDOR_HEAD_BLOCK);
  return fillRoot(slotted, VENDOR_BODY_SLOT);
}

function cell(value: string | number | null): string {
  return `<td>${value === null || value === '' ? '' : escapeHtml(String(value))}</td>`;
}

/** Only an http(s) URL becomes a link; anything else is printed as text. */
function safeHref(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** The no-JavaScript body: the facts the catalogue page shows, nothing more. */
export function renderVendorBody(payload: VendorHeadPayload): string {
  const { page } = payload;
  const parts: string[] = ['<main>', `<h1>${escapeHtml(page.displayName)}</h1>`];
  if (page.tagline) parts.push(`<p>${escapeHtml(page.tagline)}</p>`);
  if (page.about) parts.push(`<p>${escapeHtml(clip(page.about, 2000))}</p>`);

  const contact: string[] = [];
  const site = safeHref(page.websiteUrl);
  if (site) contact.push(`<a href="${escapeHtml(site)}" rel="nofollow">${escapeHtml(site)}</a>`);
  if (page.contactEmail) contact.push(escapeHtml(page.contactEmail));
  if (page.contactPhone) contact.push(escapeHtml(page.contactPhone));
  if (contact.length) parts.push(`<p>${contact.join(' · ')}</p>`);

  if (page.listings.length) {
    parts.push(
      '<table>',
      '<thead><tr><th>Product</th><th>Producer</th><th>Vintage</th><th>Origin</th><th>Format</th><th>Price</th><th>Stock</th></tr></thead>',
      '<tbody>',
    );
    for (const l of page.listings) {
      parts.push(
        '<tr>' +
          cell(l.productName) +
          cell(l.producer) +
          cell(l.vintage) +
          cell(l.origin) +
          cell(l.format) +
          cell(l.price) +
          // The page prints "Out of stock" and nothing else; unknown stock is
          // blank, never "in stock".
          cell(l.inStock === false ? 'Out of stock' : null) +
          '</tr>',
      );
    }
    parts.push('</tbody>', '</table>');
  }
  parts.push(
    `<p>Published by ${escapeHtml(page.displayName)} on ${escapeHtml(SITE.name)}. Prices and stock are the vendor's statements.</p>`,
    '</main>',
  );
  return parts.join('');
}

/** The full response body for a published catalogue. */
export function renderVendorPage(template: string, payload: VendorHeadPayload): string {
  if (!template.includes(VENDOR_HEAD_BLOCK) || !template.includes(VENDOR_BODY_SLOT)) {
    throw new Error('renderVendorPage: template slots missing');
  }
  const head = renderHeadBlock({
    title: payload.title,
    description: payload.description,
    robots: 'index, follow',
    canonical: payload.canonical,
    image: payload.image ?? undefined,
    jsonLd: payload.jsonLd,
  });
  // A replacer function, not a string: `$&` in a vendor's name must stay text.
  const withHead = template.replace(VENDOR_HEAD_BLOCK, () => head);
  return withHead.replace(VENDOR_BODY_SLOT, () => renderVendorBody(payload));
}

/**
 * The template with a closed head and an empty root: the answer for a slug
 * that is not a published catalogue (404) or a catalogue that cannot be read
 * right now (503). The app still boots from it, so a person sees the page's
 * own not-found or retry state; a crawler sees the status and `noindex`.
 */
export function renderVendorClosed(template: string, title: string): string {
  if (!template.includes(VENDOR_HEAD_BLOCK) || !template.includes(VENDOR_BODY_SLOT)) {
    throw new Error('renderVendorClosed: template slots missing');
  }
  const head = renderHeadBlock({ title, description: SITE.sentence, robots: 'noindex, nofollow' });
  return template.replace(VENDOR_HEAD_BLOCK, () => head).replace(VENDOR_BODY_SLOT, '');
}
