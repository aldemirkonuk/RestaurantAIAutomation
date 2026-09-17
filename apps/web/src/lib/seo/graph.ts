/**
 * The company's own structured data: who publishes the site, and what the
 * product is.
 *
 * Emit no claim rather than a weak one (vendor-portal.service.ts, adopted by
 * the Technical SEO team as its markup law). What is deliberately absent:
 *
 * - `offers` on SoftwareApplication: there is no public price (ADR 0039).
 *   This also means no Google software rich result, which is accepted.
 * - `aggregateRating`, `review`: the team's never-list.
 * - `address`, `LocalBusiness`: Mudavym has no premises to publish.
 * - `sameAs`: no verified public profile exists to point at.
 * - `foundingDate`, `numberOfEmployees`, `alternateName`: unrecorded, or (for
 *   WineOps) a retired name the house no longer answers to.
 * - `operatingSystem` beyond Web: store presence is not verified.
 * - `SearchAction`: there is no public search.
 */

import { SITE, absoluteUrl } from './site';

export const ORGANIZATION_ID = absoluteUrl('/#organization');
export const WEBSITE_ID = absoluteUrl('/#website');
export const SOFTWARE_ID = absoluteUrl('/#software');

export function siteGraph() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': ORGANIZATION_ID,
        name: SITE.name,
        url: absoluteUrl('/'),
        logo: {
          '@type': 'ImageObject',
          url: absoluteUrl(SITE.logo.path),
          width: SITE.logo.width,
          height: SITE.logo.height,
        },
        email: SITE.supportEmail,
      },
      {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        name: SITE.name,
        url: absoluteUrl('/'),
        inLanguage: SITE.lang,
        publisher: { '@id': ORGANIZATION_ID },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': SOFTWARE_ID,
        name: SITE.name,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: absoluteUrl('/'),
        description: SITE.sentence,
        publisher: { '@id': ORGANIZATION_ID },
      },
    ],
  };
}
