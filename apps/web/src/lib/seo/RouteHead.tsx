/**
 * The tab title as a person navigates, from the same registry the crawl files
 * use.
 *
 * This is for people (tabs, bookmarks, history, WCAG 2.4.2), not crawlers:
 * the served head already carries each public page's title, and nothing here
 * touches robots, canonical or social tags, because a crawler that renders
 * does not reliably honour those when JavaScript changes them.
 *
 * Wiring (ADR 0158, "Integration at cutover"): mount `<RouteHead />` once,
 * inside the router, and call `useDocumentTitle(name)` from the one component
 * that already knows the page's printed name (the house header,
 * `pageNameFor`). Pages themselves never set `document.title`.
 */

import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { publicRouteFor, VENDOR_PREFIX } from './routes';
import { SITE, titleWithSite } from './site';

/**
 * Sets the registry title for public pages and the bare site name elsewhere,
 * except under `/v/`: a vendor catalogue's title is served in its own head
 * (`vendor-edge.ts`: the vendor's name, or "Not found" / "Catalogue
 * unavailable"), and writing the site name over it would give every
 * catalogue the same title in a tab and to a crawler that renders.
 * A layout effect on purpose: every layout effect in a commit runs before any
 * passive effect, so a `useDocumentTitle` below this in the tree still has
 * the last word on a signed-in page.
 */
export function RouteHead(): null {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    if (pathname.startsWith(VENDOR_PREFIX)) return;
    document.title = publicRouteFor(pathname)?.head.title ?? SITE.name;
  }, [pathname]);
  return null;
}

/** `Inventory · Mudavym` while the calling component is mounted. */
export function useDocumentTitle(pageName: string | null | undefined): void {
  useEffect(() => {
    if (!pageName) return;
    document.title = titleWithSite(pageName);
  }, [pageName]);
}
