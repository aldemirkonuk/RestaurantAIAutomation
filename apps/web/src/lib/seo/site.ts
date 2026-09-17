/**
 * The facts every crawl file and served head repeats, stated once.
 *
 * Each value here is published to machines that quote it back to people, so
 * each one is either locked elsewhere or was answered by the founder:
 *
 * - `origin`: mudavym.com is canonical; www already 308s to the apex, and the
 *   old vercel.app production alias 308s here too (ADR 0158).
 * - `sentence`: the founder's pick on 2026-09-17 over "AI-powered wine
 *   inventory and procurement automation". Every clause is built today
 *   (beverage registers, orders, the invoice match); it carries no price
 *   (ADR 0039), no customer count and no strength claim.
 * - `supportEmail`: ADR 0149 row "contact = support@mudavym.com everywhere".
 * - `logo`: the A+M interlock mark (ADR 0047), the only locked visual. A
 *   1200x630 share card would be new landing art, which ADR 0039 holds.
 */
export const SITE = {
  origin: 'https://mudavym.com',
  host: 'mudavym.com',
  name: 'Mudavym',
  lang: 'en',
  sentence:
    'Restaurant back-office software for beverage inventory, purchasing, and checking vendor invoices against what was delivered.',
  supportEmail: 'support@mudavym.com',
  logo: { path: '/icon-512.png', width: 512, height: 512, alt: 'The Mudavym mark' },
} as const;

/** Absolute URL on the canonical host. `path` must start with "/". */
export function absoluteUrl(path: string): string {
  return `${SITE.origin}${path}`;
}

/** `Inventory · Mudavym`; the bare name when there is no page name. */
export function titleWithSite(pageName?: string | null): string {
  const name = (pageName ?? '').trim();
  return name ? `${name} · ${SITE.name}` : SITE.name;
}
