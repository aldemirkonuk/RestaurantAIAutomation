/**
 * What to call the page the reader is standing on.
 *
 * The house header prints one name. It is NOT derived from the URL by
 * title-casing a slug — that invents copy — and it is not the page's own H1,
 * because two rebuilt pages print a sentence there rather than a name. It is
 * the name the person clicked in the sidebar, so the chrome and the navigation
 * agree word for word:
 *
 *   Dashboard              components/layout/Sidebar.tsx:77
 *   Inventory              Sidebar.tsx:83
 *   Orders                 Sidebar.tsx:89
 *   Receiving              Sidebar.tsx:102
 *   Providers              Sidebar.tsx:116
 *   Reports                Sidebar.tsx:128
 *   Calendar               Sidebar.tsx:137
 *   Team                   Sidebar.tsx:143
 *   Communications         Sidebar.tsx:149
 *   Documents & Reports    Sidebar.tsx:155
 *   Receipts & Credits     Sidebar.tsx:161
 *   Notifications          Sidebar.tsx:173
 *   Profile                Sidebar.tsx:196
 *   Settings               Sidebar.tsx:202
 *   Connections            Sidebar.tsx:208
 *
 * Two slugs have no sidebar entry, so their name is taken from the page's own
 * head instead and cited there: `recommendations`
 * (`pages/recommendations/next/RecommendationsNext.tsx:453`) and `cellar`
 * (`pages/cellar/next/cellar-format.ts:157-165`).
 *
 * The map is an exhaustive `Record<MudavymPage, …>`: adding a slug to
 * `MUDAVYM_PAGES` without naming it here fails `tsc`, so a new rebuilt page
 * cannot reach the header nameless.
 */

import type { MudavymPage } from './useMudavymDesign';

/**
 * One slug, eight routes: `cellar` gates `/cellar` and its seven registers
 * (App.tsx:318-324), so the slug alone cannot name the page — `/wines` is not
 * "Cellar". The route decides, and the titles are the register titles the page
 * itself prints (`pages/cellar/next/cellar-format.ts:157-165`).
 */
const CELLAR_BY_PATH: Record<string, string> = {
  '/cellar': 'Cellar',
  '/wines': 'Wines',
  '/beer': 'Beer',
  '/whiskey': 'Whiskey',
  '/cocktails': 'Cocktails',
  '/spirits': 'Spirits',
  '/non-alcoholic': 'Non-alcoholic',
  '/soft-drinks': 'Soft drinks',
};

export const PAGE_NAMES: Record<MudavymPage, string> = {
  dashboard: 'Dashboard',
  orders: 'Orders',
  receiving: 'Receiving',
  // Named for completeness; the door never renders chrome — see NO_CHROME.
  receiving_door: 'Receiving door',
  providers: 'Providers',
  communications: 'Communications',
  team: 'Team',
  inventory: 'Inventory',
  receipts: 'Receipts & Credits',
  documents_reports: 'Documents & Reports',
  reports: 'Reports',
  notifications: 'Notifications',
  recommendations: 'Recommendations',
  calendar: 'Calendar',
  settings: 'Settings',
  profile: 'Profile',
  cellar: 'Cellar',
  connections: 'Connections',
};

/**
 * Pages that must render NO house chrome.
 *
 * `receiving_door` is routed deliberately outside `DashboardLayout` — "It is
 * full-screen and one-handed, used at a loading dock by someone who is not
 * navigating the app" (App.tsx:227-240). A header full of menus is exactly the
 * taps that comment removes. It also forces the charcoal ground
 * (`DoorNext.tsx:380`), which is the one surface a header would have to fight.
 */
export const NO_CHROME: ReadonlySet<MudavymPage> = new Set<MudavymPage>(['receiving_door']);

/** The name to print for `page`, given the route actually open. */
export function pageNameFor(page: MudavymPage, pathname?: string | null): string {
  if (page === 'cellar' && pathname) {
    const named = CELLAR_BY_PATH[pathname];
    if (named) return named;
  }
  return PAGE_NAMES[page];
}
